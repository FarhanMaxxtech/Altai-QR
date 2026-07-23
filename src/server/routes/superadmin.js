import express from 'express';
import bcrypt from 'bcrypt';
import pool from '../db.js';

const router = express.Router();

// GET all merchants
router.get('/merchants', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM merchants ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST create a merchant AND its first admin login account together —
// this is now the only way a merchant account gets created, since public
// self-registration is gone (B2B model: Super Admin onboards every merchant).
// POST create a merchant AND its first admin login account together —
// this is now the only way a merchant account gets created, since public
// self-registration is gone (B2B model: Super Admin onboards every merchant).
router.post('/merchants', async (req, res) => {
  const { business_name, email, phone, password, expiry_date } = req.body;

  if (!business_name || !email || !password) {
    return res.status(400).json({ message: 'Business name, email, and password are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT user_id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'This email is already registered.' });
    }

    const merchantResult = await client.query(
      `INSERT INTO merchants (business_name, email, phone, status, expiry_date)
       VALUES ($1, $2, $3, 'Active', $4) RETURNING *`,
      [business_name, email, phone || null, expiry_date || null]
    );
    const merchant = merchantResult.rows[0];

    const passwordHash = await bcrypt.hash(password, 10);
    await client.query(
      `INSERT INTO users (name, email, password_hash, role, merchant_id)
       VALUES ($1, $2, $3, 'admin', $4)`,
      [business_name, email, passwordHash, merchant.merchant_id]
    );

    await client.query('COMMIT');
    res.status(201).json(merchant);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

// PUT toggle a merchant's status (Active / Suspended)
router.put('/merchants/:id/status', async (req, res) => {
  const { status } = req.body;
  try {
    const result = await pool.query(
      `UPDATE merchants SET status = $1 WHERE merchant_id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Merchant not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE a merchant
router.delete('/merchants/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Users reference this merchant via merchant_id with no ON DELETE
    // CASCADE — remove them first or the merchant delete below will fail
    // with a foreign key violation.
    await client.query('DELETE FROM users WHERE merchant_id = $1', [req.params.id]);

    const result = await client.query(
      'DELETE FROM merchants WHERE merchant_id = $1 RETURNING merchant_id',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Merchant not found.' });
    }

    await client.query('COMMIT');
    res.status(204).send();
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23503') {
      return res.status(409).json({
        message: 'This merchant still has related data (products, stores, etc.) that must be removed first.',
      });
    }
    res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

// GET platform-wide stats for PlatformDashboard.jsx
router.get('/stats', async (req, res) => {
  try {
    const [merchants, products, stores, users] = await Promise.all([
      pool.query('SELECT status FROM merchants'),
      pool.query('SELECT COUNT(*) FROM products'),
      pool.query('SELECT COUNT(*) FROM stores'),
      pool.query('SELECT COUNT(*) FROM users'),
    ]);

    const total_merchants = merchants.rows.length;
    const active_merchants = merchants.rows.filter((m) => m.status === 'Active').length;
    const suspended_merchants = merchants.rows.filter((m) => m.status === 'Suspended').length;

    res.json({
      total_merchants,
      active_merchants,
      suspended_merchants,
      total_products: Number(products.rows[0].count),
      total_stores: Number(stores.rows[0].count),
      total_users: Number(users.rows[0].count),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;