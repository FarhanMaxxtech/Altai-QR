import express from 'express';
import { randomInt } from 'node:crypto';
import pool from '../db.js';
import { requireModulePermission } from '../middleware/modulePermission.js';
import { deriveBundleStockState, resolveBundleCode } from '../utils/bundleGuard.js';

const router = express.Router();
const MODULE = 'Agent / Distributor';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeBundleCode() {
  let suffix = '';
  for (let i = 0; i < 10; i += 1) {
    suffix += randomInt(36).toString(36).toUpperCase();
  }
  return `GID-${suffix}`;
}

function requestError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function friendlyQrStatus(status, storeName) {
  if (status === 'pending') return 'Awaiting stock-in';
  if (status === 'in_stock') return `In stock${storeName ? ` · ${storeName}` : ''}`;
  if (status === 'checked_out') return 'Stocked out';
  if (status === 'damage_pending' || status === 'cycle_count_pending') return 'Awaiting approval';
  if (status === 'damaged') return 'Damaged';
  if (status === 'cycle_adjusted') return 'Adjusted out';
  return status;
}

function validDate(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function loadBundleItems(queryable, bundleId, merchantId, bundleStatus, agentName) {
  const result = await queryable.query(
    `SELECT qc.qr_batch, qc.label_id, qc.qr_id, qc.status,
            qc.current_store_id, cs.location AS current_store_name
     FROM qr_bundle_items qbi
     JOIN qr_codes qc ON qc.qr_batch = qbi.qr_batch
     JOIN qr_bundles b ON b.bundle_id = qbi.bundle_id
     LEFT JOIN stores cs ON cs.store_id = qc.current_store_id
     WHERE qbi.bundle_id = $1 AND b.merchant_id = $2
     ORDER BY qc.label_id`,
    [bundleId, merchantId]
  );
  return result.rows.map((item) => ({
    ...item,
    friendly_status: bundleStatus === 'assigned'
      ? `Assigned to ${agentName || 'agent'}`
      : friendlyQrStatus(item.status, item.current_store_name),
  }));
}

router.post('/', requireModulePermission(MODULE, 'create'), async (req, res) => {
  const { variant_id, qr_ids, remarks, expiry_date } = req.body;
  if (!UUID_PATTERN.test(variant_id || '')) {
    return res.status(400).json({ message: 'A valid variant_id is required.' });
  }
  if (!Array.isArray(qr_ids) || qr_ids.length === 0 || qr_ids.some((id) => !UUID_PATTERN.test(id))) {
    return res.status(400).json({ message: 'qr_ids must be a non-empty array of QR batch ids.' });
  }
  if (new Set(qr_ids).size !== qr_ids.length) {
    return res.status(400).json({ message: 'qr_ids must not contain duplicates.' });
  }
  if (!validDate(expiry_date)) return res.status(400).json({ message: 'expiry_date must use YYYY-MM-DD format.' });

  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;

    const variantResult = await client.query(
      `SELECT v.variant_id, v.sku, v.attributes, p.product_name
       FROM variants v
       JOIN products p ON p.product_id = v.product_id
       WHERE v.variant_id = $1 AND v.merchant_id = $2
       FOR SHARE OF v`,
      [variant_id, req.user.merchant_id]
    );
    if (variantResult.rows.length === 0) {
      throw requestError(404, 'The selected variant does not belong to this merchant.');
    }
    const variant = variantResult.rows[0];

    const codesResult = await client.query(
      `SELECT qc.qr_batch, qc.label_id, qc.variant_id, qc.status, qc.pending_variant_id
       FROM qr_codes qc
       JOIN users u ON u.user_id = qc.assigned_user_id
       WHERE qc.qr_batch = ANY($1::uuid[]) AND u.merchant_id = $2
       ORDER BY qc.qr_batch
       FOR UPDATE OF qc`,
      [qr_ids, req.user.merchant_id]
    );
    const codesById = new Map(codesResult.rows.map((row) => [row.qr_batch, row]));
    const bundledResult = await client.query(
      `SELECT qbi.qr_batch
       FROM qr_bundle_items qbi
       JOIN qr_bundles b ON b.bundle_id = qbi.bundle_id
       WHERE qbi.qr_batch = ANY($1::uuid[]) AND b.merchant_id = $2`,
      [qr_ids, req.user.merchant_id]
    );
    const bundledIds = new Set(bundledResult.rows.map((row) => row.qr_batch));
    const invalid = [];

    qr_ids.forEach((id) => {
      const code = codesById.get(id);
      if (!code) {
        invalid.push(`${id} (not found in this merchant)`);
        return;
      }
      const reasons = [];
      if (code.variant_id !== variant_id) reasons.push('different variant');
      if (code.status !== 'pending') reasons.push(`status ${code.status}`);
      if (code.pending_variant_id) reasons.push('has a pending variant change');
      if (bundledIds.has(id)) reasons.push('already belongs to a bundle');
      if (reasons.length) invalid.push(`${code.label_id} (${reasons.join(', ')})`);
    });

    if (invalid.length) {
      throw requestError(409, `Cannot create bundle. Fix these codes: ${invalid.join('; ')}.`);
    }

    let bundle;
    for (let attempt = 0; attempt < 5 && !bundle; attempt += 1) {
      const result = await client.query(
        `INSERT INTO qr_bundles
           (merchant_id, bundle_code, variant_id, qty, remarks, expiry_date, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (bundle_code) DO NOTHING
         RETURNING *`,
        [
          req.user.merchant_id,
          makeBundleCode(),
          variant_id,
          qr_ids.length,
          typeof remarks === 'string' ? remarks.trim() || null : null,
          expiry_date || null,
          req.user.user_id,
        ]
      );
      bundle = result.rows[0];
    }
    if (!bundle) throw requestError(500, 'Could not generate a unique bundle code. Please retry.');

    await client.query(
      `INSERT INTO qr_bundle_items (bundle_id, qr_batch)
       SELECT $1, unnest($2::uuid[])`,
      [bundle.bundle_id, qr_ids]
    );
    await client.query('COMMIT');
    transactionOpen = false;

    const items = codesResult.rows.map(({ qr_batch, label_id }) => ({ qr_batch, label_id }));
    return res.status(201).json({
      ...bundle,
      sku: variant.sku,
      product_name: variant.product_name,
      attributes: variant.attributes,
      label_ids: items.map((item) => item.label_id),
      items,
    });
  } catch (err) {
    if (transactionOpen) await client.query('ROLLBACK');
    return res.status(err.status || 500).json({ message: err.message });
  } finally {
    client.release();
  }
});

