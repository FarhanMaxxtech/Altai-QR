import express from 'express';
import pool from '../db.js';

const router = express.Router();

// GET all groups for this merchant
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM product_groups WHERE merchant_id = $1 ORDER BY created_at DESC',
      [req.user.merchant_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET summary for a scanned group QR code — every product/variant in the
// group, with their current stock breakdown per store.
router.get('/lookup', async (req, res) => {
  const qr_value = req.query.qr_value?.trim();
  if (!qr_value) return res.status(400).json({ message: 'qr_value is required.' });

  try {
    const groupResult = await pool.query(
      'SELECT * FROM product_groups WHERE group_qr_code = $1 AND merchant_id = $2',
      [qr_value, req.user.merchant_id]
    );
    if (groupResult.rows.length === 0) {
      return res.status(404).json({ message: 'No group found for this code.' });
    }
    const group = groupResult.rows[0];

    const productsResult = await pool.query(
      'SELECT * FROM products WHERE group_id = $1 AND merchant_id = $2',
      [group.group_id, req.user.merchant_id]
    );

    const variantsResult = await pool.query(
      `SELECT v.* FROM variants v
       JOIN products p ON p.product_id = v.product_id
       WHERE p.group_id = $1`,
      [group.group_id]
    );

    const statsResult = await pool.query(
      `SELECT qc.variant_id, qc.status, qc.current_store_id, COUNT(*) AS cnt
       FROM qr_codes qc
       JOIN variants v ON v.variant_id = qc.variant_id
       JOIN products p ON p.product_id = v.product_id
       WHERE p.group_id = $1
       GROUP BY qc.variant_id, qc.status, qc.current_store_id`,
      [group.group_id]
    );

    const statsByVariant = {};
    for (const row of statsResult.rows) {
      if (!statsByVariant[row.variant_id]) {
        statsByVariant[row.variant_id] = { assigned_unit_count: 0, in_stock_count: 0, balances: {} };
      }
      const stat = statsByVariant[row.variant_id];
      stat.assigned_unit_count += Number(row.cnt);
      if (row.status === 'in_stock') {
        stat.in_stock_count += Number(row.cnt);
        if (row.current_store_id) {
          stat.balances[row.current_store_id] = (stat.balances[row.current_store_id] || 0) + Number(row.cnt);
        }
      }
    }

    const products = productsResult.rows.map((product) => ({
      ...product,
      variants: variantsResult.rows
        .filter((v) => v.product_id === product.product_id)
        .map((v) => ({ ...v, ...(statsByVariant[v.variant_id] || { assigned_unit_count: 0, in_stock_count: 0, balances: {} }) })),
    }));

    res.json({ ...group, products });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST create a group and assign selected products to it in one step
router.post('/', async (req, res) => {
  const { group_name, group_color, group_qr_code, product_ids } = req.body;

  if (!group_name || !Array.isArray(product_ids) || product_ids.length < 2) {
    return res.status(400).json({ message: 'group_name and at least 2 product_ids are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Guard rail: block if any selected product already belongs to a
    // different group — this is the explicit, friendly-error version of
    // the constraint; the single group_id column already makes it
    // structurally impossible either way.
    const conflictCheck = await client.query(
      `SELECT product_id, product_name FROM products
       WHERE product_id = ANY($1::uuid[]) AND merchant_id = $2 AND group_id IS NOT NULL`,
      [product_ids, req.user.merchant_id]
    );
    if (conflictCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      const names = conflictCheck.rows.map((r) => r.product_name).join(', ');
      return res.status(409).json({ message: `Already in another group: ${names}` });
    }

    const groupResult = await client.query(
      `INSERT INTO product_groups (merchant_id, group_name, group_color, group_qr_code)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.merchant_id, group_name, group_color || null, group_qr_code || null]
    );
    const group = groupResult.rows[0];

    await client.query(
      `UPDATE products SET group_id = $1 WHERE product_id = ANY($2::uuid[]) AND merchant_id = $3`,
      [group.group_id, product_ids, req.user.merchant_id]
    );

    await client.query('COMMIT');
    res.status(201).json(group);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

export default router;