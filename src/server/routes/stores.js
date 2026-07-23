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
  const { location, email, phone, status } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO stores (location, email, phone, status, merchant_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [location, email, phone, status || 'Active', req.user.merchant_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const { location, email, phone, status } = req.body;
  try {
    const result = await pool.query(
      `UPDATE stores SET location=$1, email=$2, phone=$3, status=$4
       WHERE store_id=$5 AND merchant_id=$6 RETURNING *`,
      [location, email, phone, status, req.params.id, req.user.merchant_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Store not found' });
    res.json(result.rows[0]);
  } catch (err) {
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
      // Foreign key violation — this store still has units in it.
      return res.status(409).json({
        message: 'This store still has stock assigned to it. Move or check out all units before removing the store.',
      });
    }
    res.status(500).json({ message: err.message });
  }
});

export default router;