import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET; // set this in your .env, never hardcode it

// POST register a new account
router.post('/register', async (req, res) => {
  const { name, email, password, role, phone, profile_picture, modules, expiry_date } = req.body;
  let { merchant_id } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ message: 'Name, email, password, and role are required.' });
  }

  try {
    const existing = await pool.query('SELECT user_id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'Email is already registered.' });
    }

    if (role === 'admin' && !merchant_id) {
      const merchantResult = await pool.query(
        `INSERT INTO merchants (business_name, email)
         VALUES ($1, $2) RETURNING merchant_id`,
        [name, email]
      );
      merchant_id = merchantResult.rows[0].merchant_id;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, merchant_id, phone, profile_picture, modules, expiry_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING user_id, name, email, role, merchant_id, phone, profile_picture, modules, expiry_date, created_at`,
      [name, email, passwordHash, role, merchant_id || null, phone || null, profile_picture || null, JSON.stringify(modules || []), expiry_date || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    // Deliberately vague error on both "no such email" and "wrong password" —
    // confirming which one is wrong tells an attacker whether an email exists.
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    await pool.query('UPDATE users SET last_seen = now() WHERE user_id = $1', [user.user_id]);

    const token = jwt.sign(
      { user_id: user.user_id, role: user.role, merchant_id: user.merchant_id },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: {
        user_id: user.user_id,
        name: user.name,
        email: user.email,
        role: user.role,
        merchant_id: user.merchant_id,
        phone: user.phone,
        profile_picture: user.profile_picture,
        modules: user.modules,
        permissions: user.permissions,
        permission_preset: user.permission_preset,
        expiry_date: user.expiry_date,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET the logged-in user's current record — used on page load/refresh to
// pick up permission or store-access changes without requiring re-login.
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.user_id, u.name, u.email, u.role, u.merchant_id, u.phone,
              u.profile_picture, u.modules, u.permissions, u.permission_preset, u.expiry_date,
              COALESCE(array_agg(usa.store_id) FILTER (WHERE usa.store_id IS NOT NULL), '{}') AS store_ids
      FROM users u
      LEFT JOIN user_store_access usa ON usa.user_id = u.user_id
      WHERE u.user_id = $1
      GROUP BY u.user_id`,
      [req.user.user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;