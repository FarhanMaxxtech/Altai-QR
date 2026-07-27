import express from 'express';
import pool from '../db.js';

const router = express.Router();

// GET this merchant's batches that still have unassigned codes
router.get('/batches/available', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.batch_id, b.company_name, b.quantity, b.serial_start, b.serial_end,
              COUNT(qc.qr_id) FILTER (WHERE qc.variant_id IS NULL) AS unassigned_count
       FROM qrcode_batches b
       JOIN qr_codes qc ON qc.batch_id = b.batch_id
       WHERE b.assigned_user_id = $1
       GROUP BY b.batch_id
       HAVING COUNT(qc.qr_id) FILTER (WHERE qc.variant_id IS NULL) > 0
       ORDER BY b.created_at DESC`,
      [req.user.user_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET total unassigned QR code balance for this merchant, across ALL batches
router.get('/balance', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) FROM qr_codes
       WHERE assigned_user_id = $1 AND variant_id IS NULL`,
      [req.user.user_id]
    );
    res.json({ available: Number(result.rows[0].count) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST assign a specific QUANTITY of unassigned QR codes to one variant.
// Pulls from the merchant's whole pool (oldest/lowest serial first),
// not from a single batch — this is what makes partial assignment
// (1000 to Product A, 500 to Product B, etc.) possible.
router.post('/assign-quantity', async (req, res) => {
  const { variant_id, quantity } = req.body;
  const qty = Number(quantity);

  if (!variant_id) return res.status(400).json({ message: 'variant_id is required.' });
  if (!qty || qty <= 0) return res.status(400).json({ message: 'A valid quantity is required.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Ownership check — same pattern as the existing assign-variant route.
    const variantCheck = await client.query(
      `SELECT v.variant_id FROM variants v
       JOIN products p ON p.product_id = v.product_id
       WHERE v.variant_id = $1 AND p.merchant_id = $2`,
      [variant_id, req.user.merchant_id]
    );
    if (variantCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'This variant does not belong to you.' });
    }

    // Lock exactly `qty` unassigned codes belonging to this merchant,
    // oldest serial first, across all their batches.
    const codesResult = await client.query(
      `SELECT qr_id FROM qr_codes
       WHERE assigned_user_id = $1 AND variant_id IS NULL
       ORDER BY serial_number
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      [req.user.user_id, qty]
    );

    if (codesResult.rows.length < qty) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `Only ${codesResult.rows.length} unassigned codes available — cannot assign ${qty}.`,
      });
    }

    const qrIds = codesResult.rows.map((r) => r.qr_id);

    await client.query(
      `UPDATE qr_codes SET variant_id = $1, status = 'pending' WHERE qr_id = ANY($2::uuid[])`,
      [variant_id, qrIds]
    );

    await client.query('COMMIT');
    res.json({ assigned_count: qrIds.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

// POST link an entire batch's unassigned codes to one variant
router.post('/batches/:id/assign-variant', async (req, res) => {
  const { variant_id } = req.body;
  if (!variant_id) return res.status(400).json({ message: 'variant_id is required.' });

  try {
    // Ownership check: the batch must actually belong to this merchant,
    // and the variant must belong to this merchant's own products —
    // otherwise someone could assign another merchant's QR batch to
    // their own product, or vice versa.
    const batchCheck = await pool.query(
      'SELECT batch_id FROM qrcode_batches WHERE batch_id = $1 AND assigned_user_id = $2',
      [req.params.id, req.user.user_id]
    );
    if (batchCheck.rows.length === 0) {
      return res.status(403).json({ message: 'This batch does not belong to you.' });
    }

    const variantCheck = await pool.query(
      `SELECT v.variant_id FROM variants v
       JOIN products p ON p.product_id = v.product_id
       WHERE v.variant_id = $1 AND p.merchant_id = $2`,
      [variant_id, req.user.merchant_id]
    );
    if (variantCheck.rows.length === 0) {
      return res.status(403).json({ message: 'This variant does not belong to you.' });
    }

    const result = await pool.query(
      `UPDATE qr_codes
       SET variant_id = $1, status = 'pending'
       WHERE batch_id = $2 AND variant_id IS NULL
       RETURNING qr_id`,
      [variant_id, req.params.id]
    );
    res.json({ assigned_count: result.rowCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET per-batch breakdown of codes already assigned to one variant —
// e.g. "Batch X: 1000 units", "Batch Y: 500 units" — so the merchant can
// see exactly where a variant's stock came from across multiple batches.
router.get('/variants/:variantId/batch-summary', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.batch_id, b.company_name, b.serial_start, b.serial_end,
              COUNT(qc.qr_id) AS count
       FROM qr_codes qc
       JOIN qrcode_batches b ON b.batch_id = qc.batch_id
       JOIN variants v ON v.variant_id = qc.variant_id
       JOIN products p ON p.product_id = v.product_id
       WHERE qc.variant_id = $1 AND p.merchant_id = $2
       GROUP BY b.batch_id, b.company_name, b.serial_start, b.serial_end
       ORDER BY b.created_at DESC`,
      [req.params.variantId, req.user.merchant_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET look up one of THIS merchant's codes by serial_number or qr_value,
// before it's been linked to a product — used by the "Assign QR to
// Product" scan page.
router.get('/scan-lookup', async (req, res) => {
  const value = req.query.serial_number?.trim() || req.query.qr_value?.trim();
  if (!value) {
    return res.status(400).json({ message: 'serial_number or qr_value is required.' });
  }

  try {
    const result = await pool.query(
      `SELECT qr_id, serial_number, qr_value, status, variant_id
       FROM qr_codes
       WHERE (serial_number = $1 OR qr_value = $1) AND assigned_user_id = $2
       LIMIT 1`,
      [value, req.user.user_id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: 'Code not found.' });
    }

    const code = result.rows[0];
    if (code.variant_id) {
      return res.status(409).json({ message: 'This code is already assigned to a product.' });
    }

    res.json(code);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST link a batch of scanned (previously unlinked) codes to one variant,
// with an optional batch/remarks note and expiry date.
router.post('/assign-scan', async (req, res) => {
  const { qr_ids, variant_id, remarks, expiry_date } = req.body;

  if (!Array.isArray(qr_ids) || qr_ids.length === 0) {
    return res.status(400).json({ message: 'qr_ids must be a non-empty array.' });
  }
  if (!variant_id) return res.status(400).json({ message: 'variant_id is required.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const variantCheck = await client.query(
      `SELECT v.variant_id FROM variants v
       JOIN products p ON p.product_id = v.product_id
       WHERE v.variant_id = $1 AND p.merchant_id = $2`,
      [variant_id, req.user.merchant_id]
    );
    if (variantCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'This variant does not belong to you.' });
    }

    const codesCheck = await client.query(
      `SELECT qr_id FROM qr_codes
       WHERE qr_id = ANY($1::uuid[]) AND assigned_user_id = $2 AND variant_id IS NULL
       FOR UPDATE`,
      [qr_ids, req.user.user_id]
    );
    if (codesCheck.rows.length !== qr_ids.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'One or more scanned codes are invalid or already assigned.' });
    }

    await client.query(
      `UPDATE qr_codes
       SET variant_id = $1, status = 'pending', remarks = $2, expiry_date = $3
       WHERE qr_id = ANY($4::uuid[])`,
      [variant_id, remarks || null, expiry_date || null, qr_ids]
    );

    await client.query('COMMIT');
    res.json({ assigned_count: qr_ids.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

// POST assign a specific QUANTITY of unassigned codes from ONE chosen batch
// to one variant — partial assignment, unlike assign-variant which takes
// the whole batch's remaining unassigned codes.
router.post('/batches/:id/assign-quantity', async (req, res) => {
  const { variant_id, quantity } = req.body;
  const qty = Number(quantity);

  if (!variant_id) return res.status(400).json({ message: 'variant_id is required.' });
  if (!qty || qty <= 0) return res.status(400).json({ message: 'A valid quantity is required.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Ownership: batch must belong to this merchant, variant must belong
    // to this merchant's own products — same checks as assign-variant.
    const batchCheck = await client.query(
      'SELECT batch_id FROM qrcode_batches WHERE batch_id = $1 AND assigned_user_id = $2',
      [req.params.id, req.user.user_id]
    );
    if (batchCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'This batch does not belong to you.' });
    }

    const variantCheck = await client.query(
      `SELECT v.variant_id FROM variants v
       JOIN products p ON p.product_id = v.product_id
       WHERE v.variant_id = $1 AND p.merchant_id = $2`,
      [variant_id, req.user.merchant_id]
    );
    if (variantCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'This variant does not belong to you.' });
    }

    // Lock exactly `qty` unassigned codes from THIS batch only.
    const codesResult = await client.query(
      `SELECT qr_id FROM qr_codes
       WHERE batch_id = $1 AND variant_id IS NULL
       ORDER BY serial_number
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      [req.params.id, qty]
    );

    if (codesResult.rows.length < qty) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `Only ${codesResult.rows.length} unassigned codes left in this batch — cannot assign ${qty}.`,
      });
    }

    const qrIds = codesResult.rows.map((r) => r.qr_id);

    await client.query(
      `UPDATE qr_codes SET variant_id = $1, status = 'pending' WHERE qr_id = ANY($2::uuid[])`,
      [variant_id, qrIds]
    );

    await client.query('COMMIT');
    res.json({ assigned_count: qrIds.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

export default router;