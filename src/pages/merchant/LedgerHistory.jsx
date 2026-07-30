// src/pages/merchant/LedgerHistory.jsx
import React, { useState, useMemo, useEffect } from 'react';
import { apiFetch } from '../../utils/api';
import { exportRowsToExcel, exportRowsToPdf } from '../../utils/tableExport';
import TransactionDetailPanel from '../../components/TransactionDetailPanel';
import '../../styles/LedgerHistory.css';

const MOCK_TRANSACTIONS = [];
const PAGE_SIZE = 10;
const TYPE_FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'RECEIVE', label: 'Stock In' },
  { key: 'CHECKOUT', label: 'Stock Out' },
  { key: 'TRANSFER', label: 'Transfer' },
  { key: 'DAMAGE', label: 'Damage' },
  { key: 'CYCLE_COUNT', label: 'Cycle Count' },
];

const NEGATIVE_TYPES = ['CHECKOUT', 'DAMAGE', 'CYCLE_COUNT'];

const AVATAR_COLORS = ['#1e4010', '#0d2d5e', '#8a5a12', '#5a1e6b', '#0e7490'];

function typeLabel(type) {
  const found = TYPE_FILTERS.find((t) => t.key === type);
  return found ? found.label : type;
}

function typeBadgeClass(type) {
  switch (type) {
    case 'RECEIVE': return 'lh-badge lh-badge-receive';
    case 'CHECKOUT': return 'lh-badge lh-badge-checkout';
    case 'TRANSFER': return 'lh-badge lh-badge-transfer';
    case 'DAMAGE': return 'lh-badge lh-badge-damage';
    case 'CYCLE_COUNT': return 'lh-badge lh-badge-cyclecount';
    default: return 'lh-badge';
  }
}

function referenceOf(id) {
  return `${id.slice(0, 8).toUpperCase()}`;
}

function storeDisplay(t) {
  if (t.transaction_type === 'TRANSFER') {
    return `${t.from_store_name || '—'} → ${t.to_store_name || '—'}`;
  }
  if (t.transaction_type === 'RECEIVE') return t.to_store_name || '—';
  return t.from_store_name || '—';
}

