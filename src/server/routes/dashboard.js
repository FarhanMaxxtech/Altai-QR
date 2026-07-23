import express from 'express';
import pool from '../db.js';

const router = express.Router();
const LOW_STOCK_THRESHOLD = 10;

router.get('/summary', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [deliveries, transfers, totalStock] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) FROM transactions t
         JOIN variants v ON v.variant_id = t.variant_id
         JOIN products p ON p.product_id = v.product_id
         WHERE t.transaction_type = 'RECEIVE' AND t.created_at >= $1 AND p.merchant_id = $2`,
        [today, req.user.merchant_id]
      ),
      pool.query(
        `SELECT COUNT(*) FROM transactions t
         JOIN variants v ON v.variant_id = t.variant_id
         JOIN products p ON p.product_id = v.product_id
         WHERE t.transaction_type = 'TRANSFER' AND t.created_at >= $1 AND p.merchant_id = $2`,
        [today, req.user.merchant_id]
      ),
      pool.query(
        `SELECT COALESCE(SUM(ib.quantity), 0) AS total FROM inventory_balance ib
         JOIN variants v ON v.variant_id = ib.variant_id
         JOIN products p ON p.product_id = v.product_id
         WHERE p.merchant_id = $1`,
        [req.user.merchant_id]
      ),
    ]);

    res.json({
      deliveriesToday: Number(deliveries.rows[0].count),
      transfersInProgress: Number(transfers.rows[0].count),
      totalStockAvailable: Number(totalStock.rows[0].total),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/stock-in-out', async (req, res) => {
  try {
    const [stockIn, stockOut] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(t.qty), 0) AS total FROM transactions t
         JOIN variants v ON v.variant_id = t.variant_id
         JOIN products p ON p.product_id = v.product_id
         WHERE t.transaction_type = 'RECEIVE' AND p.merchant_id = $1`,
        [req.user.merchant_id]
      ),
      pool.query(
        `SELECT COALESCE(SUM(t.qty), 0) AS total FROM transactions t
         JOIN variants v ON v.variant_id = t.variant_id
         JOIN products p ON p.product_id = v.product_id
         WHERE t.transaction_type = 'CHECKOUT' AND p.merchant_id = $1`,
        [req.user.merchant_id]
      ),
    ]);

    res.json([
      { name: 'Stock In', value: Number(stockIn.rows[0].total) },
      { name: 'Stock Out', value: Number(stockOut.rows[0].total) },
    ]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/tags-per-store', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.location AS store, COALESCE(SUM(ib.quantity), 0) AS tags
       FROM stores s
       LEFT JOIN inventory_balance ib ON ib.store_id = s.store_id
       WHERE s.merchant_id = $1
       GROUP BY s.store_id, s.location
       ORDER BY s.location`,
      [req.user.merchant_id]
    );
    res.json(result.rows.map((r) => ({ store: r.store, tags: Number(r.tags) })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/low-stock', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.product_name, v.sku, s.location AS store, ib.quantity
       FROM inventory_balance ib
       JOIN variants v ON v.variant_id = ib.variant_id
       JOIN products p ON p.product_id = v.product_id
       JOIN stores s ON s.store_id = ib.store_id
       WHERE ib.quantity < $1 AND p.merchant_id = $2
       ORDER BY ib.quantity ASC
       LIMIT 20`,
      [LOW_STOCK_THRESHOLD, req.user.merchant_id]
    );
    res.json(result.rows.map((r) => ({ item: `${r.product_name} (${r.sku})`, store: r.store, qty: r.quantity })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;