// src/App.jsx

// Merchant pages
import React, { useState, useEffect } from 'react';
import Navigation from './components/Navigation';
import Dashboard from './pages/merchant/Dashboard';
import AssetRegistry from './pages/merchant/AssetRegistry';
import ProductListing from './pages/merchant/ProductListing';
import StoreManagement from './pages/merchant/StoreManagement';
import StockManager from './pages/merchant/StockManager';
import LedgerHistory from './pages/merchant/LedgerHistory';
import StockAdjustment from './pages/merchant/StockAdjustment';
import UserManagement from './pages/merchant/UserManagement';
import QRGenerator from './pages/superadmin/QRGenerator';
import QRHistory from './pages/superadmin/QRHistory';
import RegisterProduct from './pages/merchant/RegisterProduct';
import ProductDetails from './pages/merchant/ProductDetails';
import ProductBalanceDetails from './pages/merchant/ProductBalanceDetails';
import AssignQrToProduct from './pages/merchant/AssignQrToProduct';
import PageHeader from './components/PageHeader';
//import ApproveQrProduct from './pages/merchant/ApproveQrProduct';
//import ApproveQrProductDetail from './pages/merchant/ApproveQrProductDetail';
import { apiFetch } from './utils/api';
/// Authentication pages
import Login from './authentication/Login';

// Superadmin pages
import MerchantManagement from './pages/superadmin/MerchantManagement';

import PlatformDashboard from './pages/superadmin/PlatformDashboard';
import SuperAdminNavigation from './components/SuperAdminNavigation';

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';

import './App.css';

function permissionFingerprint(user) {
  if (!user) return '';
  return JSON.stringify({
    role: user.role,
    permissions: user.permissions,
    permission_preset: user.permission_preset,
    store_ids: [...(user.store_ids || [])].sort(),
    modules: user.modules,
    expiry_date: user.expiry_date,
  });
}

function App() {
    const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('authToken');
    if (!token) {
      setAuthReady(true);
      return;
    }

    apiFetch('/api/auth/me')
      .then((res) => (res && res.ok ? res.json() : null))
      .then((data) => {
        if (data) localStorage.setItem('authUser', JSON.stringify(data));
      })
      .catch((err) => console.error('Failed to refresh user permissions:', err))
      .finally(() => setAuthReady(true));
  }, []);

    // Poll for permission/store-access changes made by an admin while this
  // tab is open, and reload automatically once they land — avoids asking
  // the staff member to manually refresh after being granted new access.
  useEffect(() => {
    const token = localStorage.getItem('authToken');
    if (!token) return;

    const poll = setInterval(() => {
      const storedRaw = localStorage.getItem('authUser');
      const stored = storedRaw ? JSON.parse(storedRaw) : null;
      if (!stored) return;

      apiFetch('/api/auth/me')
        .then((res) => (res && res.ok ? res.json() : null))
        .then((fresh) => {
          if (!fresh) return;
          if (permissionFingerprint(fresh) !== permissionFingerprint(stored)) {
            localStorage.setItem('authUser', JSON.stringify(fresh));
            window.location.reload();
          }
        })
        .catch((err) => console.error('Permission poll failed:', err));
    }, 5000); // check every 5s

    return () => clearInterval(poll);
  }, []);

  if (!authReady) {
    return null; // or a small loading spinner
  }
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <div className="app-shell">
              <Navigation />
              <main className="app-main">
                <PageHeader />
                <div className="app-main-content">
                <Routes>
                  <Route path="/dashboard" element={<ProtectedRoute module="Dashboard"><Dashboard /></ProtectedRoute>} />
                  <Route path="/registry" element={<ProtectedRoute module="Product InfoCenter" action="create"><RegisterProduct /></ProtectedRoute>} />
                  <Route path="/listing" element={<ProtectedRoute module="Product InfoCenter"><ProductListing /></ProtectedRoute>} />
                  <Route path="/listing/:productId" element={<ProtectedRoute module="Product InfoCenter"><ProductDetails /></ProtectedRoute>} />
                  <Route path="/assign-qr" element={<ProtectedRoute module="Product InfoCenter" action="create"><AssignQrToProduct /></ProtectedRoute>} />
                  <Route path="/stock-balance" element={<ProtectedRoute module="Product Balance"><StockAdjustment /></ProtectedRoute>} />
                  <Route path="/stores" element={<ProtectedRoute module="Store Management"><StoreManagement /></ProtectedRoute>} />
                  <Route path="/stock" element={<ProtectedRoute module="Stock Adjustment"><StockManager /></ProtectedRoute>} />
                  <Route path="/stock-balance/:variantId/:storeId" element={<ProtectedRoute module="Product Balance"><ProductBalanceDetails /></ProtectedRoute>} />
                  <Route path="/ledger" element={<ProtectedRoute module="Transaction Ledger"><LedgerHistory /></ProtectedRoute>} />
                  <Route path="/users" element={<ProtectedRoute module="User Management"><UserManagement /></ProtectedRoute>} />
                </Routes>
                </div>
              </main>
            </div>
          }
        />
        <Route
          path="/superadmin/*"
          element={
            <div className="app-shell">
              <SuperAdminNavigation />
              <main className="app-main">
                <Routes>
                  <Route path="dashboard" element={<PlatformDashboard />} />
                  <Route path="qrcodes" element={<QRGenerator />} />
                  <Route path="qrcodes/history" element={<QRHistory />} />
                  <Route path="merchants" element={<MerchantManagement />} />
                </Routes>
              </main>
            </div>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;