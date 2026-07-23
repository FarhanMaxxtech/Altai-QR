// src/components/LedgerHistory.jsx
import React, { useState, useMemo, useEffect } from 'react';
import { apiFetch } from '../../utils/api';
import '../../styles/LedgerHistory.css';

// --- Temporary mock data layer -----------------------------------------
// Replace with: const [transactions, setTransactions] = useState([]);
// then useEffect(() => { fetch('/api/transactions').then(...) }, []);

// TODO: GET /api/transactions
const MOCK_TRANSACTIONS = [];

// -------------------------------------------------------------------------

const TYPE_FILTERS = ['ALL', 'RECEIVE', 'TRANSFER', 'CHECKOUT'];

export default function LedgerHistory() {
  const [transactions, setTransactions] = useState(MOCK_TRANSACTIONS);
  const [typeFilter, setTypeFilter] = useState('ALL');

  useEffect(() => {
    apiFetch('/api/transactions')
      .then((res) => res.json())
      .then((data) => setTransactions(data))
      .catch((err) => console.error('Failed to load transactions:', err));
  }, []);

  const filteredTransactions = useMemo(() => {
    if (typeFilter === 'ALL') return transactions;
    return transactions.filter((t) => t.transaction_type === typeFilter);
  }, [transactions, typeFilter]);

  const formatTimestamp = (iso) => {
    const date = new Date(iso);
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const typeBadgeClass = (type) => {
    switch (type) {
      case 'RECEIVE':
        return 'badge badge-receive';
      case 'TRANSFER':
        return 'badge badge-transfer';
      case 'CHECKOUT':
        return 'badge badge-checkout';
      default:
        return 'badge';
    }
  };

  return (
    <div className="ledger-history">
      <div className="ledger-header">
        <h2>Transaction Ledger</h2>

        <div className="filter-group">
          {TYPE_FILTERS.map((type) => (
            <button
              key={type}
              className={`filter-btn ${typeFilter === type ? 'filter-btn-active' : ''}`}
              onClick={() => setTypeFilter(type)}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {filteredTransactions.length === 0 ? (
        <p className="empty-state">No transactions found.</p>
      ) : (
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Item</th>
              <th>Type</th>
              <th>From</th>
              <th>To</th>
              <th>Qty</th>
            </tr>
          </thead>
          <tbody>
            {filteredTransactions.map((t) => (
              <tr key={t.transaction_id}>
                <td>{formatTimestamp(t.created_at)}</td>
                <td>{t.product_name} ({t.sku})</td>
                <td>
                  <span className={typeBadgeClass(t.transaction_type)}>
                    {t.transaction_type}
                  </span>
                </td>
                <td>{t.from_store_name || '—'}</td>
                <td>{t.to_store_name || '—'}</td>
                <td>{t.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}