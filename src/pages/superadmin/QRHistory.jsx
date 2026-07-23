// src/pages/superadmin/QRHistory.jsx
import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../utils/api';
import * as XLSX from 'xlsx';
import '../../styles/superadmin/QRGenerator.css';
import '../../styles/superadmin/QRHistory.css';

const PAGE_SIZE = 20;

function formatTimestamp(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function QRHistory() {
  const [adminUsers, setAdminUsers] = useState([]);
  const [merchantFilter, setMerchantFilter] = useState('');
  const [fromDateFilter, setFromDateFilter] = useState('');
  const [toDateFilter, setToDateFilter] = useState('');
  const [dateError, setDateError] = useState('');

  const [batches, setBatches] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasSearched, setHasSearched] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    apiFetch('/api/users')
      .then((res) => res.json())
      .then((data) => setAdminUsers(data.filter((u) => u.role === 'admin')))
      .catch((err) => console.error('Failed to load merchants:', err));
  }, []);

  const runSearch = (targetPage = 1) => {
    setIsLoading(true);
    setErrorMessage('');

    const params = new URLSearchParams();
    if (merchantFilter) params.set('merchant_id', merchantFilter);
    if (fromDateFilter) params.set('from_date', fromDateFilter);
    if (toDateFilter) params.set('to_date', toDateFilter);
    params.set('page', targetPage);
    params.set('limit', PAGE_SIZE);

    apiFetch(`/api/superadmin/qrcode/batches/search?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        setBatches(data.batches || []);
        setTotal(data.total || 0);
        setPage(data.page || targetPage);
        setHasSearched(true);
      })
      .catch((err) => {
        setErrorMessage('Could not reach server. Check it is running.');
        console.error(err);
      })
      .finally(() => setIsLoading(false));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setDateError('');

    if (fromDateFilter && toDateFilter && fromDateFilter > toDateFilter) {
      setDateError('"From Date" must be before or the same as "To Date".');
      return;
    }

    runSearch(1);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handlePageChange = (nextPage) => {
    if (nextPage < 1 || nextPage > totalPages) return;
    runSearch(nextPage);
  };

  const handleDownload = async (batch) => {
    try {
      const res = await apiFetch(`/api/superadmin/qrcode/batches/${batch.batch_id}/codes`);
      const codes = await res.json();

      const rows = codes.map((qr) => ({
        'Serial Number': qr.serial_number,
        'QR Code': qr.qr_value,
      }));

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'QR Codes');
      XLSX.writeFile(workbook, batch.file_name);
    } catch (err) {
      alert('Could not reach server. Check it is running.');
      console.error(err);
    }
  };

  return (
    <div className="qr-generator">
      <section className="generate-section">
        <h2>History Generated QR</h2>
        <form className="history-filter-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Merchant</label>
            <select value={merchantFilter} onChange={(e) => setMerchantFilter(e.target.value)}>
              <option value="">All merchants</option>
              {adminUsers.map((u) => (
                <option key={u.user_id} value={u.user_id}>{u.name} ({u.email})</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>From Date</label>
            <input
              type="date"
              value={fromDateFilter}
              max={toDateFilter || undefined}
              onChange={(e) => setFromDateFilter(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>To Date</label>
            <input
              type="date"
              value={toDateFilter}
              min={fromDateFilter || undefined}
              onChange={(e) => setToDateFilter(e.target.value)}
            />
          </div>

          <button type="submit" className="btn-primary" disabled={isLoading}>
            {isLoading ? 'Searching…' : 'Search'}
          </button>
        </form>
        {dateError && <p className="error-text">{dateError}</p>}
        {errorMessage && <p className="error-text">{errorMessage}</p>}
      </section>

      <section className="qr-list-section">
        <h2>Results {hasSearched ? `(${total})` : ''}</h2>

        {!hasSearched ? (
          <p className="empty-state">Choose your filters and click Search to view generated batches.</p>
        ) : batches.length === 0 ? (
          <p className="empty-state">No batches match your search.</p>
        ) : (
          <>
            <table className="qr-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Company</th>
                  <th>Merchant</th>
                  <th>Quantity</th>
                  <th>Serial Range</th>
                  <th>Generated Date</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.batch_id}>
                    <td className="file-cell">{batch.file_name}</td>
                    <td>{batch.company_name}</td>
                    <td>{batch.assigned_user_name}</td>
                    <td>{batch.quantity}</td>
                    <td className="serial-cell">{batch.serial_start} – {batch.serial_end}</td>
                    <td>{formatTimestamp(batch.created_at)}</td>
                    <td>
                      <button className="btn-download" onClick={() => handleDownload(batch)}>
                        Download
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="pagination-bar">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => handlePageChange(page - 1)}
                disabled={page <= 1}
              >
                Previous
              </button>
              <span className="pagination-status">Page {page} of {totalPages}</span>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= totalPages}
              >
                Next
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}