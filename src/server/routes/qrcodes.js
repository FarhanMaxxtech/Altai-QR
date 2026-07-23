import express from 'express';
import pool from '../db.js';

const router = express.Router();

const TOKEN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function generateRandomToken(length = 8) {
  let token = '';
  for (let i = 0; i < length; i++) {
    token += TOKEN_CHARS[Math.floor(Math.random() * TOKEN_CHARS.length)];
  }
  return token;
}

function formatSerial(n, digits, prefix) {
  const padded = String(n).padStart(digits, '0');
  return prefix ? `${prefix}-${padded}` : padded;
}

// GET all batches, with the merchant's name joined in
router.get('/batches', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.*, u.name AS assigned_user_name
       FROM qrcode_batches b
       JOIN users u ON u.user_id = b.assigned_user_id
       ORDER BY b.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET paginated/filterable batch history — merchant + generated-date filters,
// only ever queried when the user explicitly submits a search (never on
// page load), so we never pull the whole table unnecessarily.
router.get('/batches/search', async (req, res) => {
  const { merchant_id, from_date, to_date, page = 1, limit = 20 } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  const params = [];
  let idx = 1;

  if (merchant_id) {
    conditions.push(`b.assigned_user_id = $${idx++}`);
    params.push(merchant_id);
  }
  if (from_date) {
    conditions.push(`b.created_at::date >= $${idx++}::date`);
    params.push(from_date);
  }
  if (to_date) {
    conditions.push(`b.created_at::date <= $${idx++}::date`);
    params.push(to_date);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM qrcode_batches b ${whereClause}`,
      params
    );
    const total = Number(countResult.rows[0].count);

    const dataParams = [...params, limitNum, offset];
    const result = await pool.query(
      `SELECT b.*, u.name AS assigned_user_name
       FROM qrcode_batches b
       JOIN users u ON u.user_id = b.assigned_user_id
       ${whereClause}
       ORDER BY b.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      dataParams
    );

    res.json({ batches: result.rows, total, page: pageNum, limit: limitNum });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET a single batch's codes (used for re-download)
router.get('/batches/:id/codes', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT serial_number, qr_value FROM qr_codes WHERE batch_id = $1 ORDER BY serial_number',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST generate a new batch — serial numbering is computed here, server-side,
// per merchant, so it's always correct regardless of what any browser has
// cached, and survives refreshes since it's based on real stored rows.
router.post('/batches', async (req, res) => {
  const { company_name, assigned_user_id, quantity, serial_digits, serial_prefix } = req.body;

  if (!company_name || !assigned_user_id || !quantity) {
    return res.status(400).json({ message: 'company_name, assigned_user_id, and quantity are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const countResult = await client.query(
      'SELECT COUNT(*) FROM qr_codes WHERE assigned_user_id = $1',
      [assigned_user_id]
    );
    const startingSerial = Number(countResult.rows[0].count) + 1;
    const digits = Number(serial_digits) || 4;
    const prefix = (serial_prefix || '').trim();
    const fileName = `${company_name}-qr-codes-${Date.now()}.xlsx`;

    const batchResult = await client.query(
      `INSERT INTO qrcode_batches (file_name, company_name, assigned_user_id, quantity, serial_start, serial_end)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        fileName, company_name, assigned_user_id, quantity,
        formatSerial(startingSerial, digits, prefix),
        formatSerial(startingSerial + quantity - 1, digits, prefix),
      ]
    );
    const batch = batchResult.rows[0];

    // Build all rows in memory first — this part is fast, it's pure JS.
    const serials = [];
    const qrValues = [];
    for (let i = 0; i < quantity; i++) {
      serials.push(formatSerial(startingSerial + i, digits, prefix));
      qrValues.push(`${company_name}?${generateRandomToken()}`);
    }

    // One single INSERT for the whole batch — unnest() turns the three
    // parallel arrays into that many rows, in one round trip to the database.
    const codesResult = await client.query(
      `INSERT INTO qr_codes (batch_id, serial_number, qr_value, assigned_user_id)
       SELECT $1, s, q, $2
       FROM unnest($3::text[], $4::text[]) AS t(s, q)
       RETURNING serial_number, qr_value`,
      [batch.batch_id, assigned_user_id, serials, qrValues]
    );

    await client.query('COMMIT');
    res.status(201).json({ ...batch, codes: codesResult.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

// GET this merchant's QR codes that haven't been linked to a product yet
router.get('/unassigned', async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ message: 'user_id is required.' });

  try {
    const result = await pool.query(
      `SELECT qr_id, serial_number, qr_value, created_at
       FROM qr_codes
       WHERE assigned_user_id = $1 AND variant_id IS NULL
       ORDER BY serial_number`,
      [user_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST link a QR code to a specific product variant — this is the step
// that makes scanning it actually mean something.
router.post('/assign-variant', async (req, res) => {
  const { qr_id, variant_id } = req.body;
  if (!qr_id || !variant_id) {
    return res.status(400).json({ message: 'qr_id and variant_id are required.' });
  }

  try {
    const result = await pool.query(
      `UPDATE qr_codes SET variant_id = $1 WHERE qr_id = $2 RETURNING *`,
      [variant_id, qr_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'QR code not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET look up a scanned QR value — returns the product + variant it's
// linked to, or a clear "not assigned yet" message if it hasn't been
// linked to a product on the merchant's side.
router.get('/lookup', async (req, res) => {
  const serial_number = req.query.serial_number?.trim();
  if (!serial_number) return res.status(400).json({ message: 'serial_number is required.' });

  try {
    const result = await pool.query(
      `SELECT qc.serial_number, v.variant_id, v.sku, p.product_id, p.product_name
       FROM qr_codes qc
       JOIN variants v ON v.variant_id = qc.variant_id
       JOIN products p ON p.product_id = v.product_id
       WHERE qc.serial_number = $1`,
      [serial_number]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'This serial number is not linked to any product yet.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET this merchant's batches that still have unassigned codes in them
router.get('/batches/available', async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ message: 'user_id is required.' });

  try {
    const result = await pool.query(
      `SELECT b.batch_id, b.company_name, b.quantity, b.serial_start, b.serial_end,
              COUNT(qc.qr_id) FILTER (WHERE qc.variant_id IS NULL) AS unassigned_count
       FROM qrcode_batches b
       JOIN qr_codes qc ON qc.batch_id = b.batch_id
       WHERE b.assigned_user_id = $1
       GROUP BY b.batch_id
       HAVING COUNT(qc.qr_id) FILTER (WHERE qc.variant_id IS NULL) > 0
       ORDER BY b.created_at DESC`,
      [user_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST link an ENTIRE batch's unassigned codes to one variant in one action
router.post('/batches/:id/assign-variant', async (req, res) => {
  const { variant_id } = req.body;
  if (!variant_id) return res.status(400).json({ message: 'variant_id is required.' });

  try {
    const result = await pool.query(
      `UPDATE qr_codes
       SET variant_id = $1, status = 'pending'
       WHERE batch_id = $2 AND variant_id IS NULL
       RETURNING qr_id`,
      [variant_id, req.params.id]
    );
    res.json({ assigned_count: result.rowCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;