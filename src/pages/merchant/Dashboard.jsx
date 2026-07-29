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

// Builds a hand-drawn sparkline path (line + filled area under it),
// normalized against the min/max of the series — same approach used
// in the reference dashboard mockup's spark() helper.
function Sparkline({ data, color, width = 64, height = 22 }) {
  const points = data && data.length > 0 ? data : [0, 0];
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1; // avoid divide-by-zero when flat

  const linePath = points
    .map((v, i) => {
      const x = (i * (width / (points.length - 1 || 1))).toFixed(1);
      const y = (height - ((v - min) / range) * (height - 3) - 1.5).toFixed(1);
      return `${i === 0 ? 'M' : 'L'}${x} ${y}`;
    })
    .join(' ');

  const areaPath = `${linePath} L${width} ${height} L0 ${height} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none">
      <path d={areaPath} fill={color} opacity={0.1} />
      <path
        d={linePath}
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatCard({ label, value, unit, delta, trend, color }) {
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
          <Sparkline data={trend} color={color} />
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

// src/pages/merchant/Dashboard.jsx
useEffect(() => {
  apiFetch('/api/dashboard/summary')
    .then((res) => res.json())
    .then((data) => setSummary((prev) => ({ ...prev, ...data })))   // merge, don't replace
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
      {/*<h2 className="dashboard-title">Dashboard</h2>

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

        <div className="store-card">
          <div className="store-card-header">
            <h3>Items per Store</h3>
            <div className="store-total">
              <span className="value">
                {tagsPerStore.reduce((sum, s) => sum + (s.tags || 0), 0)}
              </span>
              <span className="label">Total</span>
            </div>
          </div>

          {tagsPerStore.length === 0 ? (
            <p className="empty-state">No store data yet.</p>
          ) : (
            (() => {
              const maxTags = Math.max(1, ...tagsPerStore.map((s) => s.tags || 0));
              return tagsPerStore.map((s) => {
                const delta = s.delta ?? 0; // TODO: backend to supply today's net change
                const deltaClass = delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'neutral';
                const deltaText = delta > 0 ? `+${delta}` : `${delta}`;
                const pct = ((s.tags || 0) / maxTags) * 100;

                return (
                  <div className="store-row" key={s.store}>
                    <div className="store-top">
                      <span className="store-name">{s.store}</span>
                      <div className="store-right">
                        <span className="qty">{s.tags || 0}</span>
                        <span className={`today ${deltaClass}`}>{deltaText}</span>
                      </div>
                    </div>
                    <div className="progress">
                      <div className="progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              });
            })()
          )}
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