// src/server/routes/variants.js
import express from 'express';
import pool from '../db.js';

const router = express.Router();

router.put('/:id', async (req, res) => {
  const { sku, price, remarks, color, attributes } = req.body;

  if (!sku || !sku.trim()) {
    return res.status(400).json({ message: 'SKU is required.' });
  }

  try {
    const ownershipCheck = await pool.query(
      `SELECT v.variant_id FROM variants v
       JOIN products p ON p.product_id = v.product_id
       WHERE v.variant_id = $1 AND p.merchant_id = $2`,
      [req.params.id, req.user.merchant_id]
    );
    if (ownershipCheck.rows.length === 0) {
      return res.status(403).json({ message: 'This variant does not belong to you.' });
    }

    const result = await pool.query(
      `UPDATE variants
       SET sku = $1, price = $2, remarks = $3, color = $4, attributes = $5
       WHERE variant_id = $6 RETURNING *`,
      [sku.trim(), price || null, remarks || null, color || null, JSON.stringify(attributes || {}), req.params.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'That SKU is already in use.' });
    }
    res.status(500).json({ message: err.message });
  }
});

export default router;