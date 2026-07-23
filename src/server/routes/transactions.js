import express from 'express';
import pool from '../db.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const { variant_id } = req.query;

  try {
    const baseQuery = `
  SELECT t.transaction_id, t.transaction_type, t.qty, t.created_at,
         p.product_name, v.sku,
         t.from_store_id, t.to_store_id,
         fs.location AS from_store_name, ts.location AS to_store_name
  FROM transactions t
  JOIN variants v ON v.variant_id = t.variant_id
  JOIN products p ON p.product_id = v.product_id
  LEFT JOIN stores fs ON fs.store_id = t.from_store_id
  LEFT JOIN stores ts ON ts.store_id = t.to_store_id
  WHERE p.merchant_id = $1`;

    const result = variant_id
      ? await pool.query(`${baseQuery} AND t.variant_id = $2 ORDER BY t.created_at DESC`, [req.user.merchant_id, variant_id])
      : await pool.query(`${baseQuery} ORDER BY t.created_at DESC`, [req.user.merchant_id]);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/move', async (req, res) => {
  const { variant_id, transaction_type, from_store_id, to_store_id, qty } = req.body;

  if (!variant_id || !transaction_type || !qty || qty <= 0) {
    return res.status(400).json({ message: 'Missing or invalid transaction fields.' });
  }
  if (transaction_type !== 'RECEIVE' && !from_store_id) {
    return res.status(400).json({ message: 'from_store_id is required for this transaction type.' });
  }
  if (transaction_type !== 'CHECKOUT' && !to_store_id) {
    return res.status(400).json({ message: 'to_store_id is required for this transaction type.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Confirm this variant actually belongs to the logged-in merchant —
    // otherwise anyone could move stock on someone else's product.
    const ownershipCheck = await client.query(
      `SELECT v.variant_id FROM variants v
       JOIN products p ON p.product_id = v.product_id
       WHERE v.variant_id = $1 AND p.merchant_id = $2`,
      [variant_id, req.user.merchant_id]
    );
    if (ownershipCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'This variant does not belong to you.' });
    }

    if (transaction_type !== 'RECEIVE') {
      const balanceResult = await client.query(
        `SELECT quantity FROM inventory_balance
         WHERE variant_id = $1 AND store_id = $2 FOR UPDATE`,
        [variant_id, from_store_id]
      );
      const available = balanceResult.rows[0]?.quantity || 0;
      if (qty > available) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: `Only ${available} units available at source store.` });
      }

      await client.query(
        `INSERT INTO inventory_balance (variant_id, store_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (variant_id, store_id)
         DO UPDATE SET quantity = inventory_balance.quantity - $3`,
        [variant_id, from_store_id, qty]
      );
    }

    if (transaction_type !== 'CHECKOUT') {
      await client.query(
        `INSERT INTO inventory_balance (variant_id, store_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (variant_id, store_id)
         DO UPDATE SET quantity = inventory_balance.quantity + $3`,
        [variant_id, to_store_id, qty]
      );
    }

    await client.query(
      `INSERT INTO transactions (variant_id, transaction_type, from_store_id, to_store_id, qty)
       VALUES ($1, $2, $3, $4, $5)`,
      [variant_id, transaction_type, from_store_id || null, to_store_id || null, qty]
    );

    await client.query('COMMIT');
    res.status(201).json({ message: 'Transaction recorded.' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

// GET look up a single scanned code before adding it to the scan cart —
// validates ownership and current status without committing anything.
// GET look up a single scanned unit before adding it to the scan cart —
// validates ownership and current status without committing anything.
// Uses serial_number as the lookup key (previously qr_value).
router.get('/scan-lookup', async (req, res) => {
  const value =
    req.query.serial_number?.trim() ||
    req.query.qr_value?.trim();

  if (!value) {
    return res.status(400).json({
      message: 'serial_number or qr_value is required.'
    });
  }

  try {
    const result = await pool.query(
      `
      SELECT
          qc.qr_id,
          qc.qr_value,
          qc.serial_number,
          qc.status,
          qc.current_store_id,
          v.variant_id,
          v.sku,
          p.product_name
      FROM qr_codes qc
      JOIN variants v ON v.variant_id = qc.variant_id
      JOIN products p ON p.product_id = v.product_id
      WHERE
          (qc.serial_number = $1 OR qc.qr_value = $1)
      AND p.merchant_id = $2
      LIMIT 1
      `,
      [value, req.user.merchant_id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        message: 'Code not found.'
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({
      message: err.message
    });
  }
});

// POST process a whole batch of scanned units as one transaction
router.post('/scan-move', async (req, res) => {
  const { qr_ids, transaction_type, from_store_id, to_store_id } = req.body;

  if (!Array.isArray(qr_ids) || qr_ids.length === 0) {
    return res.status(400).json({ message: 'qr_ids must be a non-empty array.' });
  }
  if (!transaction_type) return res.status(400).json({ message: 'transaction_type is required.' });
  if (transaction_type !== 'RECEIVE' && !from_store_id) {
    return res.status(400).json({ message: 'from_store_id is required for this transaction type.' });
  }
  if (transaction_type !== 'CHECKOUT' && !to_store_id) {
    return res.status(400).json({ message: 'to_store_id is required for this transaction type.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const codesResult = await client.query(
      `SELECT qc.qr_id, qc.status, qc.current_store_id, qc.variant_id
       FROM qr_codes qc
       JOIN variants v ON v.variant_id = qc.variant_id
       JOIN products p ON p.product_id = v.product_id
       WHERE qc.qr_id = ANY($1::uuid[]) AND p.merchant_id = $2
       FOR UPDATE`,
      [qr_ids, req.user.merchant_id]
    );

    if (codesResult.rows.length !== qr_ids.length) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'One or more scanned codes do not belong to you or were not found.' });
    }

    // One transaction row = one variant moving, matching the old model —
    // every scanned unit in this batch must be the same variant.
    const variantIds = new Set(codesResult.rows.map((r) => r.variant_id));
    if (variantIds.size > 1) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'All scanned units must be the same product variant.' });
    }
    const variant_id = [...variantIds][0];

    for (const row of codesResult.rows) {
      if (transaction_type === 'RECEIVE' && row.status !== 'pending') {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: `A scanned unit is not pending assignment (status: ${row.status}).` });
      }
      if ((transaction_type === 'CHECKOUT' || transaction_type === 'TRANSFER')
          && (row.status !== 'in_stock' || row.current_store_id !== from_store_id)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'A scanned unit is not in stock at the selected source store.' });
      }
    }

    if (transaction_type === 'RECEIVE') {
      await client.query(
        `UPDATE qr_codes SET status = 'in_stock', current_store_id = $1 WHERE qr_id = ANY($2::uuid[])`,
        [to_store_id, qr_ids]
      );
    } else if (transaction_type === 'CHECKOUT') {
      await client.query(
        `UPDATE qr_codes SET status = 'checked_out', current_store_id = NULL WHERE qr_id = ANY($1::uuid[])`,
        [qr_ids]
      );
    } else if (transaction_type === 'TRANSFER') {
      await client.query(
        `UPDATE qr_codes SET current_store_id = $1 WHERE qr_id = ANY($2::uuid[])`,
        [to_store_id, qr_ids]
      );
    }

    const txResult = await client.query(
      `INSERT INTO transactions (variant_id, transaction_type, from_store_id, to_store_id, qty)
       VALUES ($1, $2, $3, $4, $5) RETURNING transaction_id`,
      [variant_id, transaction_type, from_store_id || null, to_store_id || null, qr_ids.length]
    );
    const transaction_id = txResult.rows[0].transaction_id;

    await client.query(
      `INSERT INTO transaction_items (transaction_id, qr_id)
       SELECT $1, unnest($2::uuid[])`,
      [transaction_id, qr_ids]
    );

    await client.query('COMMIT');
    res.status(201).json({ message: 'Transaction recorded.', count: qr_ids.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

export default router;