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

// GET stock movement for the last 7 days, in three shapes at once:
// trend (daily in/out), split (7-day totals), byStore (in/out per store).
// RECEIVE = stock in, CHECKOUT = stock out — TRANSFER is store-to-store,
// so it's excluded from these totals (same convention as /stock-in-out).
router.get('/stock-movement', async (req, res) => {
  try {
    const [trendResult, splitResult, byStoreResult] = await Promise.all([
      pool.query(
        `WITH days AS (
           SELECT generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day')::date AS day
         ),
         merchant_tx AS (
           SELECT t.created_at::date AS day, t.transaction_type, t.qty
           FROM transactions t
           JOIN variants v ON v.variant_id = t.variant_id
           JOIN products p ON p.product_id = v.product_id
           WHERE p.merchant_id = $1
             AND t.created_at >= CURRENT_DATE - INTERVAL '6 days'
         )
         SELECT
           days.day,
           COALESCE(SUM(CASE WHEN merchant_tx.transaction_type = 'RECEIVE' THEN merchant_tx.qty END), 0) AS stock_in,
           COALESCE(SUM(CASE WHEN merchant_tx.transaction_type = 'CHECKOUT' THEN merchant_tx.qty END), 0) AS stock_out
         FROM days
         LEFT JOIN merchant_tx ON merchant_tx.day = days.day
         GROUP BY days.day
         ORDER BY days.day`,
        [req.user.merchant_id]
      ),
      pool.query(
        `SELECT
           COALESCE(SUM(CASE WHEN t.transaction_type = 'RECEIVE' THEN t.qty END), 0) AS stock_in,
           COALESCE(SUM(CASE WHEN t.transaction_type = 'CHECKOUT' THEN t.qty END), 0) AS stock_out
         FROM transactions t
         JOIN variants v ON v.variant_id = t.variant_id
         JOIN products p ON p.product_id = v.product_id
         WHERE p.merchant_id = $1 AND t.created_at >= CURRENT_DATE - INTERVAL '6 days'`,
        [req.user.merchant_id]
      ),
      pool.query(
        `SELECT
           s.store_id, s.location AS store,
           COALESCE(SUM(CASE WHEN t.transaction_type = 'RECEIVE' AND t.to_store_id = s.store_id THEN t.qty END), 0) AS stock_in,
           COALESCE(SUM(CASE WHEN t.transaction_type = 'CHECKOUT' AND t.from_store_id = s.store_id THEN t.qty END), 0) AS stock_out
         FROM stores s
         LEFT JOIN transactions t
           ON (t.to_store_id = s.store_id OR t.from_store_id = s.store_id)
          AND t.created_at >= CURRENT_DATE - INTERVAL '6 days'
          AND t.transaction_type IN ('RECEIVE', 'CHECKOUT')
         WHERE s.merchant_id = $1
         GROUP BY s.store_id, s.location
         ORDER BY s.location`,
        [req.user.merchant_id]
      ),
    ]);

    res.json({
      trend: trendResult.rows.map((r) => ({
        day: r.day,
        stock_in: Number(r.stock_in),
        stock_out: Number(r.stock_out),
      })),
      split: {
        stockIn: Number(splitResult.rows[0].stock_in),
        stockOut: Number(splitResult.rows[0].stock_out),
      },
      byStore: byStoreResult.rows.map((r) => ({
        store_id: r.store_id,
        store: r.store,
        stock_in: Number(r.stock_in),
        stock_out: Number(r.stock_out),
      })),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;