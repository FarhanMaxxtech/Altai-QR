import express from 'express';
import pool from '../db.js';

const router = express.Router();

// GET one row per (variant, store) that has ANY transaction history there —
// RECEIVE, TRANSFER, or CHECKOUT — even if the net balance is now 0. Balance
// is a signed sum straight from transactions (+qty when the store is the
// destination, -qty when it's the source), so it always nets correctly
// (e.g. 5 received - 4 transferred out = 1) instead of double-counting.
// Optionally filtered to a single store.
router.get('/', async (req, res) => {
  const { store_id } = req.query;

  const conditions = ['p.merchant_id = $1'];
  const params = [req.user.merchant_id];
  let idx = 2;

  if (store_id) {
    conditions.push(`s.store_id = $${idx++}`);
    params.push(store_id);
  }

  if (req.storeIds !== null) {
  conditions.push(`s.store_id = ANY($${idx++}::uuid[])`);
  params.push(req.storeIds);
  }

  try {
    const result = await pool.query(
      `WITH deltas AS (
         SELECT variant_id, to_store_id AS store_id, qty AS delta FROM transactions WHERE to_store_id IS NOT NULL
         UNION ALL
         SELECT variant_id, from_store_id AS store_id, -qty AS delta FROM transactions WHERE from_store_id IS NOT NULL
       ),
       balances AS (
         SELECT variant_id, store_id, SUM(delta) AS qty
         FROM deltas
         GROUP BY variant_id, store_id
       )
       SELECT
         s.store_id, s.location AS store_name,
         v.variant_id, v.sku, p.product_name, v.attributes, v.price,
         b.qty,
         MAX(t.created_at) AS last_movement
       FROM balances b
       JOIN variants v ON v.variant_id = b.variant_id
       JOIN products p ON p.product_id = v.product_id
       JOIN stores s ON s.store_id = b.store_id
       LEFT JOIN transactions t
         ON t.variant_id = b.variant_id
        AND (t.to_store_id = b.store_id OR t.from_store_id = b.store_id)
       WHERE ${conditions.join(' AND ')}
       GROUP BY s.store_id, s.location, v.variant_id, v.sku, p.product_name, v.attributes, v.price, b.qty
       ORDER BY last_movement DESC NULLS LAST, p.product_name, v.sku, s.location`,
      params
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;