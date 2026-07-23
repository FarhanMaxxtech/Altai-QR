import express from 'express';
import pool from '../db.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    // Super Admin can see everyone (needed for QRGenerator's merchant picker);
    // everyone else only sees their own merchant's staff.
    const result = req.user.role === 'super_admin'
      ? await pool.query(
          `SELECT user_id, name, email, role, phone, profile_picture, modules, merchant_id, created_at
           FROM users ORDER BY created_at DESC`
        )
      : await pool.query(
          `SELECT user_id, name, email, role, phone, profile_picture, modules, merchant_id, created_at
           FROM users WHERE merchant_id = $1 ORDER BY created_at DESC`,
          [req.user.merchant_id]
        );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = req.user.role === 'super_admin'
      ? await pool.query('DELETE FROM users WHERE user_id = $1 RETURNING user_id', [req.params.id])
      : await pool.query(
          'DELETE FROM users WHERE user_id = $1 AND merchant_id = $2 RETURNING user_id',
          [req.params.id, req.user.merchant_id]
        );

    if (result.rows.length === 0) return res.status(404).json({ message: 'User not found.' });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;