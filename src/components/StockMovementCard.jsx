// src/components/StockMovementCard.jsx
import React, { useState, useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { apiFetch } from '../utils/api';
import '../styles/StockMovementCard.css';

const DARK_GREEN = '#2e7d14';
const LIGHT_GREEN = '#9fce83';

const TABS = [
  { key: 'trend', label: 'Trend' },
  { key: 'split', label: 'Split' },
  { key: 'store', label: 'By store' },
];

function formatDay(iso) {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, { weekday: 'short' });
}

export default function StockMovementCard() {
  const [tab, setTab] = useState('trend');
  const [trend, setTrend] = useState([]);
  const [split, setSplit] = useState({ stockIn: 0, stockOut: 0 });
  const [byStore, setByStore] = useState([]);

  useEffect(() => {
    apiFetch('/api/dashboard/stock-movement')
      .then((res) => res.json())
      .then((data) => {
        setTrend(data.trend || []);
        setSplit(data.split || { stockIn: 0, stockOut: 0 });
        setByStore(data.byStore || []);
      })
      .catch((err) => console.error('Failed to load stock movement:', err));
  }, []);

  const net = split.stockIn - split.stockOut;
  const totalSplit = split.stockIn + split.stockOut;
  const inPct = totalSplit ? Math.round((split.stockIn / totalSplit) * 100) : 0;
  const outPct = totalSplit ? 100 - inPct : 0;

  const pieData = [
    { name: 'Stock In', value: split.stockIn || 0 },
    { name: 'Stock Out', value: split.stockOut || 0 },
  ];

  const maxStoreTotal = Math.max(1, ...byStore.map((s) => s.stock_in + s.stock_out));

  return (
    <div className="movement-card">
      <div className="movement-card-header">
        <div>
          <h3>Stock movement</h3>
          <p className="movement-card-subtitle">Last 7 days · in vs out</p>
        </div>
        <div className="movement-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`movement-tab ${tab === t.key ? 'movement-tab-active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'trend' && (
        <div className="movement-trend-body">
          <div className="movement-trend-chart">
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={trend} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#edf1e8" />
                <XAxis
                  dataKey="day"
                  tickFormatter={formatDay}
                  tick={{ fontSize: 11, fill: '#9aa891' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis hide />
                <Tooltip
                  labelFormatter={(v) => formatDay(v)}
                  formatter={(value, name) => [value, name === 'stock_in' ? 'Stock in' : 'Stock out']}
                />
                <Area
                  type="monotone"
                  dataKey="stock_in"
                  stroke={DARK_GREEN}
                  strokeWidth={2.5}
                  fill={DARK_GREEN}
                  fillOpacity={0.12}
                  dot={{ r: 3, fill: '#fff', stroke: DARK_GREEN, strokeWidth: 2 }}
                />
                <Area
                  type="monotone"
                  dataKey="stock_out"
                  stroke={LIGHT_GREEN}
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  fill="transparent"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="movement-trend-summary">
            <div className="movement-summary-item">
              <span className="movement-summary-label">
                <span className="movement-dot" style={{ background: DARK_GREEN }} />
                Stock in
              </span>
              <span className="movement-summary-value">{split.stockIn}</span>
            </div>
            <div className="movement-summary-item">
              <span className="movement-summary-label">
                <span className="movement-dot" style={{ background: LIGHT_GREEN }} />
                Stock out
              </span>
              <span className="movement-summary-value">{split.stockOut}</span>
            </div>
            <div className="movement-summary-item movement-net-block">
              <span className="movement-net-label">NET</span>
              <span className={`movement-net-value ${net < 0 ? 'movement-net-negative' : ''}`}>
                {net > 0 ? '+' : ''}{net}
              </span>
            </div>
          </div>
        </div>
      )}

      {tab === 'split' && (
        <div className="movement-split-body">
          <div className="movement-split-donut">
            <ResponsiveContainer width={150} height={150}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  innerRadius={52}
                  outerRadius={70}
                  startAngle={90}
                  endAngle={-270}
                  stroke="none"
                >
                  <Cell fill={DARK_GREEN} />
                  <Cell fill={LIGHT_GREEN} />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="movement-donut-center">
              <span className="movement-donut-total">{totalSplit}</span>
              <span className="movement-donut-caption">MOVEMENTS</span>
            </div>
          </div>

          <div className="movement-split-list">
            <div className="movement-split-row">
              <div className="movement-split-row-top">
                <span className="movement-dot" style={{ background: DARK_GREEN }} />
                <span className="movement-split-name">Stock in</span>
                <span className="movement-split-value">{split.stockIn}</span>
                <span className="movement-split-pct">{inPct}%</span>
              </div>
              <div className="movement-split-bar">
                <div className="movement-split-bar-fill" style={{ width: `${inPct}%`, background: DARK_GREEN }} />
              </div>
            </div>

            <div className="movement-split-row">
              <div className="movement-split-row-top">
                <span className="movement-dot" style={{ background: LIGHT_GREEN }} />
                <span className="movement-split-name">Stock out</span>
                <span className="movement-split-value">{split.stockOut}</span>
                <span className="movement-split-pct">{outPct}%</span>
              </div>
              <div className="movement-split-bar">
                <div className="movement-split-bar-fill" style={{ width: `${outPct}%`, background: LIGHT_GREEN }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'store' && (
        <div className="movement-store-body">
          {byStore.length === 0 ? (
            <p className="empty-state">No store activity in the last 7 days.</p>
          ) : (
            byStore.map((s) => {
              const total = s.stock_in + s.stock_out;
              const inWidth = total ? (s.stock_in / maxStoreTotal) * 100 : 0;
              const outWidth = total ? (s.stock_out / maxStoreTotal) * 100 : 0;
              return (
                <div key={s.store_id} className="movement-store-row">
                  <span className="movement-store-name">{s.store}</span>
                  <span className="movement-store-bar">
                    <span className="movement-store-bar-in" style={{ width: `${inWidth}%`, background: DARK_GREEN }} />
                    <span className="movement-store-bar-out" style={{ width: `${outWidth}%`, background: LIGHT_GREEN }} />
                  </span>
                  <span className="movement-store-tally">{s.stock_in} / {s.stock_out}</span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}