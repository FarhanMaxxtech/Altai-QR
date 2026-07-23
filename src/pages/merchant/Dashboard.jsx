// src/components/Dashboard.jsx
import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../utils/api';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, ResponsiveContainer,
} from 'recharts';
import '../../styles/Dashboard.css';

const PIE_COLORS = ['#0d2d5e', '#d97706'];
const LOW_STOCK_THRESHOLD = 10;

export default function Dashboard() {
  const [summary, setSummary] = useState({
    deliveriesToday: 0,
    transfersInProgress: 0,
    totalStockAvailable: 0,
  });
  const [stockInOut, setStockInOut] = useState([
    { name: 'Stock In', value: 0 },
    { name: 'Stock Out', value: 0 },
  ]);
  const [tagsPerStore, setTagsPerStore] = useState([]);
  const [lowStock, setLowStock] = useState([]);

  useEffect(() => {
    apiFetch('/api/dashboard/summary')
      .then((res) => res.json())
      .then((data) => setSummary(data))
      .catch((err) => console.error('Failed to load summary:', err));

    apiFetch('/api/dashboard/stock-in-out')
      .then((res) => res.json())
      .then((data) => setStockInOut(data))
      .catch((err) => console.error('Failed to load stock in/out:', err));

    apiFetch('/api/dashboard/tags-per-store')
      .then((res) => res.json())
      .then((data) => setTagsPerStore(data))
      .catch((err) => console.error('Failed to load tags per store:', err));

    apiFetch('/api/dashboard/low-stock')
      .then((res) => res.json())
      .then((data) => setLowStock(data))
      .catch((err) => console.error('Failed to load low stock:', err));
  }, []);

  return (
    <div className="dashboard">
      <h2 className="dashboard-title">Dashboard</h2>

      {/* Top stat cards */}
      <div className="stat-cards">
        <div className="stat-card">
          <p className="stat-label">Deliveries Today (In-Store)</p>
          <p className="stat-value">{summary.deliveriesToday}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Transfers In Progress</p>
          <p className="stat-value">{summary.transfersInProgress}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Total Stock Available</p>
          <p className="stat-value">{summary.totalStockAvailable}</p>
        </div>
      </div>

      {/* Chart grid */}
      <div className="chart-grid">
        <div className="chart-card">
          <h3>Stock In vs Out</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={stockInOut}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={90}
                label={(entry) => `${entry.name}: ${entry.value}`}
              >
                {stockInOut.map((entry, index) => (
                  <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Total Tags per Store</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={tagsPerStore} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e4e7" />
              <XAxis type="number" tick={{ fontSize: 12 }} />
              <YAxis type="category" dataKey="store" tick={{ fontSize: 12 }} width={100} />
              <Tooltip />
              <Bar dataKey="tags" fill="#16a34a" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Low Stock Items (below {LOW_STOCK_THRESHOLD})</h3>
          {lowStock.length === 0 ? (
            <p className="empty-state">No low stock items.</p>
          ) : (
            <ul className="low-stock-list">
              {lowStock.map((entry, i) => (
                <li key={i} className="low-stock-item">
                  <span className="low-stock-item-name">{entry.item}</span>
                  <span className="low-stock-item-store">{entry.store}</span>
                  <span className="low-stock-item-qty">{entry.qty} left</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}