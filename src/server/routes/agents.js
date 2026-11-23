import express from 'express';
import pool from '../db.js';
import { requireModulePermission } from '../middleware/modulePermission.js';

const router = express.Router();
const MODULE = 'Agent / Distributor';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.get('/', requireModulePermission(MODULE, 'view'), async (req, res) => {
  const { status } = req.query;
  if (status && !['Active', 'Inactive'].includes(status)) {
    return res.status(400).json({ message: "status must be 'Active' or 'Inactive'." });
  }

  try {
    const params = [req.user.merchant_id];
    let where = 'merchant_id = $1';
    if (status) {
      params.push(status);
      where += ' AND status = $2';
    }
    const result = await pool.query(
      `SELECT agent_id, name, phone, address, status, created_at
       FROM agents WHERE ${where} ORDER BY lower(name), created_at`,
      params
    );
    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.post('/', requireModulePermission(MODULE, 'create'), async (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ message: 'Agent name is required.' });

  try {
    const result = await pool.query(
      `INSERT INTO agents (merchant_id, name, phone, address)
       VALUES ($1, $2, $3, $4)
       RETURNING agent_id, name, phone, address, status, created_at`,
      [
        req.user.merchant_id,
        name,
        typeof req.body.phone === 'string' ? req.body.phone.trim() || null : null,
        typeof req.body.address === 'string' ? req.body.address.trim() || null : null,
      ]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'An agent with that name already exists.' });
    }
    return res.status(500).json({ message: err.message });
  }
});

router.put('/:id', requireModulePermission(MODULE, 'edit'), async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ message: 'Invalid agent id.' });
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ message: 'Agent name is required.' });

  try {
    const result = await pool.query(
      `UPDATE agents
       SET name = $1, phone = $2, address = $3
       WHERE agent_id = $4 AND merchant_id = $5
       RETURNING agent_id, name, phone, address, status, created_at`,
      [
        name,
        typeof req.body.phone === 'string' ? req.body.phone.trim() || null : null,
        typeof req.body.address === 'string' ? req.body.address.trim() || null : null,
        req.params.id,
        req.user.merchant_id,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Agent not found.' });
    return res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'An agent with that name already exists.' });
    }
    return res.status(500).json({ message: err.message });
  }
});

router.put('/:id/status', requireModulePermission(MODULE, 'edit'), async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ message: 'Invalid agent id.' });
  const { status } = req.body;
  if (!['Active', 'Inactive'].includes(status)) {
    return res.status(400).json({ message: "status must be 'Active' or 'Inactive'." });
  }

  try {
    const result = await pool.query(
      `UPDATE agents SET status = $1
       WHERE agent_id = $2 AND merchant_id = $3
       RETURNING agent_id, name, phone, address, status, created_at`,
      [status, req.params.id, req.user.merchant_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Agent not found.' });
    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.delete('/:id', requireModulePermission(MODULE, 'delete'), async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ message: 'Invalid agent id.' });
  try {
    const result = await pool.query(
      `UPDATE agents SET status = 'Inactive'
       WHERE agent_id = $1 AND merchant_id = $2
       RETURNING agent_id, name, phone, address, status, created_at`,
      [req.params.id, req.user.merchant_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Agent not found.' });
    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

export default router;
