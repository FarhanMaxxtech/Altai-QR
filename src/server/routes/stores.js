import express from 'express';
import pool from '../db.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM stores WHERE merchant_id = $1 ORDER BY created_at',
      [req.user.merchant_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/', async (req, res) => {
  const { location, store_code, type, manager_name, phone, address, opening_hours, status } = req.body;

  if (!location || !store_code || !manager_name) {
    return res.status(400).json({ message: 'Store name, store code, and manager are required.' });
  }

  // email is required by the schema but isn't part of this UI — derive one so
  // the NOT NULL constraint is satisfied without exposing an email field.
  const email = `${store_code.toLowerCase().replace(/[^a-z0-9-]/g, '')}@merchant.internal`;

  try {
    const result = await pool.query(
      `INSERT INTO stores (location, store_code, type, manager_name, email, phone, address, opening_hours, status, merchant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        location, store_code, type || 'Retail', manager_name, email,
        phone || null, address || null, opening_hours || null,
        status || 'Active', req.user.merchant_id,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'That store code is already in use.' });
    }
    res.status(500).json({ message: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const { location, store_code, type, manager_name, phone, address, opening_hours, status } = req.body;
  try {
    const result = await pool.query(
      `UPDATE stores SET location=$1, store_code=$2, type=$3, manager_name=$4,
              phone=$5, address=$6, opening_hours=$7, status=$8
       WHERE store_id=$9 AND merchant_id=$10 RETURNING *`,
      [location, store_code, type, manager_name, phone || null, address || null, opening_hours || null, status, req.params.id, req.user.merchant_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Store not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'That store code is already in use.' });
    }
    res.status(500).json({ message: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM stores WHERE store_id=$1 AND merchant_id=$2',
      [req.params.id, req.user.merchant_id]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'Store not found.' });
    res.status(204).send();
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({
        message: 'This store still has stock assigned to it. Move or check out all units before removing the store.',
      });
    }
    res.status(500).json({ message: err.message });
  }
});

export default router;