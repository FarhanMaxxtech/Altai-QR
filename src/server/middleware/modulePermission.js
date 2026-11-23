import pool from '../db.js';

export function requireModulePermission(moduleKey, action) {
  return async (req, res, next) => {
    if (req.user?.role === 'admin' || req.user?.role === 'super_admin') {
      return next();
    }

    try {
      const result = await pool.query(
        'SELECT permissions FROM users WHERE user_id = $1 AND merchant_id = $2',
        [req.user.user_id, req.user.merchant_id]
      );
      const actions = result.rows[0]?.permissions?.[moduleKey] || [];
      if (!actions.includes(action)) {
        return res.status(403).json({ message: 'You do not have permission to perform this action.' });
      }
      return next();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  };
}
