import express from 'express';
import pool from '../db.js';
import { buildPresetPermissions, permissionsToModuleList } from '../utils/permissionPresets.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const isSuperAdmin = req.user.role === 'super_admin';
    const conditions = ["u.status = 'Active'"];
    const params = [];

    if (!isSuperAdmin) {
      params.push(req.user.merchant_id);
      conditions.push(`u.merchant_id = $${params.length}`);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const result = await pool.query(
      `SELECT u.user_id, u.name, u.email, u.role, u.phone, u.profile_picture,
              u.modules, u.permissions, u.permission_preset, u.merchant_id,
              u.created_at, u.last_seen, u.expiry_date,
              COALESCE(array_agg(usa.store_id) FILTER (WHERE usa.store_id IS NOT NULL), '{}') AS store_ids
      FROM users u
      LEFT JOIN user_store_access usa ON usa.user_id = u.user_id
      ${whereClause}
      GROUP BY u.user_id
      ORDER BY u.created_at DESC`,
      params
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/:id/expiry', async (req, res) => {
  const { expiry_date } = req.body;
  const isSuperAdmin = req.user.role === 'super_admin';
  try {
    const result = isSuperAdmin
      ? await pool.query(
          `UPDATE users SET expiry_date = $2 WHERE user_id = $1 RETURNING user_id, expiry_date`,
          [req.params.id, expiry_date || null]
        )
      : await pool.query(
          `UPDATE users SET expiry_date = $3 WHERE user_id = $1 AND merchant_id = $2 RETURNING user_id, expiry_date`,
          [req.params.id, req.user.merchant_id, expiry_date || null]
        );
    if (result.rows.length === 0) return res.status(404).json({ message: 'User not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Soft delete — "removing" a user never drops the row (audit trail on
// transactions/QR batches still references it). This just flips status to
// Inactive; the GET / route filters these out so they disappear from the
// UI exactly like before.
router.delete('/:id', async (req, res) => {
  try {
    const result = req.user.role === 'super_admin'
      ? await pool.query(
          `UPDATE users SET status = 'Inactive' WHERE user_id = $1 RETURNING user_id`,
          [req.params.id]
        )
      : await pool.query(
          `UPDATE users SET status = 'Inactive' WHERE user_id = $1 AND merchant_id = $2 RETURNING user_id`,
          [req.params.id, req.user.merchant_id]
        );

    if (result.rows.length === 0) return res.status(404).json({ message: 'User not found.' });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT apply a permission preset — recomputes the full permissions map from
// scratch (any per-cell overrides are reset).
router.put('/:id/preset', async (req, res) => {
  const { preset } = req.body;
  if (!preset) return res.status(400).json({ message: 'preset is required.' });

  const permissions = buildPresetPermissions(preset);
  const modules = permissionsToModuleList(permissions);
  const isSuperAdmin = req.user.role === 'super_admin';

  try {
    const result = isSuperAdmin
      ? await pool.query(
          `UPDATE users SET permission_preset = $2, permissions = $3::jsonb, modules = $4::jsonb
           WHERE user_id = $1
           RETURNING user_id, permission_preset, permissions, modules`,
          [req.params.id, preset, JSON.stringify(permissions), JSON.stringify(modules)]
        )
      : await pool.query(
          `UPDATE users SET permission_preset = $3, permissions = $4::jsonb, modules = $5::jsonb
           WHERE user_id = $1 AND merchant_id = $2
           RETURNING user_id, permission_preset, permissions, modules`,
          [req.params.id, req.user.merchant_id, preset, JSON.stringify(permissions), JSON.stringify(modules)]
        );

    if (result.rows.length === 0) return res.status(404).json({ message: 'User not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT grant/revoke a single module+action cell — "click a cell to grant or
// revoke". Clears permission_preset since the result no longer matches a
// clean preset once a cell has been hand-edited.
// PUT replace a user's full permissions map in one call — used by the
// "Save permissions" button. Saves everything staged at once, and clears
// permission_preset if the caller passes null (edits no longer match a preset).
router.put('/:id/permissions', async (req, res) => {
  const { permissions, permission_preset } = req.body;
  if (!permissions || typeof permissions !== 'object') {
    return res.status(400).json({ message: 'permissions object is required.' });
  }
  const modules = permissionsToModuleList(permissions);
  const isSuperAdmin = req.user.role === 'super_admin';

  try {
    const result = isSuperAdmin
      ? await pool.query(
          `UPDATE users SET permissions = $2::jsonb, modules = $3::jsonb, permission_preset = $4
           WHERE user_id = $1
           RETURNING user_id, permissions, modules, permission_preset`,
          [req.params.id, JSON.stringify(permissions), JSON.stringify(modules), permission_preset || null]
        )
      : await pool.query(
          `UPDATE users SET permissions = $3::jsonb, modules = $4::jsonb, permission_preset = $5
           WHERE user_id = $1 AND merchant_id = $2
           RETURNING user_id, permissions, modules, permission_preset`,
          [req.params.id, req.user.merchant_id, JSON.stringify(permissions), JSON.stringify(modules), permission_preset || null]
        );

    if (result.rows.length === 0) return res.status(404).json({ message: 'User not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT replace a user's full store-access list in one call — used both for
// single toggles (frontend sends the whole next array) and Select all/Clear all.
router.put('/:id/stores', async (req, res) => {
  const { store_ids } = req.body;
  if (!Array.isArray(store_ids)) return res.status(400).json({ message: 'store_ids must be an array.' });
  const isSuperAdmin = req.user.role === 'super_admin';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ownership = await client.query(
      isSuperAdmin
        ? 'SELECT user_id FROM users WHERE user_id = $1'
        : 'SELECT user_id FROM users WHERE user_id = $1 AND merchant_id = $2',
      isSuperAdmin ? [req.params.id] : [req.params.id, req.user.merchant_id]
    );
    if (ownership.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'User not found.' });
    }

    await client.query('DELETE FROM user_store_access WHERE user_id = $1', [req.params.id]);
    if (store_ids.length > 0) {
      await client.query(
        `INSERT INTO user_store_access (user_id, store_id) SELECT $1, unnest($2::uuid[])`,
        [req.params.id, store_ids]
      );
    }

    await client.query('COMMIT');
    res.json({ store_ids });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

export default router;