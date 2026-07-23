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

export default router;