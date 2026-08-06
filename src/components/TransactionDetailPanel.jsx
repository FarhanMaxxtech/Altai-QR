// src/components/TransactionDetailPanel.jsx
import { useState } from 'react';
import { X, ScanLine } from 'lucide-react';
import '../styles/TransactionDetailPanel.css';
import ScanLookupModal from './ScanLookupModal';

const NEGATIVE_TYPES = ['CHECKOUT', 'DAMAGE', 'CYCLE_COUNT'];

const TYPE_LABELS = {
  RECEIVE: 'Stock In',
  CHECKOUT: 'Stock Out',
  TRANSFER: 'Transfer',
  DAMAGE: 'Damage',
  CYCLE_COUNT: 'Cycle Count',
};

const TYPE_VERBS = {
  RECEIVE: 'received',
  CHECKOUT: 'checked out',
  TRANSFER: 'transferred',
  DAMAGE: 'reported damaged',
  CYCLE_COUNT: 'recounted',
};

function referenceOf(id) {
  return `TRX-${id.slice(0, 8).toUpperCase()}`;
}

function initialsOf(name) {
  if (!name) return '—';
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function formatDateAt(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  const datePart = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const timePart = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${datePart} at ${timePart}`;
}

function formatTimeOnly(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

function attributesObjectToArray(attributesObject) {
  if (!attributesObject) return [];
  return Object.entries(attributesObject).map(([key, value]) => ({ key, value }));
}

function eventStoreLine(t) {
  const label = TYPE_LABELS[t.transaction_type] || t.transaction_type;
  const verb = TYPE_VERBS[t.transaction_type] || '';

  if (t.transaction_type === 'TRANSFER') {
    return `${label} · ${t.from_store_name || '—'} → ${t.to_store_name || '—'} ${verb}`;
  }
  if (t.transaction_type === 'RECEIVE') {
    return `${label} · ${t.to_store_name || '—'} ${verb}`;
  }
  return `${label} · ${t.from_store_name || '—'} ${verb}`;
}

function primaryStoreName(t) {
  if (t.transaction_type === 'TRANSFER') {
    return `${t.from_store_name || '—'} → ${t.to_store_name || '—'}`;
  }
  if (t.transaction_type === 'RECEIVE') return t.to_store_name || '—';
  return t.from_store_name || '—';
}

function balanceUpdatedStoreName(t) {
  // Store where the qty actually landed / was deducted from
  if (t.transaction_type === 'RECEIVE' || t.transaction_type === 'TRANSFER') {
    return t.to_store_name || '—';
  }
  return t.from_store_name || '—';
}

export default function TransactionDetailPanel({ transaction, isLoading, errorMessage, onClose }) {
  const [isLookupOpen, setIsLookupOpen] = useState(false);
  if (!transaction && !isLoading && !errorMessage) return null;

  

  const isNegative = transaction ? NEGATIVE_TYPES.includes(transaction.transaction_type) : false;
  const attributesArray = transaction ? attributesObjectToArray(transaction.attributes) : [];
  const attributesText = attributesArray.map((a) => `${a.key}: ${a.value}`).join(', ');
  const serialNumbers = transaction?.serial_numbers || [];

  const handlePrint = () => {
    window.print();
  };

  const handleLookup = () => {
    setIsLookupOpen(true);
  };

  return (
    <div className="tdp-overlay" onClick={onClose}>
      <div className="tdp-panel" onClick={(e) => e.stopPropagation()}>
        {/* --- Header --- */}
        <div className="tdp-header">
          <div className="tdp-header-top">
            <span className="tdp-header-label">TRANSACTION</span>
            <button type="button" className="tdp-close" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </div>

          {isLoading ? (
            <p className="tdp-header-loading">Loading…</p>
          ) : errorMessage ? (
            <p className="tdp-header-error">{errorMessage}</p>
          ) : transaction && (
            <div className="tdp-header-main">
              <div>
                <div className="tdp-reference">{referenceOf(transaction.transaction_id)}</div>
                <div className="tdp-date">{formatDateAt(transaction.created_at)}</div>
              </div>
              <div className={`tdp-qty ${isNegative ? 'tdp-qty-negative' : 'tdp-qty-positive'}`}>
                {isNegative ? '-' : '+'}{transaction.qty} units
              </div>
            </div>
          )}
        </div>

        {!isLoading && !errorMessage && transaction && (
          <div className="tdp-body">
            {/* --- Event line --- */}
            <div className="tdp-event-row">
              <span className={`tdp-event-badge tdp-event-badge-${transaction.transaction_type.toLowerCase()}`}>
                {TYPE_LABELS[transaction.transaction_type] || transaction.transaction_type}
              </span>
              <span className="tdp-event-text">
                {transaction.transaction_type === 'TRANSFER'
                  ? `${transaction.from_store_name || '—'} → ${transaction.to_store_name || '—'} transferred`
                  : `${primaryStoreName(transaction)} ${TYPE_VERBS[transaction.transaction_type] || ''}`}
              </span>
            </div>

            {/* --- Product --- */}
            <div className="tdp-section">
              <span className="tdp-section-label">Product</span>
              <div className="tdp-product-row">
                <span className="tdp-product-avatar">{initialsOf(transaction.product_name)}</span>
                <div className="tdp-product-meta">
                  <span className="tdp-product-name">{transaction.product_name}</span>
                  <span className="tdp-product-sub">
                    {transaction.sku}
                    {attributesText ? ` · ${attributesText}` : ''}
                  </span>
                </div>
                <button type="button" className="tdp-lookup-btn" onClick={handleLookup}>
                  Look up
                </button>
              </div>
            </div>

            {/* --- Done by --- */}
            <div className="tdp-section">
              <span className="tdp-section-label">Done By</span>
              <div className="tdp-user-row">
                <span className="tdp-user-avatar">{initialsOf(transaction.created_by_name)}</span>
                <div className="tdp-user-meta">
                  <span className="tdp-user-name">{transaction.created_by_name || 'Unknown'}</span>
                  <span className="tdp-user-email">{transaction.created_by_email || '—'}</span>
                </div>
                {transaction.created_by_role && (
                  <span className="tdp-role-badge">{transaction.created_by_role}</span>
                )}
              </div>
            </div>

            {/* --- Store / Units affected --- */}
            <div className="tdp-two-col">
              <div className="tdp-info-block">
                <span className="tdp-info-label">Store</span>
                <span className="tdp-info-value">{primaryStoreName(transaction)}</span>
              </div>
              <div className="tdp-info-block">
                <span className="tdp-info-label">Units Affected</span>
                <span className={`tdp-info-value ${isNegative ? 'tdp-value-negative' : 'tdp-value-positive'}`}>
                  {isNegative ? '-' : '+'}{transaction.qty}
                </span>
              </div>
            </div>

            {/* --- Scanned codes --- */}
            <div className="tdp-section">
              <span className="tdp-section-label">Scanned Codes</span>
              {serialNumbers.length === 0 ? (
                <p className="tdp-empty-text">No serial numbers recorded.</p>
              ) : (
                <div className="tdp-code-list">
                  {serialNumbers.map((sn) => (
                    <div key={sn} className="tdp-code-row">
                      <ScanLine size={14} className="tdp-code-icon" />
                      <span className="tdp-code-text">{sn}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* --- Audit trail --- */}
            <div className="tdp-section">
              <span className="tdp-section-label">Audit Trail</span>
              <div className="tdp-trail">
                <div className="tdp-trail-item">
                  <span className="tdp-trail-dot tdp-trail-dot-active" />
                  <div className="tdp-trail-content">
                    <span className="tdp-trail-title">
                      Scanned by {transaction.created_by_name || 'Unknown'}
                    </span>
                    <span className="tdp-trail-time">
                      {formatTimeOnly(transaction.created_at)} · {transaction.created_by_name || 'Unknown'}
                    </span>
                  </div>
                </div>
                <div className="tdp-trail-item">
                  <span className="tdp-trail-dot tdp-trail-dot-active" />
                  <div className="tdp-trail-content">
                    <span className="tdp-trail-title">Posted to ledger</span>
                    <span className="tdp-trail-time">{formatTimeOnly(transaction.created_at)} · System</span>
                  </div>
                </div>
                <div className="tdp-trail-item tdp-trail-item-last">
                  <span className="tdp-trail-dot" />
                  <div className="tdp-trail-content">
                    <span className="tdp-trail-title">
                      Balance updated · {balanceUpdatedStoreName(transaction)}
                    </span>
                    <span className="tdp-trail-time">{formatTimeOnly(transaction.created_at)} · System</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* --- Footer --- */}
        <div className="tdp-footer">
          <button type="button" className="tdp-btn-secondary" onClick={onClose}>
            Close
          </button>
          <button type="button" className="tdp-btn-primary" onClick={handlePrint} disabled={!transaction}>
            Print receipt
          </button>
        </div>
      </div>
      <ScanLookupModal
        isOpen={isLookupOpen}
        onClose={() => setIsLookupOpen(false)}
        initialQuery={transaction?.sku || transaction?.product_name || ''}
      />
    </div>
  );
}