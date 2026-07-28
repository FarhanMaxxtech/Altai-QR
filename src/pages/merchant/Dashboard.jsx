// src/components/Dashboard.jsx
import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../utils/api';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line,
} from 'recharts';
import StockMovementCard from '../../components/StockMovementCard';
import '../../styles/Dashboard.css';

const LOW_STOCK_THRESHOLD = 10;

const STAT_CARDS = [
  { key: 'deliveries', label: 'Deliveries Today', unit: 'in-store', color: '#d97706' },
  { key: 'transfers', label: 'Transfers Open', unit: 'in progress', color: '#65a30d' },
  { key: 'totalStock', label: 'Total Stock', unit: 'units', color: '#16a34a' },
  { key: 'scans', label: 'Scans Today', unit: 'items', color: '#0d2d5e' },
];

function StatCard({ label, value, unit, delta, trend, color }) {
  const trendData = (trend && trend.length > 0 ? trend : [0, 0]).map((v, i) => ({ i, v }));
  const deltaText = delta > 0 ? `+${delta}` : `${delta}`;

  return (
    <div className="stat-card-v2">
      <div className="stat-card-v2-top">
        <span className="stat-card-v2-label">{label}</span>
        {delta !== undefined && <span className="stat-card-v2-delta">{deltaText}</span>}
      </div>
      <div className="stat-card-v2-bottom">
        <p className="stat-card-v2-value">
          {Number(value).toLocaleString()} <span className="stat-card-v2-unit">{unit}</span>
        </p>
        <div className="stat-card-v2-sparkline">
          <ResponsiveContainer width={70} height={32}>
            <LineChart data={trendData}>
              <Line type="monotone" dataKey="v" stroke={color} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [summary, setSummary] = useState({
    deliveriesToday: 0, deliveriesDelta: 0, deliveriesTrend: [],
    transfersInProgress: 0, transfersDelta: 0, transfersTrend: [],
    totalStockAvailable: 0, totalStockDelta: 0, totalStockTrend: [],
    scansToday: 0, scansDelta: 0, scansTrend: [],
  });
  const [tagsPerStore, setTagsPerStore] = useState([]);
  const [lowStock, setLowStock] = useState([]);

  useEffect(() => {
    apiFetch('/api/dashboard/summary')
      .then((res) => res.json())
      .then((data) => setSummary(data))
      .catch((err) => console.error('Failed to load summary:', err));

    apiFetch('/api/dashboard/tags-per-store')
      .then((res) => res.json())
      .then((data) => setTagsPerStore(data))
      .catch((err) => console.error('Failed to load tags per store:', err));

    apiFetch('/api/dashboard/low-stock')
      .then((res) => res.json())
      .then((data) => setLowStock(data))
      .catch((err) => console.error('Failed to load low stock:', err));
  }, []);

  const cardData = {
    deliveries: { value: summary.deliveriesToday, delta: summary.deliveriesDelta, trend: summary.deliveriesTrend },
    transfers: { value: summary.transfersInProgress, delta: summary.transfersDelta, trend: summary.transfersTrend },
    totalStock: { value: summary.totalStockAvailable, delta: summary.totalStockDelta, trend: summary.totalStockTrend },
    scans: { value: summary.scansToday, delta: summary.scansDelta, trend: summary.scansTrend },
  };

  return (
    <div className="dashboard">
      <h2 className="dashboard-title">Dashboard</h2>

      {/* Top stat cards */}
      <div className="stat-cards-v2">
        {STAT_CARDS.map((card) => (
          <StatCard
            key={card.key}
            label={card.label}
            unit={card.unit}
            color={card.color}
            value={cardData[card.key].value}
            delta={cardData[card.key].delta}
            trend={cardData[card.key].trend}
          />
        ))}
      </div>

      {/* Chart grid */}
      <div className="chart-grid">
        <StockMovementCard />

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