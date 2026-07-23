// src/pages/merchant/ProductBalanceDetails.jsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { Tag } from 'lucide-react';
import { apiFetch } from '../../utils/api';
import TableControls from '../../components/TableControls';
import { exportRowsToExcel, exportRowsToCsv, exportRowsToPdf } from '../../utils/tableExport';
import { formatDateTime } from '../../utils/dateFormat';
import '../../styles/StockAdjustment.css';

function attributesObjectToArray(attributesObject) {
  if (!attributesObject) return [];
  return Object.entries(attributesObject).map(([key, value]) => ({
    id: crypto.randomUUID(),
    key,
    value,
  }));
}

function formatVariation(attributesObject) {
  const arr = attributesObjectToArray(attributesObject);
  return arr.length > 0 ? arr.map((a) => `${a.key}: ${a.value}`).join(', ') : '—';
}

function storeDisplayName(tx, currentStoreName) {
  if (tx.transaction_type === 'TRANSFER') {
    return `${tx.from_store_name} → ${tx.to_store_name}`;
  }
  return currentStoreName;
}

// Export-safe variant — no arrow glyph, avoids PDF/CSV encoding issues.
function storeDisplayNameForExport(tx, currentStoreName) {
  if (tx.transaction_type === 'TRANSFER') {
    return `${tx.from_store_name} to ${tx.to_store_name}`;
  }
  return currentStoreName;
}

