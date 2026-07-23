// src/App.jsx

// Merchant pages
import React from 'react';
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

/// Authentication pages
import Login from './authentication/Login';

// Superadmin pages
import MerchantManagement from './pages/superadmin/MerchantManagement';

import PlatformDashboard from './pages/superadmin/PlatformDashboard';
import SuperAdminNavigation from './components/SuperAdminNavigation';

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';

import './App.css';

function App() {
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
                <Routes>
                  <Route path="/dashboard" element={<ProtectedRoute module={null}><Dashboard /></ProtectedRoute>} />
                  <Route path="/registry" element={<ProtectedRoute module="Asset Registry"><RegisterProduct /></ProtectedRoute>} />
                  <Route path="/listing" element={<ProtectedRoute module="Product Listing"><ProductListing /></ProtectedRoute>} />
                  <Route path="/listing/:productId" element={<ProtectedRoute module="Product Listing"><ProductDetails /></ProtectedRoute>} />
                  <Route path="/stock-balance" element={<ProtectedRoute module="Stock Balance"><StockAdjustment /></ProtectedRoute>} />
                  <Route path="/stores" element={<ProtectedRoute module="Store Management"><StoreManagement /></ProtectedRoute>} />
                  <Route path="/stock" element={<ProtectedRoute module="Stock Adjustment"><StockManager /></ProtectedRoute>} />
                  <Route path="/stock-balance/:variantId/:storeId" element={<ProtectedRoute module="Stock Adjustment"><ProductBalanceDetails /></ProtectedRoute>} />
                  <Route path="/ledger" element={<ProtectedRoute module="Ledger"><LedgerHistory /></ProtectedRoute>} />
                  <Route path="/users" element={<ProtectedRoute module="User Management"><UserManagement /></ProtectedRoute>} />
                </Routes>
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