router.get('/', requireModulePermission(MODULE, 'view'), async (req, res) => {
  const { status, agent_id, from_date, to_date, search } = req.query;
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
  if (status && !['active', 'assigned', 'voided'].includes(status)) {
    return res.status(400).json({ message: 'Invalid bundle status.' });
  }
  if (agent_id && !UUID_PATTERN.test(agent_id)) return res.status(400).json({ message: 'Invalid agent_id.' });
  if (!validDate(from_date) || !validDate(to_date)) {
    return res.status(400).json({ message: 'Date filters must use YYYY-MM-DD format.' });
  }

  const params = [req.user.merchant_id];
  const conditions = ['b.merchant_id = $1'];
  const addCondition = (sql, value) => {
    params.push(value);
    conditions.push(sql.replace('?', `$${params.length}`));
  };
  if (status) addCondition('b.status = ?', status);
  if (agent_id) addCondition('b.agent_id = ?', agent_id);
  if (from_date) addCondition('b.created_at::date >= ?::date', from_date);
  if (to_date) addCondition('b.created_at::date <= ?::date', to_date);
  if (search?.trim()) {
    params.push(`%${search.trim()}%`);
    const index = params.length;
    conditions.push(`(b.bundle_code ILIKE $${index} OR v.sku ILIKE $${index} OR p.product_name ILIKE $${index} OR a.name ILIKE $${index})`);
  }
  const where = conditions.join(' AND ');

  try {
    const [countResult, bundleResult, summaryResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM qr_bundles b
         JOIN variants v ON v.variant_id = b.variant_id
         JOIN products p ON p.product_id = v.product_id
         LEFT JOIN agents a ON a.agent_id = b.agent_id AND a.merchant_id = b.merchant_id
         WHERE ${where}`,
        params
      ),
      pool.query(
        `SELECT b.bundle_id, b.bundle_code, b.qty, b.status, b.created_at, b.assigned_at,
                b.remarks, b.expiry_date, b.agent_id, a.name AS agent_name,
                v.sku, v.attributes, p.product_name
         FROM qr_bundles b
         JOIN variants v ON v.variant_id = b.variant_id
         JOIN products p ON p.product_id = v.product_id
         LEFT JOIN agents a ON a.agent_id = b.agent_id AND a.merchant_id = b.merchant_id
         WHERE ${where}
         ORDER BY b.created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, (page - 1) * limit]
      ),
      agent_id
        ? pool.query(
          `SELECT COUNT(*)::int AS assigned_bundles,
                  COALESCE(SUM(qty), 0)::int AS total_units
           FROM qr_bundles
           WHERE merchant_id = $1 AND agent_id = $2 AND status = 'assigned'`,
          [req.user.merchant_id, agent_id]
        )
        : Promise.resolve({ rows: [{ assigned_bundles: 0, total_units: 0 }] }),
    ]);

    const bundles = await Promise.all(bundleResult.rows.map(async (bundle) => {
      const items = await loadBundleItems(pool, bundle.bundle_id, req.user.merchant_id, bundle.status, bundle.agent_name);
      const derived = deriveBundleStockState(items.map((item) => item.status));
      const canAssign = bundle.status !== 'voided'
        && ['active', 'assigned'].includes(bundle.status)
        && items.every((item) => item.status === 'pending');
      const lockReason = bundle.status === 'voided'
        ? 'This bundle has been voided.'
        : !canAssign
          ? 'This bundle has already been stocked in and cannot be assigned to an agent.'
          : '';
      return { ...bundle, ...derived, can_assign: canAssign, lock_reason: lockReason };
    }));

    return res.json({
      bundles,
      total: countResult.rows[0].total,
      page,
      limit,
      summary: summaryResult.rows[0],
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.get('/lookup', requireModulePermission(MODULE, 'view'), async (req, res) => {
  const code = String(req.query.code || '').trim();
  if (!code) return res.status(400).json({ message: 'code is required.' });
  try {
    const resolved = await resolveBundleCode(pool, req.user.merchant_id, code);
    if (!resolved) return res.status(404).json({ message: 'Bundle not found.' });
    const bundle = resolved.bundle;
    const items = await loadBundleItems(pool, bundle.bundle_id, req.user.merchant_id, bundle.status, bundle.agent_name);
    const derived = deriveBundleStockState(items.map((item) => item.status));
    const canAssign = bundle.status !== 'voided'
      && ['active', 'assigned'].includes(bundle.status)
      && items.every((item) => item.status === 'pending');
    const lockReason = !canAssign
      ? (bundle.status === 'voided' ? 'This bundle has been voided.' : 'This bundle has already been stocked in and cannot be assigned to an agent.')
      : '';
    const blocked = bundle.status !== 'active';
    const message = bundle.status === 'assigned'
      ? `This bundle is assigned to agent/distributor ${bundle.agent_name || 'an agent'} and cannot be used for stock actions.`
      : bundle.status === 'voided'
        ? 'This bundle is voided and cannot be used for stock actions.'
        : null;
    return res.json({ ...bundle, ...derived, items, can_assign: canAssign, lock_reason: lockReason, blocked_for_stock_actions: blocked, message });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.get('/:id', requireModulePermission(MODULE, 'view'), async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ message: 'Invalid bundle id.' });
  try {
    const result = await pool.query(
      `SELECT b.*, v.sku, v.attributes, p.product_name, a.name AS agent_name
       FROM qr_bundles b
       JOIN variants v ON v.variant_id = b.variant_id
       JOIN products p ON p.product_id = v.product_id
       LEFT JOIN agents a ON a.agent_id = b.agent_id AND a.merchant_id = b.merchant_id
       WHERE b.bundle_id = $1 AND b.merchant_id = $2`,
      [req.params.id, req.user.merchant_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Bundle not found.' });
    const bundle = result.rows[0];
    const items = await loadBundleItems(pool, req.params.id, req.user.merchant_id, bundle.status, bundle.agent_name);
    const derived = deriveBundleStockState(items.map((item) => item.status));
    const canAssign = bundle.status !== 'voided'
      && ['active', 'assigned'].includes(bundle.status)
      && items.every((item) => item.status === 'pending');
    const lockReason = !canAssign
      ? (bundle.status === 'voided' ? 'This bundle has been voided.' : 'This bundle has already been stocked in and cannot be assigned to an agent.')
      : '';
    return res.json({ ...bundle, ...derived, items, can_assign: canAssign, lock_reason: lockReason });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.put('/:id/assign', requireModulePermission(MODULE, 'edit'), async (req, res) => {
  const { agent_id } = req.body;
  if (!UUID_PATTERN.test(req.params.id) || !UUID_PATTERN.test(agent_id || '')) {
    return res.status(400).json({ message: 'Valid bundle and agent ids are required.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bundleResult = await client.query(
      `SELECT b.status
       FROM qr_bundles b
       WHERE b.bundle_id = $1 AND b.merchant_id = $2
       FOR UPDATE`,
      [req.params.id, req.user.merchant_id]
    );
    if (bundleResult.rows.length === 0) throw requestError(404, 'An active bundle was not found.');
    if (bundleResult.rows[0].status === 'voided') throw requestError(409, 'A voided bundle cannot be assigned to an agent.');
    const memberResult = await client.query(
      `SELECT qc.status
       FROM qr_bundle_items qbi
       JOIN qr_codes qc ON qc.qr_batch = qbi.qr_batch
       WHERE qbi.bundle_id = $1`,
      [req.params.id]
    );
    if (memberResult.rows.length === 0 || memberResult.rows.some((row) => row.status !== 'pending')) {
      throw requestError(409, 'This bundle has already been stocked in and cannot be assigned to an agent.');
    }
    const agentResult = await client.query(
      `SELECT agent_id, name FROM agents
       WHERE agent_id = $1 AND merchant_id = $2 AND status = 'Active'
       FOR SHARE`,
      [agent_id, req.user.merchant_id]
    );
    if (agentResult.rows.length === 0) throw requestError(400, 'Select an active agent belonging to this merchant.');
    const result = await client.query(
      `UPDATE qr_bundles
       SET status = 'assigned', agent_id = $1, assigned_at = now(), assigned_by = $2
       WHERE bundle_id = $3 AND merchant_id = $4 AND status IN ('active', 'assigned')
       RETURNING *`,
      [agent_id, req.user.user_id, req.params.id, req.user.merchant_id]
    );
    if (result.rows.length === 0) throw requestError(404, 'An active bundle was not found.');
    await client.query('COMMIT');
    return res.json({ ...result.rows[0], agent_name: agentResult.rows[0].name });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(err.status || 500).json({ message: err.message });
  } finally {
    client.release();
  }
});

router.delete('/:id', requireModulePermission(MODULE, 'edit'), async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ message: 'Invalid bundle id.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bundleResult = await client.query(
      `SELECT bundle_id, bundle_code, status
       FROM qr_bundles
       WHERE bundle_id = $1 AND merchant_id = $2
       FOR UPDATE`,
      [req.params.id, req.user.merchant_id]
    );
    if (bundleResult.rows.length === 0) throw requestError(404, 'Bundle not found.');
    const bundle = bundleResult.rows[0];
    if (bundle.status === 'voided') throw requestError(409, 'Bundle is already voided.');
    const memberResult = await client.query(
      `SELECT qc.status
       FROM qr_bundle_items qbi
       JOIN qr_codes qc ON qc.qr_batch = qbi.qr_batch
       WHERE qbi.bundle_id = $1
       FOR UPDATE OF qc`,
      [bundle.bundle_id]
    );
    if (memberResult.rows.length === 0 || memberResult.rows.some((row) => row.status !== 'pending')) {
      throw requestError(409, 'Bundle already stocked in and cannot be removed.');
    }
    await client.query('DELETE FROM qr_bundle_items WHERE bundle_id = $1', [bundle.bundle_id]);
    await client.query(
      `UPDATE qr_bundles
       SET status = 'voided', agent_id = NULL, assigned_at = NULL
       WHERE bundle_id = $1`,
      [bundle.bundle_id]
    );
    await client.query('COMMIT');
    return res.json({ bundle_id: bundle.bundle_id, bundle_code: bundle.bundle_code, status: 'voided', released: true });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(err.status || 500).json({ message: err.message });
  } finally {
    client.release();
  }
});

router.put('/:id/unassign', requireModulePermission(MODULE, 'edit'), async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ message: 'Invalid bundle id.' });
  try {
    const result = await pool.query(
      `UPDATE qr_bundles
       SET status = 'active', agent_id = NULL, assigned_at = NULL
       WHERE bundle_id = $1 AND merchant_id = $2 AND status = 'assigned'
       RETURNING *`,
      [req.params.id, req.user.merchant_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Assigned bundle not found.' });
    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

export default router;