export default function ProductBalanceDetails() {
  const { variantId, storeId } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();

  const [header, setHeader] = useState(state || null);

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [dateError, setDateError] = useState('');

  const [transactions, setTransactions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (header) return;

    Promise.all([
      apiFetch('/api/products').then((r) => r.json()),
      apiFetch('/api/stores').then((r) => r.json()),
    ])
      .then(([products, stores]) => {
        let productName = null, sku = null, price = null, attributes = null, qty = 0;
        for (const p of products) {
          const v = p.variants.find((v) => v.variant_id === variantId);
          if (v) {
            productName = p.product_name;
            sku = v.sku;
            price = v.price;
            attributes = v.attributes;
            qty = v.balances?.[storeId] || 0;
            break;
          }
        }
        const store = stores.find((s) => s.store_id === storeId);
        setHeader({
          product_name: productName,
          sku,
          price,
          attributes,
          qty,
          store_name: store?.location,
        });
      })
      .catch((err) => console.error('Failed to load context:', err));
  }, [header, variantId, storeId]);

  const loadHistory = useCallback((currentStoreName, from, to) => {
    if (!currentStoreName) return;

    setIsLoading(true);
    setErrorMessage('');

    apiFetch(`/api/transactions?variant_id=${variantId}`)
      .then((res) => res.json())
      .then((data) => {
        let scoped = data.filter(
          (tx) => tx.from_store_name === currentStoreName || tx.to_store_name === currentStoreName
        );

        if (from) scoped = scoped.filter((tx) => tx.created_at >= from);
        if (to) scoped = scoped.filter((tx) => tx.created_at.slice(0, 10) <= to);

        // Running balance has to be computed walking forward in time, so
        // sort ascending by the FULL timestamp first (not just the date —
        // several transactions can share a calendar day)...
        const chronological = [...scoped].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );

        let runningBalance = 0;
        const withBalance = chronological.map((tx) => {
          const inQty = tx.to_store_name === currentStoreName ? tx.qty : 0;
          const outQty = tx.from_store_name === currentStoreName ? tx.qty : 0;
          runningBalance += inQty - outQty;
          return { ...tx, inQty, outQty, runningBalance };
        });

        // ...then present newest-first, per the default sort requirement.
        // This is the same full-timestamp ordering already applied above,
        // just flipped for display.
        setTransactions(withBalance.reverse());
        setPage(1);
      })
      .catch((err) => {
        setErrorMessage('Could not reach server. Check it is running.');
        console.error(err);
      })
      .finally(() => setIsLoading(false));
  }, [variantId]);

  useEffect(() => {
    if (header?.store_name) {
      loadHistory(header.store_name, '', '');
    }
  }, [header?.store_name, loadHistory]);

  const runSearch = (e) => {
    e.preventDefault();
    setDateError('');

    if (!header?.store_name) return;

    if (fromDate && toDate && fromDate > toDate) {
      setDateError('"Date From" must be before or the same as "Date To".');
      return;
    }

    loadHistory(header.store_name, fromDate, toDate);
  };

  const totals = useMemo(
    () => transactions.reduce(
      (acc, tx) => ({ in: acc.in + tx.inQty, out: acc.out + tx.outQty }),
      { in: 0, out: 0 }
    ),
    [transactions]
  );

  const currentBalance = transactions.length > 0 ? transactions[0].runningBalance : (header?.qty ?? 0);

  const exportRows = useMemo(
    () =>
      transactions.map((tx) => ({
        Date: formatDateTime(tx.created_at),
        'Reference No.': tx.transaction_id.slice(0, 8),
        'Transaction Type': tx.transaction_type,
        Store: storeDisplayNameForExport(tx, header?.store_name),
        In: tx.inQty || '',
        Out: tx.outQty || '',
        'Running Balance': tx.runningBalance,
        'Done By': 'Merchant',
      })),
    [transactions, header?.store_name]
  );

  const handleExportExcel = () => exportRowsToExcel(exportRows, 'product-balance-history.xlsx', 'Transaction History');
  const handleExportCsv = () => exportRowsToCsv(exportRows, 'product-balance-history.csv');
  const handleExportPdf = () => exportRowsToPdf(exportRows, 'product-balance-history.pdf', 'Product Balance History');

  const totalPages = Math.max(1, Math.ceil(transactions.length / pageSize));
  const pagedTransactions = transactions.slice((page - 1) * pageSize, page * pageSize);

  const handlePageChange = (next) => {
    if (next < 1 || next > totalPages) return;
    setPage(next);
  };

  return (
    <div className="stock-adjustment">
      <button className="btn-secondary" onClick={() => navigate('/stock-balance')} style={{ alignSelf: 'flex-start' }}>
        &larr; Back to Product Balance
      </button>

      <section className="balance-card">
        <div className="balance-card-header">
          <Tag size={18} />
          <h2>Variation Info</h2>
        </div>

        <div className="variation-info-grid">
          <div className="variation-info-item">
            <span className="variation-info-label">SKU</span>
            <span className="variation-info-value">{header?.sku || '—'}</span>
          </div>
          <div className="variation-info-item">
            <span className="variation-info-label">Product Name</span>
            <span className="variation-info-value">{header?.product_name || '—'}</span>
          </div>
          <div className="variation-info-item">
            <span className="variation-info-label">Variation</span>
            <span className="variation-info-value">{formatVariation(header?.attributes)}</span>
          </div>
          <div className="variation-info-item">
            <span className="variation-info-label">Price</span>
            <span className="variation-info-value">
              {header?.price ? Number(header.price).toFixed(2) : '—'}
            </span>
          </div>
          <div className="variation-info-item">
            <span className="variation-info-label">Net Balance</span>
            <span className="balance-badge">{currentBalance}</span>
          </div>
        </div>
      </section>

      <section className="balance-card">
        <div className="balance-card-header">
          <h2>Filter</h2>
        </div>

        <form className="lookup-row" onSubmit={runSearch}>
          <div className="form-group">
            <label>Date From</label>
            <input
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Date To</label>
            <input
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>

          <button type="submit" className="btn-primary" disabled={isLoading || !header}>
            {isLoading ? 'Searching…' : 'Search'}
          </button>
        </form>

        {dateError && <p className="error-text">{dateError}</p>}
        {errorMessage && <p className="error-text">{errorMessage}</p>}
      </section>

      <section className="balance-card">
        <div className="balance-results-header">
          <h2>Product Inventory Details</h2>
        </div>

        {isLoading && transactions.length === 0 ? (
          <p className="empty-state">Loading…</p>
        ) : transactions.length === 0 ? (
          <p className="empty-state">No transactions found for this product at this store.</p>
        ) : (
          <>
            <TableControls
              pageSize={pageSize}
              onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
              onExportExcel={handleExportExcel}
              onExportCsv={handleExportCsv}
              onExportPdf={handleExportPdf}
              disabled={exportRows.length === 0}
            />

            <table className="history-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Reference No.</th>
                  <th>Transaction Type</th>
                  <th>Store</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Running Balance</th>
                  <th>Done By</th>
                </tr>
              </thead>
              <tbody>
                {pagedTransactions.map((tx) => (
                  <tr key={tx.transaction_id}>
                    <td data-label="Date">{formatDateTime(tx.created_at)}</td>
                    <td data-label="Reference No.">{tx.transaction_id.slice(0, 8)}</td>
                    <td data-label="Transaction Type">{tx.transaction_type}</td>
                    <td data-label="Store">{storeDisplayName(tx, header?.store_name)}</td>
                    <td data-label="In">{tx.inQty ? <span className="in-value">{tx.inQty}</span> : ''}</td>
                    <td data-label="Out">{tx.outQty ? <span className="out-value">{tx.outQty}</span> : ''}</td>
                    <td data-label="Running Balance"><span className="balance-badge">{tx.runningBalance}</span></td>
                    <td data-label="Done By">Merchant</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="history-total-label">Total (all filtered results)</td>
                  <td><span className="in-value">{totals.in}</span></td>
                  <td><span className="out-value">{totals.out}</span></td>
                  <td><span className="balance-badge">{currentBalance}</span></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>

            <div className="tc-pagination-bar">
              <button className="btn-secondary" onClick={() => handlePageChange(page - 1)} disabled={page <= 1}>
                Previous
              </button>
              <span className="tc-pagination-status">Page {page} of {totalPages}</span>
              <button className="btn-secondary" onClick={() => handlePageChange(page + 1)} disabled={page >= totalPages}>
                Next
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}