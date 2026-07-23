import express from 'express';
import pool from '../db.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const productsResult = await pool.query(
      'SELECT * FROM products WHERE merchant_id = $1 ORDER BY created_at DESC',
      [req.user.merchant_id]
    );
    const variantsResult = await pool.query(
      `SELECT v.* FROM variants v
       JOIN products p ON p.product_id = v.product_id
       WHERE p.merchant_id = $1`,
      [req.user.merchant_id]
    );

    // Real balance/assignment stats now come from qr_codes — one row per
    // physical unit — instead of the old inventory_balance quantity table.
    const qrStatsResult = await pool.query(
      `SELECT qc.variant_id, qc.status, qc.current_store_id, COUNT(*) AS cnt
       FROM qr_codes qc
       JOIN variants v ON v.variant_id = qc.variant_id
       JOIN products p ON p.product_id = v.product_id
       WHERE p.merchant_id = $1 AND qc.variant_id IS NOT NULL
       GROUP BY qc.variant_id, qc.status, qc.current_store_id`,
      [req.user.merchant_id]
    );

    const statsByVariant = {};
    for (const row of qrStatsResult.rows) {
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

    const groupsResult = await pool.query(
      'SELECT * FROM product_groups WHERE merchant_id = $1',
      [req.user.merchant_id]
    );
    const groupsById = {};
    for (const g of groupsResult.rows) groupsById[g.group_id] = g;

    const products = productsResult.rows.map((product) => ({
      ...product,
      group: product.group_id ? groupsById[product.group_id] : null,
      variants: variantsResult.rows
        .filter((v) => v.product_id === product.product_id)
        .map((v) => {
          const stat = statsByVariant[v.variant_id] || { assigned_unit_count: 0, in_stock_count: 0, balances: {} };
          return { ...v, ...stat };
        }),
    }));

    res.json(products);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const productResult = await pool.query(
      'SELECT * FROM products WHERE product_id = $1 AND merchant_id = $2',
      [req.params.id, req.user.merchant_id]
    );
    if (productResult.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }
    const variantsResult = await pool.query(
      'SELECT * FROM variants WHERE product_id = $1',
      [req.params.id]
    );
    res.json({ ...productResult.rows[0], variants: variantsResult.rows });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/', async (req, res) => {
  const { product_name, product_description, variants } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const productResult = await client.query(
      `INSERT INTO products (product_name, product_description, merchant_id)
       VALUES ($1, $2, $3) RETURNING *`,
      [product_name, product_description || null, req.user.merchant_id]
    );
    const product = productResult.rows[0];

    const insertedVariants = [];
    for (const v of variants) {
      const attributesObject = {};
      for (const attr of v.attributes || []) {
        if (attr.key) attributesObject[attr.key] = attr.value;
      }

      const variantResult = await client.query(
        `INSERT INTO variants (product_id, sku, price, remarks, color, attributes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          product.product_id,
          v.sku,
          v.price || null,
          v.remarks || null,
          v.color || null,
          JSON.stringify(attributesObject),
        ]
      );
      insertedVariants.push(variantResult.rows[0]);
    }

    await client.query('COMMIT');
    res.status(201).json({ ...product, variants: insertedVariants });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

router.put('/:id', async (req, res) => {
  const { product_name, product_description } = req.body;
  try {
    const result = await pool.query(
      `UPDATE products SET product_name=$1, product_description=$2
       WHERE product_id=$3 AND merchant_id=$4 RETURNING *`,
      [product_name, product_description, req.params.id, req.user.merchant_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Product not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM products WHERE product_id=$1 AND merchant_id=$2',
      [req.params.id, req.user.merchant_id]
    );
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;