function initialsOf(name) {
  if (!name) return '—';
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function avatarColor(name) {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function formatWhen(iso) {
  const date = new Date(iso);
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric' }) +
    ' · ' +
    date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function LedgerHistory() {
  const [transactions, setTransactions] = useState(MOCK_TRANSACTIONS);
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);

  // --- Row click -> detail panel ------------------------------------------
  const [selectedTx, setSelectedTx] = useState(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState('');

  const openDetail = (t) => {
    setIsPanelOpen(true);
    setSelectedTx(t); // show what we already have immediately
    setDetailError('');
    setIsLoadingDetail(true);

    apiFetch(`/api/transactions/${t.transaction_id}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load transaction detail.');
        return res.json();
      })
      .then((data) => setSelectedTx(data))
      .catch((err) => {
        setDetailError('Could not reach server. Check it is running.');
        console.error(err);
      })
      .finally(() => setIsLoadingDetail(false));
  };

  const closeDetail = () => {
    setIsPanelOpen(false);
    setSelectedTx(null);
    setDetailError('');
  };

  useEffect(() => {
    apiFetch('/api/transactions')
      .then((res) => res.json())
      .then((data) => setTransactions(data))
      .catch((err) => console.error('Failed to load transactions:', err));
  }, []);

  useEffect(() => {
  setPage(1);
}, [typeFilter, searchTerm]);

  const filteredTransactions = useMemo(() => {
    let rows = transactions;

    if (typeFilter !== 'ALL') {
      rows = rows.filter((t) => t.transaction_type === typeFilter);
    }

    const term = searchTerm.trim().toLowerCase();
    if (term) {
      rows = rows.filter((t) => {
        const reference = referenceOf(t.transaction_id).toLowerCase();
        return (
          reference.includes(term) ||
          t.product_name?.toLowerCase().includes(term) ||
          t.sku?.toLowerCase().includes(term) ||
          t.created_by_name?.toLowerCase().includes(term)
        );
      });
    }

    return rows;
  }, [transactions, typeFilter, searchTerm]);

  const stats = useMemo(() => {
    let unitsIn = 0;
    let unitsOut = 0;
    const contributors = new Set();

    filteredTransactions.forEach((t) => {
      const qty = Number(t.qty) || 0;
      if (NEGATIVE_TYPES.includes(t.transaction_type)) {
        unitsOut += qty;
      } else {
        unitsIn += qty;
      }
      if (t.created_by) contributors.add(t.created_by);
    });

    return {
      count: filteredTransactions.length,
      unitsIn,
      unitsOut,
      contributors: contributors.size,
    };
  }, [filteredTransactions]);

  const totalPages = Math.max(1, Math.ceil(filteredTransactions.length / PAGE_SIZE));
const pagedTransactions = filteredTransactions.slice(
  (page - 1) * PAGE_SIZE,
  page * PAGE_SIZE
);

const handlePageChange = (next) => {
  if (next < 1 || next > totalPages) return;
  setPage(next);
};

  const handleExportExcel = () => {
    const rows = filteredTransactions.map((t) => ({
      Reference: referenceOf(t.transaction_id),
      When: formatWhen(t.created_at),
      Event: typeLabel(t.transaction_type),
      Product: t.product_name,
      SKU: t.sku,
      Store: storeDisplay(t),
      'Done By': t.created_by_name || '—',
      Qty: `${NEGATIVE_TYPES.includes(t.transaction_type) ? '-' : '+'}${t.qty}`,
    }));
    exportRowsToExcel(rows, 'transaction-ledger.xlsx', 'Ledger');
  };

  const handleExportPdf = () => {
    const rows = filteredTransactions.map((t) => ({
      Reference: referenceOf(t.transaction_id),
      When: formatWhen(t.created_at),
      Event: typeLabel(t.transaction_type),
      Product: `${t.product_name} (${t.sku})`,
      Store: storeDisplay(t),
      'Done By': t.created_by_name || '—',
      Qty: `${NEGATIVE_TYPES.includes(t.transaction_type) ? '-' : '+'}${t.qty}`,
    }));
    exportRowsToPdf(rows, 'transaction-ledger.pdf', 'Transaction Ledger');
  };

  return (
    <div className="lh-page">
      {/* --- Row 1: filters + search + export --- */}
      <div className="lh-filter-bar">
        <div className="lh-filter-pills">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`lh-filter-pill ${typeFilter === f.key ? 'lh-filter-pill-active' : ''}`}
              onClick={() => setTypeFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="lh-search">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Reference, SKU or user"
          />
        </div>

        <div className="lh-export-buttons">
          <button type="button" onClick={handleExportExcel} disabled={filteredTransactions.length === 0}>
            Excel
          </button>
          <button type="button" onClick={handleExportPdf} disabled={filteredTransactions.length === 0}>
            PDF
          </button>
        </div>
      </div>

      {/* --- Row 2: stats --- */}
      <div className="lh-stats-grid">
        <div className="lh-stat-card">
          <span className="lh-stat-label">Transactions</span>
          <div className="lh-stat-row">
            <span className="lh-stat-value">{stats.count}</span>
            <span className="lh-stat-unit">records</span>
          </div>
        </div>
        <div className="lh-stat-card">
          <span className="lh-stat-label">Units In</span>
          <div className="lh-stat-row">
            <span className="lh-stat-value lh-stat-value-positive">+{stats.unitsIn}</span>
            <span className="lh-stat-unit">units</span>
          </div>
        </div>
        <div className="lh-stat-card">
          <span className="lh-stat-label">Units Out</span>
          <div className="lh-stat-row">
            <span className="lh-stat-value lh-stat-value-negative">−{stats.unitsOut}</span>
            <span className="lh-stat-unit">units</span>
          </div>
        </div>
        <div className="lh-stat-card">
          <span className="lh-stat-label">Contributors</span>
          <div className="lh-stat-row">
            <span className="lh-stat-value">{stats.contributors}</span>
            <span className="lh-stat-unit">users</span>
          </div>
        </div>
      </div>

      {/* --- Row 3: table --- */}
      <div className="lh-table-card">
        {filteredTransactions.length === 0 ? (
          <p className="lh-empty-state">No transactions found.</p>
        ) : (
          <div className="lh-table-wrapper">
            <table className="lh-table">
              <thead>
                <tr>
                  <th className="lh-col-no">No.</th>
                  <th>Reference</th>
                  <th>When</th>
                  <th>Event</th>
                  <th>Product</th>
                  <th>Store</th>
                  <th>Done By</th>
                  <th className="lh-col-qty">Qty</th>
                </tr>
              </thead>
              <tbody>
                {pagedTransactions.map((t, index) => {
                  const isNegative = NEGATIVE_TYPES.includes(t.transaction_type);
                  const rowNumber = (page - 1) * PAGE_SIZE + index + 1;
                  return (
                    <tr
                      key={t.transaction_id}
                      className="lh-row-clickable"
                      onClick={() => openDetail(t)}
                    >
                      <td className="lh-col-no">{rowNumber}</td>
                      <td className="lh-reference-cell">{referenceOf(t.transaction_id)}</td>
                      <td className="lh-when-cell">{formatWhen(t.created_at)}</td>
                      <td>
                        <span className={typeBadgeClass(t.transaction_type)}>
                          {typeLabel(t.transaction_type)}
                        </span>
                      </td>
                      <td>
                        <div className="lh-product-cell">
                          <span className="lh-product-name">{t.product_name}</span>
                          <span className="lh-product-sub">{t.sku}</span>
                        </div>
                      </td>
                      <td className="lh-store-cell">{storeDisplay(t)}</td>
                      <td>
                        <div className="lh-user-cell">
                          <span
                            className="lh-avatar"
                            style={{ background: avatarColor(t.created_by_name) }}
                          >
                            {initialsOf(t.created_by_name)}
                          </span>
                          <div className="lh-user-meta">
                            <span className="lh-user-name">{t.created_by_name || '—'}</span>
                            <span className="lh-user-role">{t.created_by_role || ''}</span>
                          </div>
                        </div>
                      </td>
                      <td className={`lh-col-qty ${isNegative ? 'lh-qty-negative' : 'lh-qty-positive'}`}>
                        {isNegative ? '-' : '+'}{t.qty}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="lh-pagination-bar">
          <span className="lh-showing-text">
            Showing {pagedTransactions.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}
            –{Math.min(page * PAGE_SIZE, filteredTransactions.length)} of {filteredTransactions.length} transactions
          </span>
          {totalPages > 1 && (
            <div className="lh-pagination-controls">
              <button
                type="button"
                className="lh-pagination-btn"
                onClick={() => handlePageChange(page - 1)}
                disabled={page <= 1}
              >
                Previous
              </button>
              <span className="lh-pagination-status">Page {page} of {totalPages}</span>
              <button
                type="button"
                className="lh-pagination-btn"
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= totalPages}
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
            {isPanelOpen && (
        <TransactionDetailPanel
          transaction={selectedTx}
          isLoading={isLoadingDetail}
          errorMessage={detailError}
          onClose={closeDetail}
        />
      )}
    </div>
  );
}