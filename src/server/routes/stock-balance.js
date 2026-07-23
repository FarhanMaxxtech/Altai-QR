import express from 'express';
import pool from '../db.js';

const router = express.Router();

// GET one row per (variant, store) where the variant currently has in-stock
// units at that store — optionally filtered to a single store. This is the
// flattened, store-scoped view the Product Balance page needs, distinct
// from GET /api/products which nests everything under each product.
router.get('/', async (req, res) => {
  const { store_id } = req.query;

  const conditions = [`qc.status = 'in_stock'`, 'p.merchant_id = $1'];
  const params = [req.user.merchant_id];
  let idx = 2;

  if (store_id) {
    conditions.push(`s.store_id = $${idx++}`);
    params.push(store_id);
  }

  try {
    const result = await pool.query(
      `SELECT
         s.store_id, s.location AS store_name,
         v.variant_id, v.sku, p.product_name, v.attributes, v.price,
         COUNT(qc.qr_id) AS qty,
         MAX(t.created_at) AS last_movement
       FROM qr_codes qc
       JOIN variants v ON v.variant_id = qc.variant_id
       JOIN products p ON p.product_id = v.product_id
       JOIN stores s ON s.store_id = qc.current_store_id
       LEFT JOIN transactions t
         ON t.variant_id = v.variant_id
        AND (t.to_store_id = s.store_id OR t.from_store_id = s.store_id)
       WHERE ${conditions.join(' AND ')}
       GROUP BY s.store_id, s.location, v.variant_id, v.sku, p.product_name, v.attributes, v.price
       ORDER BY last_movement DESC NULLS LAST, p.product_name, v.sku, s.location`,
      params
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;