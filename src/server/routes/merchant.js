import express from 'express';
import pool from '../db.js';

const router = express.Router();

// GET the logged-in merchant's own record (business_name, status, expiry_date, etc.)
router.get('/me', async (req, res) => {
  if (!req.user.merchant_id) {
    return res.status(404).json({ message: 'No merchant associated with this account.' });
  }
  try {
    const result = await pool.query(
      'SELECT merchant_id, business_name, email, phone, status, expiry_date, created_at FROM merchants WHERE merchant_id = $1',
      [req.user.merchant_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Merchant not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;