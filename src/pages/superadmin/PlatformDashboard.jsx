// src/pages/superadmin/PlatformDashboard.jsx
import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../utils/api';
import '../../styles/superadmin/PlatformDashboard.css';

// TODO: GET /api/superadmin/stats
// Expected shape: { total_merchants, active_merchants, suspended_merchants,
//                    total_products, total_stores, total_users }
const MOCK_STATS = {
  total_merchants: 0,
  active_merchants: 0,
  suspended_merchants: 0,
  total_products: 0,
  total_stores: 0,
  total_users: 0,
};

// TODO: GET /api/superadmin/merchants?sort=recent&limit=5
const MOCK_RECENT_MERCHANTS = [];

function formatTimestamp(iso) {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function PlatformDashboard() {
  const [stats, setStats] = useState(MOCK_STATS);
  const [recentMerchants, setRecentMerchants] = useState(MOCK_RECENT_MERCHANTS);

  useEffect(() => {
    apiFetch('/api/superadmin/stats')
      .then((res) => res.json())
      .then((data) => setStats(data))
      .catch((err) => console.error('Failed to load stats:', err));

    apiFetch('/api/superadmin/merchants')
      .then((res) => res.json())
      .then((data) => setRecentMerchants(data.slice(0, 5)))
      .catch((err) => console.error('Failed to load recent merchants:', err));
  }, []);

  return (
    <div className="platform-dashboard">
      <h2>Platform Overview</h2>

      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-label">Total Merchants</span>
          <span className="stat-value">{stats.total_merchants}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Active Merchants</span>
          <span className="stat-value stat-value-active">{stats.active_merchants}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Suspended Merchants</span>
          <span className="stat-value stat-value-suspended">{stats.suspended_merchants}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Products (all merchants)</span>
          <span className="stat-value">{stats.total_products}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Stores (all merchants)</span>
          <span className="stat-value">{stats.total_stores}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Users (all merchants)</span>
          <span className="stat-value">{stats.total_users}</span>
        </div>
      </div>

      <section className="recent-merchants-section">
        <h3>Recently Added Merchants</h3>
        {recentMerchants.length === 0 ? (
          <p className="empty-state">No merchants yet.</p>
        ) : (
          <table className="recent-merchants-table">
            <thead>
              <tr>
                <th>Business Name</th>
                <th>Status</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {recentMerchants.map((merchant) => (
                <tr key={merchant.merchant_id}>
                  <td>{merchant.business_name}</td>
                  <td>
                    <span className={`status-badge status-badge-${merchant.status.toLowerCase()}`}>
                      {merchant.status}
                    </span>
                  </td>
                  <td>{formatTimestamp(merchant.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
