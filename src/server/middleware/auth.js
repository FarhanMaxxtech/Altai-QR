import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

// Verifies the token and attaches the decoded payload (user_id, role,
// merchant_id) to req.user. Every protected route can then trust
// req.user.merchant_id — it came from a signed token, not from
// anything the client typed or sent in the request body.
export function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer <token>"

  if (!token) {
    return res.status(401).json({ message: 'No token provided.' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token.' });
    }
    req.user = decoded; // { user_id, role, merchant_id }
    next();
  });
}

// Use after requireAuth on routes that only Super Admin should reach.
export function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== 'super_admin') {
    return res.status(403).json({ message: 'Super Admin access required.' });
  }
  next();
}