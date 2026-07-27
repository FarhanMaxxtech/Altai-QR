// src/pages/merchant/ApproveQrProductDetail.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import '../../styles/ApproveQrProduct.css';

function displayName(sku, productName) {
  if (!sku && !productName) return '—';
  return `${productName} (${sku})`;
}

export default function ApproveQrProductDetail() {
  const { variantId } = useParams();
  const navigate = useNavigate();

  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const load = () => {
    setIsLoading(true);
    setErrorMessage('');
    apiFetch(`/api/qrcode/pending-approvals/${variantId}`)
      .then((res) => {
        if (res.status === 404) {
          setNotFound(true);
          return [];
        }
        return res.json();
      })
      .then((data) => {
        setRows(data);
        setSelected(new Set(data.map((r) => r.qr_id))); // default: all selected
      })
      .catch((err) => {
        setErrorMessage('Could not reach server. Check it is running.');
        console.error(err);
      })
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantId]);

  const targetLabel = rows.length > 0 ? displayName(rows[0].target_sku, rows[0].target_product_name) : '';

  const allSelected = rows.length > 0 && selected.size === rows.length;

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.qr_id)));
  };

  const toggleOne = (qrId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(qrId)) next.delete(qrId);
      else next.add(qrId);
      return next;
    });
  };

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  const runAction = async (action) => {
    if (selectedIds.length === 0) {
      setStatusMessage('Select at least one serial number first.');
      return;
    }

    const confirmed = window.confirm(
      action === 'approve'
        ? `Approve ${selectedIds.length} unit(s) for ${targetLabel}?`
        : `Reject ${selectedIds.length} unit(s)? They will keep their previous product assignment.`
    );
    if (!confirmed) return;

    setIsProcessing(true);
    setStatusMessage('');
    try {
      const res = await apiFetch(`/api/qrcode/pending-approvals/${variantId}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ qr_ids: selectedIds }),
      });
      const result = await res.json();

      if (!res.ok) {
        setStatusMessage(result.message || `Could not ${action} the selected units.`);
        return;
      }

      const count = action === 'approve' ? result.approved_count : result.rejected_count;
      setStatusMessage(`${count} unit(s) ${action === 'approve' ? 'approved' : 'rejected'}.`);

      // Remaining rows still pending — reload; if none left, this group is done.
      const remaining = rows.filter((r) => !selectedIds.includes(r.qr_id));
      if (remaining.length === 0) {
        setTimeout(() => navigate('/approve-qr'), 800);
      } else {
        load();
      }
    } catch (err) {
      setStatusMessage('Could not reach server. Check it is running.');
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return <div className="listing-page"><p className="empty-state">Loading…</p></div>;
  }

  if (notFound || rows.length === 0) {
    return (
      <div className="listing-page">
        <p className="empty-state">No pending assignments found — they may have already been processed.</p>
        <button className="btn-secondary" onClick={() => navigate('/approve-qr')}>
          &larr; Back to Approve QR Product
        </button>
      </div>
    );
  }

  return (
    <div className="listing-page">
      <div className="listing-page-header">
        <h2>Approve Assignment</h2>
        <p className="listing-breadcrumb">
          Product InfoCenter / Approve QR Product / {targetLabel}
        </p>
      </div>

      <div className="listing-card">
        <div className="detail-section-header">
          <h3>{targetLabel}</h3>
          <span className="variant-count-badge">{rows.length} pending</span>
        </div>

        {errorMessage && <p className="error-text">{errorMessage}</p>}
        {statusMessage && <p className="status-text">{statusMessage}</p>}

        <table className="products-flat-table approve-qr-table">
          <thead>
            <tr>
              <th className="approve-qr-checkbox-col">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              </th>
              <th>Serial Number</th>
              <th>Current Product Name</th>
              <th>Previous Product Name</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.qr_id}>
                <td className="approve-qr-checkbox-col">
                  <input
                    type="checkbox"
                    checked={selected.has(r.qr_id)}
                    onChange={() => toggleOne(r.qr_id)}
                  />
                </td>
                <td className="approve-qr-serial-cell">{r.serial_number}</td>
                <td>{displayName(r.target_sku, r.target_product_name)}</td>
                <td>
                  {r.previous_sku
                    ? displayName(r.previous_sku, r.previous_product_name)
                    : <span className="muted-dash">— (first assignment)</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="approve-qr-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => navigate('/approve-qr')}
          >
            &larr; Back
          </button>
          <div className="approve-qr-actions-right">
            <button
              type="button"
              className="btn-remove-small approve-qr-reject-btn"
              onClick={() => runAction('reject')}
              disabled={isProcessing || selectedIds.length === 0}
            >
              Reject Selected ({selectedIds.length})
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => runAction('approve')}
              disabled={isProcessing || selectedIds.length === 0}
            >
              {isProcessing ? 'Processing…' : `Approve Selected (${selectedIds.length})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}