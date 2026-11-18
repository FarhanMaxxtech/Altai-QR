import React from 'react';
import { Navigate } from 'react-router-dom';

// module: the module name required to view this route (null = no restriction, just needs to be logged in)
export default function ProtectedRoute({ module, action = 'view', children }) {
  const storedUser = localStorage.getItem('authUser');
  const user = storedUser ? JSON.parse(storedUser) : null;

  if (!user) return <Navigate to="/login" replace />;

  const isFullAccess = user.role === 'admin' || user.role === 'super_admin';
  const hasAccess = isFullAccess || !module || (user.permissions?.[module] || []).includes(action);

  if (!hasAccess) return <Navigate to="/dashboard" replace />;
  return children;
}