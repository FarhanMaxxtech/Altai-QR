import React from 'react';
import { Navigate } from 'react-router-dom';

// module: the module name required to view this route (null = no restriction, just needs to be logged in)
export default function ProtectedRoute({ module, children }) {
  const storedUser = localStorage.getItem('authUser');
  const user = storedUser ? JSON.parse(storedUser) : null;

  if (!user) return <Navigate to="/login" replace />;

  const hasAccess = user.role === 'admin' || !module || user.modules?.includes(module);
  if (!hasAccess) return <Navigate to="/dashboard" replace />;

  return children;
}