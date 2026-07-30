import express from 'express';
import pool from '../db.js';

const router = express.Router();
const APPROVAL_REQUIRED_TYPES = ['DAMAGE', 'CYCLE_COUNT'];
const PENDING_QR_STATUS = { DAMAGE: 'damage_pending', CYCLE_COUNT: 'cycle_count_pending' };
const FINAL_QR_STATUS = { DAMAGE: 'damaged', CYCLE_COUNT: 'cycle_adjusted' };

router.get('/', async (req, res) => {
  const { variant_id, from_date, to_date } = req.query;

  try {
    const baseQuery = `
  SELECT t.transaction_id, t.transaction_type, t.qty, t.created_at, t.approval_status,
         p.product_name, v.sku,
         t.from_store_id, t.to_store_id,
         fs.location AS from_store_name, ts.location AS to_store_name,
         t.created_by, u.name AS created_by_name, u.role AS created_by_role
  FROM transactions t
  JOIN variants v ON v.variant_id = t.variant_id
  JOIN products p ON p.product_id = v.product_id
  LEFT JOIN stores fs ON fs.store_id = t.from_store_id
  LEFT JOIN stores ts ON ts.store_id = t.to_store_id
  LEFT JOIN users u ON u.user_id = t.created_by
  WHERE p.merchant_id = $1`;

    const conditions = [];
    const params = [req.user.merchant_id];
    let idx = 2;

    if (variant_id) {
      conditions.push(`t.variant_id = $${idx++}`);
      params.push(variant_id);
    }
    if (from_date) {
      conditions.push(`t.created_at::date >= $${idx++}::date`);
      params.push(from_date);
    }
    if (to_date) {
      conditions.push(`t.created_at::date <= $${idx++}::date`);
      params.push(to_date);
    }

    const whereExtra = conditions.length ? ` AND ${conditions.join(' AND ')}` : '';
    const result = await pool.query(`${baseQuery}${whereExtra} ORDER BY t.created_at DESC`, params);

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

    // --- Sync variants.quantity the same way as scan-move -----------------
    if (transaction_type === 'RECEIVE') {
      await client.query(
        `UPDATE variants SET quantity = quantity + $1 WHERE variant_id = $2`,
        [qty, variant_id]
      );
    } else if (transaction_type === 'CHECKOUT') {
      const variantRow = await client.query(
        `SELECT quantity FROM variants WHERE variant_id = $1 FOR UPDATE`,
        [variant_id]
      );
      const currentQty = variantRow.rows[0]?.quantity || 0;
      if (qty > currentQty) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: `Only ${currentQty} units available for this variant.` });
      }
      await client.query(
        `UPDATE variants SET quantity = quantity - $1 WHERE variant_id = $2`,
        [qty, variant_id]
      );
    }

    await client.query(
      `INSERT INTO transactions (variant_id, transaction_type, from_store_id, to_store_id, qty, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [variant_id, transaction_type, from_store_id || null, to_store_id || null, qty, req.user.user_id]
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
    return res.status(400).json({ message: 'serial_number or qr_value is required.' });
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
          p.product_id,
          p.product_name
      FROM qr_codes qc
      JOIN variants v ON v.variant_id = qc.variant_id
      JOIN products p ON p.product_id = v.product_id
      WHERE
          (UPPER(qc.serial_number) = UPPER($1) OR qc.qr_value = $1)
      AND p.merchant_id = $2
      ORDER BY qc.created_at DESC
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

// GET single transaction detail, including its serial numbers — used by
// the Recent Adjustments detail popup on the Stock Adjustment page.
router.get('/:id', async (req, res) => {
  try {
    const txResult = await pool.query(
      `SELECT t.transaction_id, t.transaction_type, t.qty, t.created_at, t.approval_status,
              p.product_name, v.sku,
              t.from_store_id, t.to_store_id,
              fs.location AS from_store_name, ts.location AS to_store_name
       FROM transactions t
       JOIN variants v ON v.variant_id = t.variant_id
       JOIN products p ON p.product_id = v.product_id
       LEFT JOIN stores fs ON fs.store_id = t.from_store_id
       LEFT JOIN stores ts ON ts.store_id = t.to_store_id
       WHERE t.transaction_id = $1 AND p.merchant_id = $2`,
      [req.params.id, req.user.merchant_id]
    );

    if (txResult.rows.length === 0) {
      return res.status(404).json({ message: 'Transaction not found.' });
    }

    const itemsResult = await pool.query(
      `SELECT qc.serial_number
       FROM transaction_items ti
       JOIN qr_codes qc ON qc.qr_id = ti.qr_id
       WHERE ti.transaction_id = $1
       ORDER BY qc.serial_number`,
      [req.params.id]
    );

    res.json({
      ...txResult.rows[0],
      serial_numbers: itemsResult.rows.map((r) => r.serial_number),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST process a whole batch of scanned units as one transaction
const STORES_FROM = ['CHECKOUT', 'TRANSFER', 'DAMAGE', 'CYCLE_COUNT']; // needs a source store, unit must be in_stock there
const STORES_TO = ['RECEIVE', 'TRANSFER'];                              // needs a destination store

// Status a qr_code lands on for types that permanently remove it from stock
const REMOVAL_STATUS = { CHECKOUT: 'checked_out', DAMAGE: 'damaged', CYCLE_COUNT: 'cycle_adjusted' };

router.post('/scan-move', async (req, res) => {
  const { qr_ids, transaction_type, from_store_id, to_store_id } = req.body;

  if (!Array.isArray(qr_ids) || qr_ids.length === 0) {
    return res.status(400).json({ message: 'qr_ids must be a non-empty array.' });
  }
  if (!transaction_type) return res.status(400).json({ message: 'transaction_type is required.' });
  if (transaction_type !== 'RECEIVE' && !from_store_id) {
    return res.status(400).json({ message: 'from_store_id is required for this transaction type.' });
  }
  if (transaction_type !== 'CHECKOUT' && transaction_type !== 'DAMAGE' && transaction_type !== 'CYCLE_COUNT' && !to_store_id) {
    return res.status(400).json({ message: 'to_store_id is required for this transaction type.' });
  }

  const needsApproval = APPROVAL_REQUIRED_TYPES.includes(transaction_type);

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

    const variantIds = new Set(codesResult.rows.map((r) => r.variant_id));
    if (variantIds.size > 1) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'All scanned units must be the same product variant.' });
    }
    const variant_id = [...variantIds][0];
    const qty = qr_ids.length;

    for (const row of codesResult.rows) {
      if (transaction_type === 'RECEIVE' && row.status !== 'pending') {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: `A scanned unit is not pending assignment (status: ${row.status}).` });
      }
      if (transaction_type !== 'RECEIVE'
          && (row.status !== 'in_stock' || row.current_store_id !== from_store_id)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'A scanned unit is not in stock at the selected source store.' });
      }
    }

    // --- Inventory effects: skipped entirely for pending-approval types —
    // nothing moves until an admin approves the transaction below. -------
    if (!needsApproval) {
      if (transaction_type !== 'RECEIVE') {
        const balanceResult = await client.query(
          `SELECT quantity FROM inventory_balance WHERE variant_id = $1 AND store_id = $2 FOR UPDATE`,
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
           DO UPDATE SET quantity = inventory_balance.quantity - $3, updated_at = now()`,
          [variant_id, from_store_id, qty]
        );
      }

      if (transaction_type === 'RECEIVE' || transaction_type === 'TRANSFER') {
        await client.query(
          `INSERT INTO inventory_balance (variant_id, store_id, quantity)
           VALUES ($1, $2, $3)
           ON CONFLICT (variant_id, store_id)
           DO UPDATE SET quantity = inventory_balance.quantity + $3, updated_at = now()`,
          [variant_id, to_store_id, qty]
        );
      }

      if (transaction_type === 'RECEIVE') {
        await client.query(`UPDATE variants SET quantity = quantity + $1 WHERE variant_id = $2`, [qty, variant_id]);
      } else if (transaction_type === 'CHECKOUT') {
        const variantRow = await client.query(`SELECT quantity FROM variants WHERE variant_id = $1 FOR UPDATE`, [variant_id]);
        const currentQty = variantRow.rows[0]?.quantity || 0;
        if (qty > currentQty) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: `Only ${currentQty} units available for this variant.` });
        }
        await client.query(`UPDATE variants SET quantity = quantity - $1 WHERE variant_id = $2`, [qty, variant_id]);
      }
    }

    // --- qr_codes status ---------------------------------------------------
    if (transaction_type === 'RECEIVE') {
      await client.query(
        `UPDATE qr_codes SET status = 'in_stock', current_store_id = $1 WHERE qr_id = ANY($2::uuid[])`,
        [to_store_id, qr_ids]
      );
    } else if (transaction_type === 'TRANSFER') {
      await client.query(
        `UPDATE qr_codes SET current_store_id = $1 WHERE qr_id = ANY($2::uuid[])`,
        [to_store_id, qr_ids]
      );
    } else if (needsApproval) {
      // Distinct status — never the string 'pending', so it can't be
      // confused with the "assigned but not yet received" meaning.
      await client.query(
        `UPDATE qr_codes SET status = $1 WHERE qr_id = ANY($2::uuid[])`,
        [PENDING_QR_STATUS[transaction_type], qr_ids]
      );
    } else {
      // CHECKOUT
      await client.query(
        `UPDATE qr_codes SET status = 'checked_out', current_store_id = NULL WHERE qr_id = ANY($1::uuid[])`,
        [qr_ids]
      );
    }

    const txResult = await client.query(
      `INSERT INTO transactions (variant_id, transaction_type, from_store_id, to_store_id, qty, approval_status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING transaction_id`,
      [variant_id, transaction_type, from_store_id || null, to_store_id || null, qty, needsApproval ? 'pending' : 'approved', req.user.user_id]
    );
    const transaction_id = txResult.rows[0].transaction_id;

    await client.query(
      `INSERT INTO transaction_items (transaction_id, qr_id) SELECT $1, unnest($2::uuid[])`,
      [transaction_id, qr_ids]
    );

    await client.query('COMMIT');
    res.status(201).json({ message: 'Transaction recorded.', count: qty, approval_status: needsApproval ? 'pending' : 'approved' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

// POST approve a pending Damage/Cycle Count transaction — this is the
// moment inventory_balance and variants.quantity actually change. Before
// this, the affected qr_codes sit in 'damage_pending'/'cycle_count_pending',
// which is intentionally never the string 'pending' used elsewhere.
router.post('/:id/approve', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const txResult = await client.query(
      `SELECT t.*, p.merchant_id FROM transactions t
       JOIN variants v ON v.variant_id = t.variant_id
       JOIN products p ON p.product_id = v.product_id
       WHERE t.transaction_id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (txResult.rows.length === 0 || txResult.rows[0].merchant_id !== req.user.merchant_id) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Transaction not found.' });
    }
    const tx = txResult.rows[0];
    if (tx.approval_status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: `This transaction is already ${tx.approval_status}.` });
    }

    const itemsResult = await client.query(
      `SELECT qr_id FROM transaction_items WHERE transaction_id = $1`,
      [tx.transaction_id]
    );
    const qrIds = itemsResult.rows.map((r) => r.qr_id);

    const balanceResult = await client.query(
      `SELECT quantity FROM inventory_balance WHERE variant_id = $1 AND store_id = $2 FOR UPDATE`,
      [tx.variant_id, tx.from_store_id]
    );
    const available = balanceResult.rows[0]?.quantity || 0;
    if (tx.qty > available) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `Only ${available} units currently at that store — cannot approve.` });
    }
    await client.query(
      `UPDATE inventory_balance SET quantity = quantity - $1, updated_at = now()
       WHERE variant_id = $2 AND store_id = $3`,
      [tx.qty, tx.variant_id, tx.from_store_id]
    );

    const variantRow = await client.query(`SELECT quantity FROM variants WHERE variant_id = $1 FOR UPDATE`, [tx.variant_id]);
    const currentQty = variantRow.rows[0]?.quantity || 0;
    if (tx.qty > currentQty) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `Only ${currentQty} units on hand for this variant — cannot approve.` });
    }
    await client.query(`UPDATE variants SET quantity = quantity - $1 WHERE variant_id = $2`, [tx.qty, tx.variant_id]);

    await client.query(
      `UPDATE qr_codes SET status = $1, current_store_id = NULL WHERE qr_id = ANY($2::uuid[])`,
      [FINAL_QR_STATUS[tx.transaction_type], qrIds]
    );

    await client.query(`UPDATE transactions SET approval_status = 'approved' WHERE transaction_id = $1`, [tx.transaction_id]);

    await client.query('COMMIT');
    res.json({ message: 'Approved.' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

// POST reject a pending Damage/Cycle Count transaction — nothing was ever
// deducted from inventory, so this just restores the scanned units to
// their normal in_stock status at the store they were scanned from.
router.post('/:id/reject', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const txResult = await client.query(
      `SELECT t.*, p.merchant_id FROM transactions t
       JOIN variants v ON v.variant_id = t.variant_id
       JOIN products p ON p.product_id = v.product_id
       WHERE t.transaction_id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (txResult.rows.length === 0 || txResult.rows[0].merchant_id !== req.user.merchant_id) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Transaction not found.' });
    }
    const tx = txResult.rows[0];
    if (tx.approval_status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: `This transaction is already ${tx.approval_status}.` });
    }

    const itemsResult = await client.query(
      `SELECT qr_id FROM transaction_items WHERE transaction_id = $1`,
      [tx.transaction_id]
    );
    const qrIds = itemsResult.rows.map((r) => r.qr_id);

    await client.query(`UPDATE qr_codes SET status = 'in_stock' WHERE qr_id = ANY($1::uuid[])`, [qrIds]);
    await client.query(`UPDATE transactions SET approval_status = 'rejected' WHERE transaction_id = $1`, [tx.transaction_id]);

    await client.query('COMMIT');
    res.json({ message: 'Rejected.' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

export default router;