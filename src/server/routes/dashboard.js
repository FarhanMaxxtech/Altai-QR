import express from 'express';
import pool from '../db.js';

const router = express.Router();
const LOW_STOCK_THRESHOLD = 10;

// src/server/routes/dashboard.js
router.get('/summary', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const scoped = req.storeIds !== null;
    const deliveriesParams = scoped ? [today, req.user.merchant_id, req.storeIds] : [today, req.user.merchant_id];
    const transfersParams = scoped ? [today, req.user.merchant_id, req.storeIds] : [today, req.user.merchant_id];
    const stockParams = scoped ? [req.user.merchant_id, req.storeIds] : [req.user.merchant_id];
    const trendParams = scoped ? [req.user.merchant_id, req.storeIds] : [req.user.merchant_id];

    const [deliveries, transfers, totalStock, scans, trends] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) FROM transactions t
         JOIN variants v ON v.variant_id = t.variant_id
         JOIN products p ON p.product_id = v.product_id
         WHERE t.transaction_type = 'RECEIVE' AND t.created_at >= $1 AND p.merchant_id = $2
         ${scoped ? 'AND t.to_store_id = ANY($3::uuid[])' : ''}`,
        deliveriesParams
      ),
      pool.query(
        `SELECT COUNT(*) FROM transactions t
         JOIN variants v ON v.variant_id = t.variant_id
         JOIN products p ON p.product_id = v.product_id
         WHERE t.transaction_type = 'TRANSFER' AND t.created_at >= $1 AND p.merchant_id = $2
         ${scoped ? 'AND (t.from_store_id = ANY($3::uuid[]) OR t.to_store_id = ANY($3::uuid[]))' : ''}`,
        transfersParams
      ),
      pool.query(
        `SELECT COALESCE(SUM(ib.quantity), 0) AS total FROM inventory_balance ib
         JOIN variants v ON v.variant_id = ib.variant_id
         JOIN products p ON p.product_id = v.product_id
         WHERE p.merchant_id = $1
         ${scoped ? 'AND ib.store_id = ANY($2::uuid[])' : ''}`,
        stockParams
      ),
      pool.query(
        `SELECT COUNT(*) FROM qr_codes qc
         JOIN users u ON u.user_id = qc.assigned_user_id
         WHERE u.merchant_id = $1 AND qc.created_at >= $2`,
        [req.user.merchant_id, today]
      ),
      // --- 7-day daily series for each sparkline -----------------------
      pool.query(
        `WITH days AS (
           SELECT generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day')::date AS day
         ),
         daily_receive AS (
           SELECT t.created_at::date AS day, COUNT(*) AS cnt
           FROM transactions t
           JOIN variants v ON v.variant_id = t.variant_id
           JOIN products p ON p.product_id = v.product_id
           WHERE p.merchant_id = $1 AND t.transaction_type = 'RECEIVE'
             AND t.created_at >= CURRENT_DATE - INTERVAL '6 days'
             ${scoped ? 'AND t.to_store_id = ANY($2::uuid[])' : ''}
           GROUP BY t.created_at::date
         ),
         daily_transfer AS (
           SELECT t.created_at::date AS day, COUNT(*) AS cnt
           FROM transactions t
           JOIN variants v ON v.variant_id = t.variant_id
           JOIN products p ON p.product_id = v.product_id
           WHERE p.merchant_id = $1 AND t.transaction_type = 'TRANSFER'
             AND t.created_at >= CURRENT_DATE - INTERVAL '6 days'
             ${scoped ? 'AND (t.from_store_id = ANY($2::uuid[]) OR t.to_store_id = ANY($2::uuid[]))' : ''}
           GROUP BY t.created_at::date
         ),
         daily_scans AS (
           SELECT qc.created_at::date AS day, COUNT(*) AS cnt
           FROM qr_codes qc
           JOIN users u ON u.user_id = qc.assigned_user_id
           WHERE u.merchant_id = $1
             AND qc.created_at >= CURRENT_DATE - INTERVAL '6 days'
           GROUP BY qc.created_at::date
         )
         SELECT
           days.day,
           COALESCE(dr.cnt, 0) AS deliveries,
           COALESCE(dt.cnt, 0) AS transfers,
           COALESCE(ds.cnt, 0) AS scans
         FROM days
         LEFT JOIN daily_receive dr ON dr.day = days.day
         LEFT JOIN daily_transfer dt ON dt.day = days.day
         LEFT JOIN daily_scans ds ON ds.day = days.day
         ORDER BY days.day`,
        trendParams
      ),
    ]);

    const trendRows = trends.rows;
    const deliveriesTrend = trendRows.map((r) => Number(r.deliveries));
    const transfersTrend = trendRows.map((r) => Number(r.transfers));
    const scansTrend = trendRows.map((r) => Number(r.scans));

    const totalStockValue = Number(totalStock.rows[0].total);
    const totalStockTrend = new Array(7).fill(totalStockValue);

    res.json({
      deliveriesToday: Number(deliveries.rows[0].count),
      deliveriesTrend,
      transfersInProgress: Number(transfers.rows[0].count),
      transfersTrend,
      totalStockAvailable: totalStockValue,
      totalStockTrend,
      scansToday: Number(scans.rows[0].count),
      scansTrend,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/stock-in-out', async (req, res) => {
  try {
    const scoped = req.storeIds !== null;
    const inParams = scoped ? [req.user.merchant_id, req.storeIds] : [req.user.merchant_id];
    const outParams = scoped ? [req.user.merchant_id, req.storeIds] : [req.user.merchant_id];

    const [stockIn, stockOut] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(t.qty), 0) AS total FROM transactions t
         JOIN variants v ON v.variant_id = t.variant_id
         JOIN products p ON p.product_id = v.product_id
         WHERE t.transaction_type = 'RECEIVE' AND p.merchant_id = $1
         ${scoped ? 'AND t.to_store_id = ANY($2::uuid[])' : ''}`,
        inParams
      ),
      pool.query(
        `SELECT COALESCE(SUM(t.qty), 0) AS total FROM transactions t
         JOIN variants v ON v.variant_id = t.variant_id
         JOIN products p ON p.product_id = v.product_id
         WHERE t.transaction_type = 'CHECKOUT' AND p.merchant_id = $1
         ${scoped ? 'AND t.from_store_id = ANY($2::uuid[])' : ''}`,
        outParams
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
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const scoped = req.storeIds !== null;

    const balanceParams = scoped ? [req.user.merchant_id, req.storeIds] : [req.user.merchant_id];
    const deltaParams = scoped
      ? [req.user.merchant_id, today, req.storeIds]
      : [req.user.merchant_id, today];

    const [balanceResult, deltaResult] = await Promise.all([
      pool.query(
        `SELECT s.location AS store, COALESCE(SUM(ib.quantity), 0) AS tags
         FROM stores s
         LEFT JOIN inventory_balance ib ON ib.store_id = s.store_id
         WHERE s.merchant_id = $1 AND s.status = 'Active'
         ${scoped ? 'AND s.store_id = ANY($2::uuid[])' : ''}
         GROUP BY s.store_id, s.location
         ORDER BY s.location`,
        balanceParams
      ),
      pool.query(
        `WITH today_deltas AS (
           SELECT t.to_store_id AS store_id, t.qty AS delta
           FROM transactions t
           JOIN variants v ON v.variant_id = t.variant_id
           JOIN products p ON p.product_id = v.product_id
           WHERE p.merchant_id = $1 AND t.created_at >= $2 AND t.to_store_id IS NOT NULL
           UNION ALL
           SELECT t.from_store_id AS store_id, -t.qty AS delta
           FROM transactions t
           JOIN variants v ON v.variant_id = t.variant_id
           JOIN products p ON p.product_id = v.product_id
           WHERE p.merchant_id = $1 AND t.created_at >= $2 AND t.from_store_id IS NOT NULL
         )
         SELECT store_id, COALESCE(SUM(delta), 0) AS delta
         FROM today_deltas
         ${scoped ? 'WHERE store_id = ANY($3::uuid[])' : ''}
         GROUP BY store_id`,
        deltaParams
      ),
    ]);

    const deltaByStoreId = {};
    for (const row of deltaResult.rows) {
      deltaByStoreId[row.store_id] = Number(row.delta);
    }

    // Only need name->id for the stores this user can already see.
    const storesResult = await pool.query(
      `SELECT store_id, location FROM stores WHERE merchant_id = $1 AND status = 'Active' ${scoped ? 'AND store_id = ANY($2::uuid[])' : ''}`,
      scoped ? [req.user.merchant_id, req.storeIds] : [req.user.merchant_id]
    );
    const storeIdByName = {};
    for (const s of storesResult.rows) storeIdByName[s.location] = s.store_id;

    res.json(
      balanceResult.rows.map((r) => ({
        store: r.store,
        tags: Number(r.tags),
        delta: deltaByStoreId[storeIdByName[r.store]] || 0,
      }))
    );
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// src/server/routes/dashboard.js
router.get('/low-stock', async (req, res) => {
  try {
    const params = [LOW_STOCK_THRESHOLD, req.user.merchant_id];
    let storeClause = '';

    // NEW: Apply store permissions
    if (req.storeIds !== null) {
      params.push(req.storeIds);

      storeClause = `
        AND s.store_id = ANY($3::uuid[])
      `;
    }

    const result = await pool.query(
      `SELECT
          p.product_name,
          v.sku,
          s.location AS store,
          ib.quantity
       FROM inventory_balance ib
       JOIN variants v ON v.variant_id = ib.variant_id
       JOIN products p ON p.product_id = v.product_id
       JOIN stores s ON s.store_id = ib.store_id
       WHERE ib.quantity < $1
         AND p.merchant_id = $2
         ${storeClause}
       ORDER BY ib.quantity ASC
       LIMIT 20`,
      params
    );

    res.json(result.rows.map((r) => ({
      product_name: r.product_name,
      sku: r.sku,
      store: r.store,
      qty: r.quantity,
    })));
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
    const scoped = req.storeIds !== null;
    const trendParams = scoped ? [req.user.merchant_id, req.storeIds] : [req.user.merchant_id];
    const splitParams = scoped ? [req.user.merchant_id, req.storeIds] : [req.user.merchant_id];
    const byStoreParams = scoped ? [req.user.merchant_id, req.storeIds] : [req.user.merchant_id];

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
             ${scoped ? 'AND (t.to_store_id = ANY($2::uuid[]) OR t.from_store_id = ANY($2::uuid[]))' : ''}
         )
         SELECT
           days.day,
           COALESCE(SUM(CASE WHEN merchant_tx.transaction_type = 'RECEIVE' THEN merchant_tx.qty END), 0) AS stock_in,
           COALESCE(SUM(CASE WHEN merchant_tx.transaction_type = 'CHECKOUT' THEN merchant_tx.qty END), 0) AS stock_out
         FROM days
         LEFT JOIN merchant_tx ON merchant_tx.day = days.day
         GROUP BY days.day
         ORDER BY days.day`,
        trendParams
      ),
      pool.query(
        `SELECT
           COALESCE(SUM(CASE WHEN t.transaction_type = 'RECEIVE' THEN t.qty END), 0) AS stock_in,
           COALESCE(SUM(CASE WHEN t.transaction_type = 'CHECKOUT' THEN t.qty END), 0) AS stock_out
         FROM transactions t
         JOIN variants v ON v.variant_id = t.variant_id
         JOIN products p ON p.product_id = v.product_id
         WHERE p.merchant_id = $1 AND t.created_at >= CURRENT_DATE - INTERVAL '6 days'
         ${scoped ? 'AND (t.to_store_id = ANY($2::uuid[]) OR t.from_store_id = ANY($2::uuid[]))' : ''}`,
        splitParams
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
         ${scoped ? 'AND s.store_id = ANY($2::uuid[])' : ''}
         GROUP BY s.store_id, s.location
         ORDER BY s.location`,
        byStoreParams
      ),
    ]);

    res.json({
      trend: trendResult.rows.map((r) => ({ day: r.day, stock_in: Number(r.stock_in), stock_out: Number(r.stock_out) })),
      split: { stockIn: Number(splitResult.rows[0].stock_in), stockOut: Number(splitResult.rows[0].stock_out) },
      byStore: byStoreResult.rows.map((r) => ({ store_id: r.store_id, store: r.store, stock_in: Number(r.stock_in), stock_out: Number(r.stock_out) })),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;