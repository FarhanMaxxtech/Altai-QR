import express from 'express';
import pool from '../db.js';
import { assertStoreInScope } from '../middleware/storeScope.js';

const router = express.Router();

// Reasons a code can't be scanned for assignment right now, keyed by its
// current qr_codes.status. 'pending', 'unassigned', and 'checked_out' are
// NOT in this list — those are valid states to scan for (re)assignment.
const BLOCKED_STATUS_MESSAGES = {
  damaged: 'This code was marked as damaged and can no longer be assigned.',
  damage_pending: 'This code has a damage report awaiting approval.',
  cycle_count_pending: 'This code has a cycle count adjustment awaiting approval.',
  cycle_adjusted: 'This code was removed via a cycle count adjustment and can no longer be assigned.',
};

// GET this merchant's batches that still have unassigned codes
router.get('/batches/available', async (req, res) => {
  try {
    const result = await pool.query(
    `SELECT b.batch_id, b.company_name, b.quantity, b.serial_start, b.serial_end,
            COUNT(qc.qr_id) FILTER (WHERE qc.variant_id IS NULL) AS unassigned_count
    FROM qrcode_batches b
    JOIN qr_codes qc ON qc.batch_id = b.batch_id
    JOIN users u ON u.user_id = b.assigned_user_id
    WHERE u.merchant_id = $1
    GROUP BY b.batch_id
    HAVING COUNT(qc.qr_id) FILTER (WHERE qc.variant_id IS NULL) > 0
    ORDER BY b.created_at DESC`,
    [req.user.merchant_id]
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
    `SELECT COUNT(*) FROM qr_codes qc
    JOIN users u ON u.user_id = qc.assigned_user_id
    WHERE u.merchant_id = $1 AND qc.variant_id IS NULL`,
    [req.user.merchant_id]
  );
    res.json({ available: Number(result.rows[0].count) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET look up one of THIS merchant's codes by serial_number or qr_value —
// used by the "Assign QR to Product" scan page. Allows scanning codes that
// already have a variant (reassignment), but blocks codes that already
// have a pending approval request in flight.
// GET look up one of THIS merchant's codes by serial_number or qr_value —
// used by the "Assign QR to Product" scan page. Always resolves to the
// MOST RECENT row for that label, since a checked_out code can have a
// newer row created for it once it's reassigned (see /assign-scan).
router.get('/scan-lookup', async (req, res) => {
  const value = req.query.serial_number?.trim() || req.query.qr_value?.trim();
  if (!value) {
    return res.status(400).json({ message: 'serial_number or qr_value is required.' });
  }

  try {
    const result = await pool.query(
      `SELECT qc.qr_batch, qc.label_id, qc.qr_id, qc.status, qc.assigned_user_id,
              qc.current_store_id,
              qc.variant_id, qc.pending_variant_id,
              v.sku AS current_sku, p.product_name AS current_product_name
      FROM qr_codes qc
      JOIN users u ON u.user_id = qc.assigned_user_id
      LEFT JOIN variants v ON v.variant_id = qc.variant_id
      LEFT JOIN products p ON p.product_id = v.product_id
      WHERE (UPPER(qc.label_id) = UPPER($1) OR qc.qr_id = $1) AND u.merchant_id = $2
      ORDER BY qc.created_at DESC
      LIMIT 1`,
      [value, req.user.merchant_id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: 'Code not found.' });
    }

    const code = result.rows[0];

    // In-stock codes must be checked out first — they can't be reassigned
    // to a different product while still physically in a store.
    if (code.status === 'in_stock') {
      if (!assertStoreInScope(req, code.current_store_id)) {
        return res.status(403).json({
          message: 'This code is in stock at a store you do not have access to.',
          label_id: code.label_id,
        });
      }
      return res.status(409).json({
        message: 'This code is currently in stock and must be checked out before it can be reassigned.',
        label_id: code.label_id,
      });
    }

    if (BLOCKED_STATUS_MESSAGES[code.status]) {
      return res.status(409).json({
        message: BLOCKED_STATUS_MESSAGES[code.status],
        label_id: code.label_id,
      });
    }

    if (code.pending_variant_id) {
      return res.status(409).json({
        message: 'This code already has a pending assignment awaiting approval.',
        label_id: code.label_id,
      });
    }

    res.json(code);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST create an assignment REQUEST for a batch of scanned codes.
//
// - Codes that are NOT checked_out (pending/unassigned): updated in place,
//   same as before — sets pending_variant_id on the existing row.
// - Codes that ARE checked_out: the existing row is LEFT UNTOUCHED (it stays
//   as a permanent history record of that check-out), and a brand-new
//   qr_codes row is inserted reusing the same serial_number/qr_value, so the
//   physical label can be scanned and assigned again — to the same product
//   or a different one.
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
      `SELECT qc.qr_batch, qc.batch_id, qc.label_id, qc.qr_id, qc.status, qc.assigned_user_id
      FROM qr_codes qc
      JOIN users u ON u.user_id = qc.assigned_user_id
      WHERE qc.qr_batch = ANY($1::uuid[]) AND u.merchant_id = $2 AND qc.pending_variant_id IS NULL
      FOR UPDATE`,
      [qr_ids, req.user.merchant_id]
    );
    if (codesCheck.rows.length !== qr_ids.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'One or more scanned codes are invalid or already have a pending assignment.' });
    }

    const inStockCodes = codesCheck.rows.filter((r) => r.status === 'in_stock');
    if (inStockCodes.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: `${inStockCodes.length} scanned code(s) are currently in stock and cannot be reassigned until checked out.`,
      });
    }

    const reusableCodes = codesCheck.rows.filter((r) => r.status === 'checked_out');
    const directCodes = codesCheck.rows.filter((r) => r.status !== 'checked_out');

    if (directCodes.length > 0) {
        await client.query(
          `UPDATE qr_codes
          SET pending_variant_id = $1, pending_requested_at = now(), remarks = $2, expiry_date = $3
          WHERE qr_batch = ANY($4::uuid[])`,
          [variant_id, remarks || null, expiry_date || null, directCodes.map((r) => r.qr_batch)]
        );
      }

      let reusedCount = 0;
      for (const code of reusableCodes) {
        await client.query(
          `INSERT INTO qr_codes
            (batch_id, label_id, qr_id, assigned_user_id, status,
              pending_variant_id, pending_requested_at, remarks, expiry_date)
          VALUES ($1, $2, $3, $4, 'unassigned', $5, now(), $6, $7)`,
          [
            code.batch_id,
            code.label_id,
            code.qr_id,
            code.assigned_user_id,
            variant_id,
            remarks || null,
            expiry_date || null,
          ]
        );
        reusedCount++;
      }

    await client.query('COMMIT');
    res.json({ requested_count: directCodes.length + reusedCount });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

// GET grouped list of pending assignment requests — one row per target
// variant, with a count of how many codes are waiting on it. This is what
// "Approve QR Product" lists.
router.get('/pending-approvals', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT v.variant_id, v.sku, p.product_id, p.product_name,
              COUNT(qc.qr_batch) AS pending_count,
              MAX(qc.pending_requested_at) AS last_requested_at
       FROM qr_codes qc
       JOIN variants v ON v.variant_id = qc.pending_variant_id
       JOIN products p ON p.product_id = v.product_id
       WHERE p.merchant_id = $1 AND qc.pending_variant_id IS NOT NULL
       GROUP BY v.variant_id, v.sku, p.product_id, p.product_name
       ORDER BY MAX(qc.pending_requested_at) DESC`,
      [req.user.merchant_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET the serial-level detail for one pending group — current (target)
// product/variant plus previous product/variant (null if this is a first
// assignment, not a reassignment).
router.get('/pending-approvals/:variantId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT qc.qr_batch, qc.label_id, qc.remarks, qc.expiry_date, qc.pending_requested_at,
              tv.sku AS target_sku, tp.product_name AS target_product_name,
              pv.sku AS previous_sku, pp.product_name AS previous_product_name
      FROM qr_codes qc
      JOIN variants tv ON tv.variant_id = qc.pending_variant_id
      JOIN products tp ON tp.product_id = tv.product_id
      LEFT JOIN variants pv ON pv.variant_id = qc.variant_id
      LEFT JOIN products pp ON pp.product_id = pv.product_id
      WHERE qc.pending_variant_id = $1 AND tp.merchant_id = $2
      ORDER BY qc.label_id`,
      [req.params.variantId, req.user.merchant_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No pending assignments found for this variant.' });
    }
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST approve some or all pending codes for one target variant.
// Approving moves variant_id -> pending_variant_id (i.e. the request
// becomes real), clears the pending fields, and resets stock status to
// 'pending' since a reassigned unit needs to be re-received before it
// counts as in-stock again.
router.post('/pending-approvals/:variantId/approve', async (req, res) => {
  const { qr_ids } = req.body; // optional subset; default = every code in this group

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const variantCheck = await client.query(
      `SELECT v.variant_id FROM variants v
       JOIN products p ON p.product_id = v.product_id
       WHERE v.variant_id = $1 AND p.merchant_id = $2`,
      [req.params.variantId, req.user.merchant_id]
    );
    if (variantCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'This variant does not belong to you.' });
    }

    const hasSubset = Array.isArray(qr_ids) && qr_ids.length > 0;
    const result = await client.query(
      `UPDATE qr_codes
      SET variant_id = pending_variant_id,
          pending_variant_id = NULL,
          pending_requested_at = NULL,
          status = 'pending',
          current_store_id = NULL
      WHERE pending_variant_id = $1
      ${hasSubset ? 'AND qr_batch = ANY($2::uuid[])' : ''}
      RETURNING qr_batch`,
      hasSubset ? [req.params.variantId, qr_ids] : [req.params.variantId]
    );

    await client.query('COMMIT');
    res.json({ approved_count: result.rowCount });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

// POST reject some or all pending codes for one target variant — just
// cancels the request; the code goes back to whatever it was before
// (unchanged variant_id/status).
router.post('/pending-approvals/:variantId/reject', async (req, res) => {
  const { qr_ids } = req.body;

  try {
    const ownershipCheck = await pool.query(
      `SELECT v.variant_id FROM variants v
       JOIN products p ON p.product_id = v.product_id
       WHERE v.variant_id = $1 AND p.merchant_id = $2`,
      [req.params.variantId, req.user.merchant_id]
    );
    if (ownershipCheck.rows.length === 0) {
      return res.status(403).json({ message: 'This variant does not belong to you.' });
    }

    const hasSubset = Array.isArray(qr_ids) && qr_ids.length > 0;
    const result = await pool.query(
      `UPDATE qr_codes
      SET pending_variant_id = NULL, pending_requested_at = NULL
      WHERE pending_variant_id = $1
      ${hasSubset ? 'AND qr_batch = ANY($2::uuid[])' : ''}
      RETURNING qr_batch`,
      hasSubset ? [req.params.variantId, qr_ids] : [req.params.variantId]
    );
    res.json({ rejected_count: result.rowCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- Existing batch-based routes (unchanged, kept for compatibility) ------

router.post('/assign-quantity', async (req, res) => {
  const { variant_id, quantity } = req.body;
  const qty = Number(quantity);

  if (!variant_id) return res.status(400).json({ message: 'variant_id is required.' });
  if (!qty || qty <= 0) return res.status(400).json({ message: 'A valid quantity is required.' });

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

    const codesResult = await client.query(
      `SELECT qc.qr_batch FROM qr_codes qc
      JOIN users u ON u.user_id = qc.assigned_user_id
      WHERE u.merchant_id = $1 AND qc.variant_id IS NULL
      ORDER BY qc.label_id
      LIMIT $2
      FOR UPDATE SKIP LOCKED`,
      [req.user.merchant_id, qty]
    );

    if (codesResult.rows.length < qty) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `Only ${codesResult.rows.length} unassigned codes available — cannot assign ${qty}.`,
      });
    }

    const qrIds = codesResult.rows.map((r) => r.qr_batch);
    await client.query(
      `UPDATE qr_codes SET variant_id = $1, status = 'pending' WHERE qr_batch = ANY($2::uuid[])`,
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

router.post('/batches/:id/assign-variant', async (req, res) => {
  const { variant_id } = req.body;
  if (!variant_id) return res.status(400).json({ message: 'variant_id is required.' });

  try {
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
      RETURNING qr_batch`,
      [variant_id, req.params.id]
    );
    res.json({ assigned_count: result.rowCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/variants/:variantId/batch-summary', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.batch_id, b.company_name, b.serial_start, b.serial_end,
              COUNT(qc.qr_batch) AS count
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

router.post('/batches/:id/assign-quantity', async (req, res) => {
  const { variant_id, quantity } = req.body;
  const qty = Number(quantity);

  if (!variant_id) return res.status(400).json({ message: 'variant_id is required.' });
  if (!qty || qty <= 0) return res.status(400).json({ message: 'A valid quantity is required.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const batchCheck = await client.query(
      `SELECT b.batch_id FROM qrcode_batches b
      JOIN users u ON u.user_id = b.assigned_user_id
      WHERE b.batch_id = $1 AND u.merchant_id = $2`,
      [req.params.id, req.user.merchant_id]
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

    const codesResult = await client.query(
      `SELECT qc.qr_batch FROM qr_codes qc
      JOIN users u ON u.user_id = qc.assigned_user_id
      WHERE qc.batch_id = $1
        AND u.merchant_id = $2
        AND qc.variant_id IS NULL
      ORDER BY qc.label_id
      LIMIT $3
      FOR UPDATE SKIP LOCKED`,
      [req.params.id, req.user.merchant_id, qty]
    );

    if (codesResult.rows.length < qty) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `Only ${codesResult.rows.length} unassigned codes left in this batch — cannot assign ${qty}.`,
      });
    }

    const qrIds = codesResult.rows.map((r) => r.qr_batch);
    await client.query(
      `UPDATE qr_codes SET variant_id = $1, status = 'pending' WHERE qr_batch = ANY($2::uuid[])`,
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