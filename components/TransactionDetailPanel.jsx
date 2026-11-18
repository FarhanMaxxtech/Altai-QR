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

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function buildReceiptHtml(transaction) {
  const isNegative = NEGATIVE_TYPES.includes(transaction.transaction_type);
  const attributesArray = attributesObjectToArray(transaction.attributes);
  const attributesText = attributesArray.map((a) => `${a.key}: ${a.value}`).join(', ');
  const serialNumbers = transaction.serial_numbers || [];
  const reference = referenceOf(transaction.transaction_id);
  const eventLabel = TYPE_LABELS[transaction.transaction_type] || transaction.transaction_type;

  const codesHtml = serialNumbers.length
    ? serialNumbers.map((sn) => `<div class="code-row">${esc(sn)}</div>`).join('')
    : '<div class="muted">No serial numbers recorded.</div>';

  const trailSteps = [
    { title: `Scanned by ${transaction.created_by_name || 'Unknown'}`, time: formatTimeOnly(transaction.created_at) },
    { title: 'Posted to ledger', time: formatTimeOnly(transaction.created_at) },
    { title: `Balance updated · ${balanceUpdatedStoreName(transaction)}`, time: formatTimeOnly(transaction.created_at) },
  ];
  const trailHtml = trailSteps
    .map((s) => `
      <div class="trail-row">
        <span class="trail-dot"></span>
        <div class="trail-text">
          <div class="trail-title">${esc(s.title)}</div>
          <div class="trail-time">${esc(s.time)}</div>
        </div>
      </div>`)
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Receipt · ${esc(reference)}</title>
<style>
  @page { size: auto; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Courier New', ui-monospace, Consolas, monospace;
    color: #16250f;
    margin: 0 auto;
    padding: 24px;
    max-width: 420px;
  }
  .brand { text-align: center; font-weight: 700; font-size: 15px; letter-spacing: 1px; margin-bottom: 2px; }
  .brand-sub { text-align: center; font-size: 10.5px; color: #6b7280; letter-spacing: 1.5px; margin-bottom: 16px; }
  .divider { border: none; border-top: 1px dashed #9ca3af; margin: 14px 0; }
  .header-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
  .reference { font-size: 16px; font-weight: 700; }
  .qty { font-size: 16px; font-weight: 700; }
  .qty-positive { color: #2e7d14; }
  .qty-negative { color: #b3341e; }
  .datetime { font-size: 11.5px; color: #6b7280; margin-bottom: 10px; }
  .event-badge { display: inline-block; font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 4px; background: #f0f4ec; border: 1px solid #d1d5db; }
  .event-line { font-size: 12px; color: #374151; margin-top: 6px; }
  .section-label { font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #9ca3af; margin-bottom: 6px; }
  .kv-row { display: flex; justify-content: space-between; gap: 12px; font-size: 12.5px; padding: 3px 0; }
  .kv-label { color: #6b7280; }
  .kv-value { font-weight: 700; text-align: right; }
  .product-name { font-size: 13.5px; font-weight: 700; }
  .product-sub { font-size: 11.5px; color: #6b7280; margin-top: 2px; }
  .code-row { font-size: 12.5px; padding: 3px 0; border-bottom: 1px dotted #e5e7eb; }
  .muted { font-size: 12px; color: #9ca3af; font-style: italic; }
  .trail-row { display: flex; gap: 8px; padding: 4px 0; align-items: flex-start; }
  .trail-dot { width: 6px; height: 6px; border-radius: 50%; background: #2e7d14; margin-top: 5px; flex: none; }
  .trail-title { font-size: 12px; font-weight: 600; }
  .trail-time { font-size: 10.5px; color: #9ca3af; }
  .footer { text-align: center; font-size: 10.5px; color: #9ca3af; margin-top: 18px; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <div class="brand">ALTAI QR INVENTORY</div>
  <div class="brand-sub">STOCK TRANSACTION RECEIPT</div>

  <div class="header-row">
    <span class="reference">${esc(reference)}</span>
    <span class="qty ${isNegative ? 'qty-negative' : 'qty-positive'}">${isNegative ? '-' : '+'}${esc(transaction.qty)} units</span>
  </div>
  <div class="datetime">${esc(formatDateAt(transaction.created_at))}</div>

  <span class="event-badge">${esc(eventLabel)}</span>
  <div class="event-line">${esc(eventStoreLine(transaction))}</div>

  <hr class="divider" />

  <div class="section-label">Product</div>
  <div class="product-name">${esc(transaction.product_name)}</div>
  <div class="product-sub">${esc(transaction.sku)}${attributesText ? ` · ${esc(attributesText)}` : ''}</div>

  <hr class="divider" />

  <div class="section-label">Done By</div>
  <div class="kv-row"><span class="kv-label">Name</span><span class="kv-value">${esc(transaction.created_by_name || 'Unknown')}</span></div>
  <div class="kv-row"><span class="kv-label">Email</span><span class="kv-value">${esc(transaction.created_by_email || '—')}</span></div>
  <div class="kv-row"><span class="kv-label">Role</span><span class="kv-value">${esc(transaction.created_by_role || '—')}</span></div>

  <hr class="divider" />

  <div class="kv-row"><span class="kv-label">Store</span><span class="kv-value">${esc(primaryStoreName(transaction))}</span></div>
  <div class="kv-row"><span class="kv-label">Units Affected</span><span class="kv-value ${isNegative ? 'qty-negative' : 'qty-positive'}">${isNegative ? '-' : '+'}${esc(transaction.qty)}</span></div>

  <hr class="divider" />

  <div class="section-label">Scanned Codes (${serialNumbers.length})</div>
  ${codesHtml}

  <hr class="divider" />

  <div class="section-label">Audit Trail</div>
  ${trailHtml}

  <hr class="divider" />

  <div class="footer">Printed ${esc(new Date().toLocaleString())}</div>
</body>
</html>`;
}

export default function TransactionDetailPanel({ transaction, isLoading, errorMessage, onClose }) {
  const [isLookupOpen, setIsLookupOpen] = useState(false);
  if (!transaction && !isLoading && !errorMessage) return null;

  

  const isNegative = transaction ? NEGATIVE_TYPES.includes(transaction.transaction_type) : false;
  const attributesArray = transaction ? attributesObjectToArray(transaction.attributes) : [];
  const attributesText = attributesArray.map((a) => `${a.key}: ${a.value}`).join(', ');
  const serialNumbers = transaction?.serial_numbers || [];

  const handlePrint = () => {
  if (!transaction) return;

    const receiptWindow = window.open('', '_blank', 'width=auto,height=auto');
    if (!receiptWindow) {
      alert('Please allow pop-ups to print the receipt.');
      return;
    }

    receiptWindow.document.open();
    receiptWindow.document.write(buildReceiptHtml(transaction));
    receiptWindow.document.close();

    receiptWindow.focus();

    // Close the receipt window once the print dialog is dismissed,
    // whether the user printed or canceled.
    receiptWindow.onafterprint = () => receiptWindow.close();

    setTimeout(() => {
      receiptWindow.print();
    }, 300);
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