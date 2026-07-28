// src/pages/merchant/AssignQrToProduct.jsx
import React, { useState, useRef, useEffect } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { QrCode as QrCodeIcon, Trash2, X, Clock } from 'lucide-react';
import { apiFetch } from '../../utils/api';
import '../../styles/AssignQrToProduct.css';
import '../../styles/ApproveQrProduct.css';

function displayName(sku, productName) {
  if (!sku && !productName) return '—';
  return `${productName} (${sku})`;
}

function formatTimestamp(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AssignQrToProduct() {
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState('');
  const [variantId, setVariantId] = useState('');

  const [scanCart, setScanCart] = useState([]);
  const [qrUrlInput, setQrUrlInput] = useState('');
  const [scanError, setScanError] = useState('');

  const [batchNumber, setBatchNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');

  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const html5QrRef = useRef(null);
  const lastScannedRef = useRef('');
  const qrUrlInputRef = useRef(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState('');

  // --- Right sidebar (review & approve) state ------------------------------
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  // sidebar has two views: 'list' (all pending groups) or 'detail' (one variant's rows)
  const [sidebarView, setSidebarView] = useState('list');

  const [pendingGroups, setPendingGroups] = useState([]);
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [groupsError, setGroupsError] = useState('');

  const [reviewVariantId, setReviewVariantId] = useState(null);
  const [reviewLabel, setReviewLabel] = useState('');
  const [reviewRows, setReviewRows] = useState([]);
  const [reviewSelected, setReviewSelected] = useState(new Set());
  const [isLoadingReview, setIsLoadingReview] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [reviewStatusMessage, setReviewStatusMessage] = useState('');
  const [isProcessingReview, setIsProcessingReview] = useState(false);

  useEffect(() => {
    apiFetch('/api/products')
      .then((res) => res.json())
      .then((data) => setProducts(data))
      .catch((err) => console.error('Failed to load products:', err));
  }, []);

  useEffect(() => {
    return () => {
      if (html5QrRef.current) html5QrRef.current.stop().catch(() => {});
    };
  }, []);

  const selectedProduct = products.find((p) => p.product_id === productId);
  const variantOptions = selectedProduct ? selectedProduct.variants : [];

  const handleProductChange = (e) => {
    setProductId(e.target.value);
    setVariantId('');
  };

  // Backend checks the value against BOTH serial_number and qr_value,
  // so a single field/param can accept either — no need to distinguish.
  const addToCart = async (value) => {
    setScanError('');

    const alreadyScanned = scanCart.some(
      (item) => item.serial_number === value || item.qr_value === value
    );
    if (alreadyScanned) {
      setScanError('This code has already been scanned in this batch.');
      return;
    }

    try {
      const res = await apiFetch(`/api/qrcode/scan-lookup?serial_number=${encodeURIComponent(value)}`);
      const result = await res.json();

      if (!res.ok) {
        setScanError(result.message || 'Could not recognize this code.');
        return;
      }

      setScanCart((prev) => [...prev, result]);
    } catch (err) {
      setScanError('Could not reach server. Check it is running.');
      console.error(err);
    }
  };

  const handleQrUrlSubmit = (e) => {
    e.preventDefault();
    if (!qrUrlInput.trim()) return;
    addToCart(qrUrlInput.trim());
    setQrUrlInput('');
  };

  const removeFromCart = (qrId) => {
    setScanCart((prev) => prev.filter((item) => item.qr_id !== qrId));
  };

  const clearCart = () => {
    setScanCart([]);
    setScanError('');
    setSubmitMessage('');
  };

  const toggleCamera = async () => {
    if (isCameraOpen) {
      if (html5QrRef.current) {
        await html5QrRef.current.stop().then(() => html5QrRef.current.clear()).catch(() => {});
      }
      setIsCameraOpen(false);
      return;
    }

    setScanError('');
    lastScannedRef.current = '';
    setIsCameraOpen(true);

    setTimeout(async () => {
      try {
        const html5Qr = new Html5Qrcode('assign-qr-reader');
        html5QrRef.current = html5Qr;

        await html5Qr.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (decodedText) => {
            const trimmed = decodedText.trim();
            if (trimmed === lastScannedRef.current) return;
            lastScannedRef.current = trimmed;
            addToCart(trimmed);
          },
          () => {}
        );
      } catch (err) {
        setScanError('Could not access camera. Check permissions and try again.');
        setIsCameraOpen(false);
      }
    }, 0);
  };

  // --- Sidebar: list of ALL pending groups (used by the "Pending" button,
  // so users can always get back to a review they didn't finish acting on) ---

  const loadPendingGroups = () => {
    setIsLoadingGroups(true);
    setGroupsError('');
    apiFetch('/api/qrcode/pending-approvals')
      .then((res) => res.json())
      .then((data) => setPendingGroups(data))
      .catch((err) => {
        setGroupsError('Could not reach server. Check it is running.');
        console.error(err);
      })
      .finally(() => setIsLoadingGroups(false));
  };

  const openPendingSidebar = () => {
    setSidebarView('list');
    setIsSidebarOpen(true);
    loadPendingGroups();
  };

  const closeSidebar = () => {
    setIsSidebarOpen(false);
  };

  const backToList = () => {
    setSidebarView('list');
    setReviewVariantId(null);
    setReviewRows([]);
    setReviewLabel('');
    setReviewStatusMessage('');
    setReviewError('');
    loadPendingGroups();
  };

  // --- Sidebar: detail (one variant's pending rows) ------------------------

  const loadReview = (varId, label) => {
    setSidebarView('detail');
    setReviewVariantId(varId);
    if (label) setReviewLabel(label);
    setIsLoadingReview(true);
    setReviewError('');
    apiFetch(`/api/qrcode/pending-approvals/${varId}`)
      .then((res) => {
        if (res.status === 404) return [];
        return res.json();
      })
      .then((data) => {
        setReviewRows(data);
        setReviewSelected(new Set(data.map((r) => r.qr_id)));
        if (data.length > 0) {
          setReviewLabel(displayName(data[0].target_sku, data[0].target_product_name));
        }
      })
      .catch((err) => {
        setReviewError('Could not reach server. Check it is running.');
        console.error(err);
      })
      .finally(() => setIsLoadingReview(false));
  };

  const openGroupFromList = (group) => {
    setIsSidebarOpen(true);
    loadReview(group.variant_id, displayName(group.sku, group.product_name));
  };

  const allReviewSelected = reviewRows.length > 0 && reviewSelected.size === reviewRows.length;

  const toggleAllReview = () => {
    setReviewSelected(allReviewSelected ? new Set() : new Set(reviewRows.map((r) => r.qr_id)));
  };

  const toggleOneReview = (qrId) => {
    setReviewSelected((prev) => {
      const next = new Set(prev);
      if (next.has(qrId)) next.delete(qrId);
      else next.add(qrId);
      return next;
    });
  };

  const runReviewAction = async (action) => {
    const selectedIds = Array.from(reviewSelected);
    if (selectedIds.length === 0) {
      setReviewStatusMessage('Select at least one serial number first.');
      return;
    }

    const confirmed = window.confirm(
      action === 'approve'
        ? `Approve ${selectedIds.length} unit(s) for ${reviewLabel}?`
        : `Reject ${selectedIds.length} unit(s)? They will keep their previous product assignment.`
    );
    if (!confirmed) return;

    setIsProcessingReview(true);
    setReviewStatusMessage('');
    try {
      const res = await apiFetch(`/api/qrcode/pending-approvals/${reviewVariantId}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ qr_ids: selectedIds }),
      });
      const result = await res.json();

      if (!res.ok) {
        setReviewStatusMessage(result.message || `Could not ${action} the selected units.`);
        return;
      }

      const count = action === 'approve' ? result.approved_count : result.rejected_count;
      setReviewStatusMessage(`${count} unit(s) ${action === 'approve' ? 'approved' : 'rejected'}.`);

      const remaining = reviewRows.filter((r) => !selectedIds.includes(r.qr_id));
      if (remaining.length === 0) {
        // Nothing left pending for this variant — go back to the list view
        // (which will now reflect this group being gone).
        setTimeout(() => backToList(), 600);
      } else {
        loadReview(reviewVariantId);
      }
    } catch (err) {
      setReviewStatusMessage('Could not reach server. Check it is running.');
      console.error(err);
    } finally {
      setIsProcessingReview(false);
    }
  };

  // --- Submit assignment request -------------------------------------------

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitMessage('');

    if (scanCart.length === 0) {
      setSubmitMessage('Scan at least one QR code first.');
      return;
    }
    if (!variantId) {
      setSubmitMessage('Select a product and variant.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiFetch('/api/qrcode/assign-scan', {
        method: 'POST',
        body: JSON.stringify({
          qr_ids: scanCart.map((item) => item.qr_id),
          variant_id: variantId,
          remarks: batchNumber.trim() || null,
          expiry_date: expiryDate || null,
        }),
      });
      const result = await res.json();

      if (!res.ok) {
        setSubmitMessage(result.message || 'Could not assign codes.');
        return;
      }

      setSubmitMessage(`${result.requested_count} code(s) sent for approval.`);

      // Auto-open the sidebar straight into this variant's review, so the
      // user sees what they just submitted immediately.
      setReviewStatusMessage('');
      setIsSidebarOpen(true);
      loadReview(variantId);

      setScanCart([]);
      setBatchNumber('');
      setExpiryDate('');
      setProductId('');
      setVariantId('');
      qrUrlInputRef.current?.focus();
    } catch (err) {
      setSubmitMessage('Could not reach server. Check it is running.');
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const lastScannedSerial = scanCart.length > 0 ? scanCart[scanCart.length - 1].serial_number : '';
  const isValid = scanCart.length > 0 && Boolean(variantId);

  return (
    <div className="listing-page">

      <div className="listing-card assign-qr-card">
            <div className="assign-qr-card-topbar">
              <button
                type="button"
                className="btn-pending-approvals"
                onClick={openPendingSidebar}
              >
                <Clock size={14} />
                Pending
              </button>
            </div>
        <form onSubmit={handleSubmit} className="assign-qr-form">
          <div className="assign-qr-grid">
            <div className="form-group">
                <label>
                  Serial / Label Number(s) Quantity scanned:{' '}
                  <span className="assign-qr-count">{scanCart.length}</span>
                  <span className="required-asterisk">*</span>
                </label>
                <input
                  type="text"
                  className="assign-qr-serial-display"
                  value={lastScannedSerial}
                  placeholder="Scanned serial number will appear here"
                  readOnly
                  disabled
                />
              </div>

            <div className="form-group form-group-wide">
              <label>QR Code</label>
              <div className="assign-qr-input-with-icon">
                <input
                  ref={qrUrlInputRef}
                  type="text"
                  value={qrUrlInput}
                  onChange={(e) => setQrUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleQrUrlSubmit(e);
                  }}
                  placeholder="Point scanner here, or paste/type a serial number or QR value..."
                  autoFocus
                />
                <button
                  type="button"
                  className="assign-qr-icon-btn"
                  onClick={toggleCamera}
                  aria-label="Scan with camera"
                >
                  <QrCodeIcon size={18} />
                </button>
              </div>
              <p className="assign-qr-hint">You can either enter the QR code url or scan the QR code.</p>

              {isCameraOpen && (
                <div className="assign-qr-camera-block">
                  <div id="assign-qr-reader" className="assign-qr-reader-box" />
                  <button type="button" className="btn-secondary" onClick={toggleCamera}>
                    Stop Camera
                  </button>
                </div>
              )}
            </div>

            <div className="form-group">
              <label>Remark / Batch Number</label>
              <input
                type="text"
                value={batchNumber}
                onChange={(e) => setBatchNumber(e.target.value.slice(0, 255))}
                maxLength={255}
              />
              <span className="assign-qr-char-count">{batchNumber.length} / 255</span>
            </div>

            <div className="form-group">
              <label>Expiry Date</label>
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>Product <span className="required-asterisk">*</span></label>
              <select value={productId} onChange={handleProductChange}>
                <option value="">-- Select Product --</option>
                {products.map((p) => (
                  <option key={p.product_id} value={p.product_id}>{p.product_name}</option>
                ))}
              </select>
            </div>

            {productId && (
              <div className="form-group">
                <label>Variant <span className="required-asterisk">*</span></label>
                <select value={variantId} onChange={(e) => setVariantId(e.target.value)}>
                  <option value="">-- Select Variant --</option>
                  {variantOptions.map((v) => (
                    <option key={v.variant_id} value={v.variant_id}>{v.sku}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {scanCart.length > 0 && (
            <div className="assign-qr-scanned-list">
              <div className="assign-qr-scanned-header">
                <span>Scanned Codes ({scanCart.length})</span>
                <button type="button" className="btn-clear-all" onClick={clearCart}>
                  <Trash2 size={14} /> Clear
                </button>
              </div>
              <ul>
                {scanCart.map((item) => (
                  <li key={item.qr_id}>
                    <span className="assign-qr-serial">
                      {item.serial_number}
                      {item.status === 'checked_out' && (
                        <span className="assign-qr-reused-badge"> (reused — was checked out)</span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="assign-qr-remove"
                      onClick={() => removeFromCart(item.qr_id)}
                      aria-label="Remove"
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {scanError && <p className="error-text">{scanError}</p>}
          {submitMessage && <p className="status-text">{submitMessage}</p>}

          <div className="assign-qr-actions">
            <button type="submit" className="btn-primary" disabled={!isValid || isSubmitting}>
              {isSubmitting ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </form>
      </div>

      {/* --- Right sidebar: Review & Approve pending assignments --- */}
      {isSidebarOpen && (
        <div className="pending-sidebar-overlay" onClick={closeSidebar} />
      )}
      <aside className={`pending-sidebar ${isSidebarOpen ? 'pending-sidebar-open' : ''}`}>
        <div className="pending-sidebar-header">
          <h3>{sidebarView === 'list' ? 'Pending Approvals' : `Review: ${reviewLabel}`}</h3>
          <button type="button" className="pending-sidebar-close" onClick={closeSidebar} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="pending-sidebar-body">
          {sidebarView === 'list' ? (
            <>
              {groupsError && <p className="error-text">{groupsError}</p>}
              {isLoadingGroups ? (
                <p className="empty-state">Loading…</p>
              ) : pendingGroups.length === 0 ? (
                <p className="empty-state">No pending assignments right now.</p>
              ) : (
                <ul className="pending-groups-list">
                  {pendingGroups.map((g) => (
                    <li key={g.variant_id}>
                      <button
                        type="button"
                        className="pending-group-item"
                        onClick={() => openGroupFromList(g)}
                      >
                        <span className="pending-group-name">{displayName(g.sku, g.product_name)}</span>
                        <span className="pending-group-meta">
                          <span className="variant-count-badge">{g.pending_count} pending</span>
                          <span className="pending-group-date">{formatTimestamp(g.last_requested_at)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <button type="button" className="btn-secondary pending-back-btn" onClick={backToList}>
                &larr; Back to all pending
              </button>

              {reviewError && <p className="error-text">{reviewError}</p>}
              {reviewStatusMessage && <p className="status-text">{reviewStatusMessage}</p>}

              {isLoadingReview ? (
                <p className="empty-state">Loading…</p>
              ) : reviewRows.length === 0 ? (
                <p className="empty-state">No pending assignments found — they may have already been processed.</p>
              ) : (
                <>
                  <div className="pending-review-table-wrapper">
                    <table className="products-flat-table approve-qr-table">
                      <thead>
                        <tr>
                          <th className="approve-qr-checkbox-col">
                            <input type="checkbox" checked={allReviewSelected} onChange={toggleAllReview} />
                          </th>
                          <th>Serial Number</th>
                          <th>New Product Name</th>
                          <th>Previous Product Name</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reviewRows.map((r) => (
                          <tr key={r.qr_id}>
                            <td className="approve-qr-checkbox-col">
                              <input
                                type="checkbox"
                                checked={reviewSelected.has(r.qr_id)}
                                onChange={() => toggleOneReview(r.qr_id)}
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
                  </div>

                  <div className="approve-qr-actions pending-sidebar-actions">
                    <button
                      type="button"
                      className="btn-remove-small approve-qr-reject-btn"
                      onClick={() => runReviewAction('reject')}
                      disabled={isProcessingReview || reviewSelected.size === 0}
                    >
                      Reject Selected ({reviewSelected.size})
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => runReviewAction('approve')}
                      disabled={isProcessingReview || reviewSelected.size === 0}
                    >
                      {isProcessingReview ? 'Processing…' : `Approve Selected (${reviewSelected.size})`}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}