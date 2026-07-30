import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../db.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET; // set this in your .env, never hardcode it

// POST register a new account
router.post('/register', async (req, res) => {
  const { name, email, password, role, phone, profile_picture, modules } = req.body;
  let { merchant_id } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ message: 'Name, email, password, and role are required.' });
  }

  try {
    const existing = await pool.query('SELECT user_id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'Email is already registered.' });
    }

    // A merchant admin self-registering has no merchant_id yet — they ARE
    // the merchant, so create their business/tenant record here first.
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
      `INSERT INTO users (name, email, password_hash, role, merchant_id, phone, profile_picture, modules)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING user_id, name, email, role, merchant_id, phone, profile_picture, modules, created_at`,
      [name, email, passwordHash, role, merchant_id || null, phone || null, profile_picture || null, JSON.stringify(modules || [])]
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
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;