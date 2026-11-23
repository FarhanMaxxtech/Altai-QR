export function deriveBundleStockState(memberStatuses) {
  const statuses = (memberStatuses || []).map((status) => status || 'pending');
  if (statuses.length === 0) return { stock_state: 'Partial', label: 'Partial' };
  if (statuses.every((status) => status === 'pending')) return { stock_state: 'Not stocked in', label: 'Not stocked in' };
  if (statuses.every((status) => status === 'in_stock')) return { stock_state: 'In stock', label: 'In stock' };
  if (statuses.every((status) => ['checked_out', 'damaged', 'cycle_adjusted'].includes(status))) {
    return { stock_state: 'Stocked out / closed', label: 'Stocked out / closed' };
  }
  return { stock_state: 'Partial', label: 'Partial' };
}

export async function getBundleMembership(db, qrBatchIds) {
  const ids = [...new Set((qrBatchIds || []).filter(Boolean))];
  const result = new Map();
  if (ids.length === 0) return result;

  const rows = await db.query(
    `SELECT qbi.qr_batch, b.bundle_id, b.bundle_code, b.status AS bundle_status,
            b.agent_id, a.name AS agent_name
     FROM qr_bundle_items qbi
     JOIN qr_bundles b ON b.bundle_id = qbi.bundle_id
     LEFT JOIN agents a ON a.agent_id = b.agent_id AND a.merchant_id = b.merchant_id
     WHERE qbi.qr_batch = ANY($1::uuid[])`,
    [ids]
  );
  rows.rows.forEach((row) => result.set(row.qr_batch, {
    bundle_id: row.bundle_id,
    bundle_code: row.bundle_code,
    bundle_status: row.bundle_status,
    agent_name: row.agent_name,
  }));
  return result;
}

export async function resolveBundleCode(db, merchantId, value) {
  const code = String(value || '').trim();
  if (!code) return null;
  const bundleResult = await db.query(
    `SELECT b.*, v.variant_id, v.sku, p.product_name, a.name AS agent_name
     FROM qr_bundles b
     JOIN variants v ON v.variant_id = b.variant_id
     JOIN products p ON p.product_id = v.product_id
     LEFT JOIN agents a ON a.agent_id = b.agent_id AND a.merchant_id = b.merchant_id
     WHERE b.merchant_id = $1 AND UPPER(b.bundle_code) = UPPER($2)`,
    [merchantId, code]
  );
  if (bundleResult.rows.length === 0) return null;
  const bundle = bundleResult.rows[0];
  const members = await db.query(
    `SELECT qc.qr_batch, qc.qr_id, qc.label_id, qc.status, qc.current_store_id,
            cs.location AS current_store_name,
            v.variant_id, v.sku, p.product_id, p.product_name
     FROM qr_bundle_items qbi
     JOIN qr_codes qc ON qc.qr_batch = qbi.qr_batch
     JOIN variants v ON v.variant_id = qc.variant_id
     JOIN products p ON p.product_id = v.product_id
     LEFT JOIN stores cs ON cs.store_id = qc.current_store_id
     WHERE qbi.bundle_id = $1
     ORDER BY qc.label_id`,
    [bundle.bundle_id]
  );
  return { bundle, members: members.rows };
}
