// src/server/middleware/storeScope.js
import pool from '../db.js';

// Attaches req.storeIds:
//   null            -> admin / super_admin, no restriction
//   [uuid, uuid...] -> staff, limited to these stores (may be empty = no access)
export async function loadStoreScope(req, res, next) {
  if (req.user.role === 'admin' || req.user.role === 'super_admin') {
    req.storeIds = null;
    return next();
  }

  try {
    const result = await pool.query(
      'SELECT store_id FROM user_store_access WHERE user_id = $1',
      [req.user.user_id]
    );
    req.storeIds = result.rows.map((r) => r.store_id);
    next();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// Throws 403 if a specific store_id the request wants to touch isn't
// in the caller's scope. Use this in POST/PUT routes (move stock, etc.)
export function assertStoreInScope(req, storeId) {
  if (req.storeIds === null) return true; // admin
  if (!storeId) return true; // route doesn't touch a store (e.g. RECEIVE has no from_store)
  return req.storeIds.includes(storeId);
}