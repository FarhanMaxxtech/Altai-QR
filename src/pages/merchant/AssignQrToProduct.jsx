// src/pages/merchant/AssignQrToProduct.jsx
import React, { useState, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { ScanBarcode, Camera, X } from 'lucide-react';
import { apiFetch } from '../../utils/api';
import { useEffect } from 'react';
import '../../styles/AssignQrToProduct.css';
import { useLocation } from 'react-router-dom';

const MAX_RANGE_SIZE = 500;
const SUMMARY_PAGE_SIZE = 50;

function displayName(sku, productName) {
  if (!sku && !productName) return '—';
  return `${productName} (${sku})`;
}

function badgeInfo(item) {
  // A code that was previously checked out is being reused on a new label —
  // everything else (unassigned / pending / first-time) counts as "New".
  return item.status === 'checked_out'
    ? { label: 'Used', className: 'aq-badge aq-badge-used' }
    : { label: 'New', className: 'aq-badge aq-badge-new' };
}

export default function AssignQrToProduct() {
  const location = useLocation();
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState('');
  const [variantId, setVariantId] = useState('');

  // --- Scan station ---------------------------------------------------------
  const [scanCart, setScanCart] = useState([]);
  const [scanInput, setScanInput] = useState('');
  const [scanError, setScanError] = useState('');
  const scanInputRef = useRef(null);

  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const html5QrRef = useRef(null);
  const lastScannedRef = useRef('');

  const [rangePrefix, setRangePrefix] = useState('');
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [rangeError, setRangeError] = useState('');
  const [isAddingRange, setIsAddingRange] = useState(false);

  // --- Assignment details -----------------------------------------------
  const [batchNumber, setBatchNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState('');

  // --- Summary Assign modal -----------------------------------------------
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [summaryVariantId, setSummaryVariantId] = useState(null);
  const [summaryLabel, setSummaryLabel] = useState('');
  const [summaryRows, setSummaryRows] = useState([]);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [summaryStatusMessage, setSummaryStatusMessage] = useState('');
  const [isProcessingSummary, setIsProcessingSummary] = useState(false);
  const [summaryPage, setSummaryPage] = useState(1);

  useEffect(() => {
    apiFetch('/api/products')
      .then((res) => res.json())
      .then((data) => setProducts(data))
      .catch((err) => console.error('Failed to load products:', err));
  }, []);

  useEffect(() => {
  if (products.length === 0 || !location.state) return;
  const { presetProductId, presetVariantId } = location.state;
  if (presetProductId) setProductId(presetProductId);
  if (presetVariantId) setVariantId(presetVariantId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [products]);

  const selectedProduct = products.find((p) => p.product_id === productId);
  const variantOptions = selectedProduct ? selectedProduct.variants : [];
  const selectedVariant = variantOptions.find((v) => v.variant_id === variantId);

  const handleProductChange = (e) => {
    setProductId(e.target.value);
    setVariantId('');
  };

  // --- Scanning helpers -------------------------------------------------

  // Looks up one or more serials/QR values, skipping ones already in the
  // cart, and reports any that couldn't be recognized.
  const addManyToCart = async (values) => {
    setScanError('');
    let current = [...scanCart];
    const failures = [];

    for (const raw of values) {
      const value = raw.trim();
      if (!value) continue;

      const alreadyScanned = current.some(
        (item) => item.serial_number === value || item.qr_value === value
      );
      if (alreadyScanned) continue;

      try {
        const res = await apiFetch(`/api/qrcode/scan-lookup?serial_number=${encodeURIComponent(value)}`);
        const result = await res.json();

        if (!res.ok) {
          failures.push(value);
          continue;
        }
        current = [...current, result];
      } catch (err) {
        failures.push(value);
        console.error(err);
      }
    }

    setScanCart(current);
    if (failures.length > 0) {
      const shown = failures.slice(0, 5).join(', ');
      const more = failures.length > 5 ? `, +${failures.length - 5} more` : '';
      setScanError(`${failures.length} code(s) could not be recognized: ${shown}${more}`);
    }
  };

  const handleScanSubmit = (e) => {
    e.preventDefault();
    if (!scanInput.trim()) return;
    addManyToCart([scanInput.trim()]);
    setScanInput('');
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
        const html5Qr = new Html5Qrcode('assign-qr-camera-reader');
        html5QrRef.current = html5Qr;

        await html5Qr.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (decodedText) => {
            const trimmed = decodedText.trim();
            if (trimmed === lastScannedRef.current) return;
            lastScannedRef.current = trimmed;
            addManyToCart([trimmed]);
          },
          () => {}
        );
      } catch (err) {
        setScanError('Could not access camera. Check permissions and try again.');
        setIsCameraOpen(false);
      }
    }, 0);
  };

  useEffect(() => {
    return () => {
      if (html5QrRef.current) html5QrRef.current.stop().catch(() => {});
    };
  }, []);

  // --- Serial range ----------------------------------------------------

  const handleAddRange = async (e) => {
    e.preventDefault();
    setRangeError('');

    const fromStr = rangeFrom.trim();
    const toStr = rangeTo.trim();

    if (!/^\d+$/.test(fromStr) || !/^\d+$/.test(toStr)) {
      setRangeError('"From" and "To" must be numbers only.');
      return;
    }

    const width = Math.max(fromStr.length, toStr.length);
    const fromNum = parseInt(fromStr, 10);
    const toNum = parseInt(toStr, 10);

    if (fromNum > toNum) {
      setRangeError('"From" must be less than or equal to "To".');
      return;
    }
    if (toNum - fromNum + 1 > MAX_RANGE_SIZE) {
      setRangeError(`Please scan ${MAX_RANGE_SIZE} codes or fewer at a time.`);
      return;
    }

    const prefix = rangePrefix.trim();
    const serials = [];
    for (let n = fromNum; n <= toNum; n++) {
      const padded = String(n).padStart(width, '0');
      serials.push(prefix ? `${prefix}-${padded}` : padded);
    }

    setIsAddingRange(true);
    try {
      await addManyToCart(serials);
      setRangeFrom('');
      setRangeTo('');
    } finally {
      setIsAddingRange(false);
    }
  };

  // --- Assignment submit -------------------------------------------------

  const codesQueued = scanCart.length;
  const targetLabel = selectedVariant ? displayName(selectedVariant.sku, selectedProduct.product_name) : null;
  const isReady = codesQueued > 0 && Boolean(variantId);

  const handleCancel = () => {
    setScanCart([]);
    setProductId('');
    setVariantId('');
    setBatchNumber('');
    setExpiryDate('');
    setScanError('');
    setSubmitMessage('');
  };

  const loadSummary = (varId, fallbackLabel) => {
    setSummaryVariantId(varId);
    setSummaryLabel(fallbackLabel);
    setSummaryPage(1);
    setIsLoadingSummary(true);
    setSummaryError('');
    setSummaryStatusMessage('');
    setIsSummaryOpen(true);

    apiFetch(`/api/qrcode/pending-approvals/${varId}`)
      .then((res) => (res.status === 404 ? [] : res.json()))
      .then((data) => {
        setSummaryRows(data);
        if (data.length > 0) {
          setSummaryLabel(displayName(data[0].target_sku, data[0].target_product_name));
        }
      })
      .catch((err) => {
        setSummaryError('Could not reach server. Check it is running.');
        console.error(err);
      })
      .finally(() => setIsLoadingSummary(false));
  };

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

      const label = targetLabel;
      const varId = variantId;

      setScanCart([]);
      setBatchNumber('');
      setExpiryDate('');
      setProductId('');
      setVariantId('');
      setSubmitMessage('');
      scanInputRef.current?.focus();

      loadSummary(varId, label);
    } catch (err) {
      setSubmitMessage('Could not reach server. Check it is running.');
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- Summary modal actions ----------------------------------------------

  const removeSummaryRow = (qrId) => {
    setSummaryRows((prev) => prev.filter((r) => r.qr_id !== qrId));
  };

  const closeSummary = () => {
    setIsSummaryOpen(false);
    setSummaryRows([]);
    setSummaryVariantId(null);
  };

  const runSummaryAction = async (action) => {
    const qrIds = summaryRows.map((r) => r.qr_id);
    if (qrIds.length === 0) return;

    const confirmed = window.confirm(
      action === 'approve'
        ? `Confirm and submit ${qrIds.length} unit(s) for ${summaryLabel}?`
        : `Reject ${qrIds.length} unit(s)? They will keep their previous product assignment.`
    );
    if (!confirmed) return;

    setIsProcessingSummary(true);
    setSummaryStatusMessage('');
    try {
      const res = await apiFetch(`/api/qrcode/pending-approvals/${summaryVariantId}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ qr_ids: qrIds }),
      });
      const result = await res.json();

      if (!res.ok) {
        setSummaryStatusMessage(result.message || `Could not ${action} the selected units.`);
        return;
      }

      const count = action === 'approve' ? result.approved_count : result.rejected_count;
      setSummaryStatusMessage(`${count} unit(s) ${action === 'approve' ? 'confirmed' : 'rejected'}.`);
      setSummaryRows([]);
      setTimeout(() => closeSummary(), 900);
    } catch (err) {
      setSummaryStatusMessage('Could not reach server. Check it is running.');
      console.error(err);
    } finally {
      setIsProcessingSummary(false);
    }
  };

  const summaryTotalPages = Math.max(1, Math.ceil(summaryRows.length / SUMMARY_PAGE_SIZE));
  const pagedSummaryRows = summaryRows.slice(
    (summaryPage - 1) * SUMMARY_PAGE_SIZE,
    summaryPage * SUMMARY_PAGE_SIZE
  );

  return (
    <div className="aq-page">

      <div className="aq-layout">
        {/* --- Left column: Scan station + scanned list --- */}
        <div className="aq-left-col">
          <section className="aq-scan-station">
            <div className="aq-scan-station-header">
              <h3>Scan station</h3>
              <span className="aq-scanner-status">
                <span className="aq-scanner-dot" />
                Scanner ready
              </span>
            </div>

            <form className="aq-scan-row" onSubmit={handleScanSubmit}>
              <div className="aq-scan-input-wrap">
                <ScanBarcode size={18} className="aq-scan-icon" />
                <input
                  ref={scanInputRef}
                  type="text"
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  placeholder="Point scanner here, or type a serial / QR value"
                  autoFocus
                  disabled={isCameraOpen}
                />
              </div>
              <button type="submit" className="aq-btn-add" disabled={isCameraOpen}>
                Add
              </button>
              <button
                type="button"
                className={`aq-btn-camera ${isCameraOpen ? 'aq-btn-camera-active' : ''}`}
                onClick={toggleCamera}
                aria-label={isCameraOpen ? 'Stop camera' : 'Use camera'}
              >
                <Camera size={18} />
              </button>
            </form>

            {isCameraOpen && (
              <div className="aq-camera-block">
                <div id="assign-qr-camera-reader" className="aq-camera-reader-box" />
                <button type="button" className="aq-btn-stop-camera" onClick={toggleCamera}>
                  Stop Camera
                </button>
              </div>
            )}

            <div className="aq-scan-hints">
              <span>ENTER to add · scans append automatically</span>
              <span>No duplicates</span>
            </div>

            <div className="aq-divider" />

            <p className="aq-range-label">Or key in a serial range</p>

            <form className="aq-range-row" onSubmit={handleAddRange}>
              <input
                type="text"
                className="aq-range-prefix"
                value={rangePrefix}
                onChange={(e) => setRangePrefix(e.target.value)}
                placeholder="eg: EW"
              />
              <div className="aq-range-field">
                <span className="aq-range-field-label"></span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={rangeFrom}
                  onChange={(e) => setRangeFrom(e.target.value)}
                  placeholder="From"
                />
              </div>
              <span className="aq-range-arrow">→</span>
              <div className="aq-range-field">
                <span className="aq-range-field-label"></span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={rangeTo}
                  onChange={(e) => setRangeTo(e.target.value)}
                  placeholder="To"
                />
              </div>
              <button
                type="submit"
                className="aq-btn-add-range"
                disabled={isAddingRange || !rangeFrom || !rangeTo}
              >
                {isAddingRange ? 'Adding…' : 'Add range'}
              </button>
            </form>

            <p className="aq-range-hint">Numbers only · prefix is optional · leading zeros kept</p>

            {rangeError && <p className="aq-error-text aq-error-text-on-dark">{rangeError}</p>}
            {scanError && <p className="aq-error-text aq-error-text-on-dark">{scanError}</p>}
          </section>

          <section className="aq-scanned-card">
            <div className="aq-scanned-header">
              <span className="aq-scanned-title">Scanned this session</span>
              <span className="aq-scanned-count-badge">{scanCart.length}</span>
              <div className="aq-scanned-header-spacer" />
              <button type="button" className="aq-btn-clear-all" onClick={clearCart} disabled={scanCart.length === 0}>
                Clear all
              </button>
            </div>

            {scanCart.length === 0 ? (
              <p className="aq-empty-state">No codes scanned yet. Scan a label or key in a range above.</p>
            ) : (
              <ul className="aq-scanned-list">
                {scanCart.map((item, index) => {
                  const badge = badgeInfo(item);
                  return (
                    <li key={item.qr_id} className="aq-scanned-row">
                      <span className="aq-scanned-index">{String(index + 1).padStart(2, '0')}</span>
                      <span className="aq-scanned-serial">{item.serial_number}</span>
                      <span className={badge.className}>{badge.label}</span>
                      <button
                        type="button"
                        className="aq-scanned-remove"
                        onClick={() => removeFromCart(item.qr_id)}
                        aria-label="Remove"
                      >
                        <X size={14} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* --- Right column: Assignment details --- */}
        <section className="aq-details-card">
          <h3>Assignment details</h3>

          <div className="aq-field">
            <label>Product <span className="required-asterisk">*</span></label>
            <select value={productId} onChange={handleProductChange}>
              <option value="">— Select product —</option>
              {products.map((p) => (
                <option key={p.product_id} value={p.product_id}>{p.product_name}</option>
              ))}
            </select>
          </div>

          <div className="aq-field">
            <label>Variant <span className="required-asterisk">*</span></label>
            <select
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
              disabled={!productId}
            >
              <option value="">{productId ? '— Select variant —' : 'Select a product first'}</option>
              {variantOptions.map((v) => (
                <option key={v.variant_id} value={v.variant_id}>{v.sku}</option>
              ))}
            </select>
          </div>

          <div className="aq-field">
            <div className="aq-field-label-row">
              <label>Remark / Batch Number</label>
              <span className="aq-char-count">{batchNumber.length} / 255</span>
            </div>
            <input
              type="text"
              value={batchNumber}
              onChange={(e) => setBatchNumber(e.target.value.slice(0, 255))}
              placeholder="e.g. BATCH-2026-07"
              maxLength={255}
            />
          </div>

          <div className="aq-field">
            <label>Expiry Date</label>
            <input
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
            />
          </div>

          <div className="aq-queue-summary">
            <span className="aq-queue-count">
              {codesQueued} code{codesQueued === 1 ? '' : 's'} queued
              {targetLabel && <span className="aq-queue-target"> → {targetLabel}</span>}
            </span>
            <span className={`aq-status-pill ${isReady ? 'aq-status-pill-ready' : ''}`}>
              {isReady ? 'Ready' : 'Incomplete'}
            </span>
          </div>

          {submitMessage && <p className="aq-error-text">{submitMessage}</p>}

          <div className="aq-details-actions">
            <button type="button" className="aq-btn-secondary" onClick={handleCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="aq-btn-primary"
              onClick={handleSubmit}
              disabled={!isReady || isSubmitting}
            >
              {isSubmitting ? 'Assigning…' : `Assign ${codesQueued} code${codesQueued === 1 ? '' : 's'}`}
            </button>
          </div>
        </section>
      </div>

      {/* --- Summary Assign modal --- */}
      {isSummaryOpen && (
        <div className="aq-modal-overlay">
          <div className="aq-modal-panel">
            <div className="aq-modal-header">
              <div className="aq-modal-header-left">
                <h3>Summary Assign: {summaryLabel}</h3>
                <span className="aq-pending-badge">{summaryRows.length} pending</span>
              </div>
              <button type="button" className="aq-modal-close" onClick={closeSummary} aria-label="Close">
                <X size={16} />
              </button>
            </div>

            <div className="aq-modal-body">
              {summaryError && <p className="aq-error-text">{summaryError}</p>}
              {summaryStatusMessage && <p className="aq-status-text">{summaryStatusMessage}</p>}

              {isLoadingSummary ? (
                <p className="aq-empty-state">Loading…</p>
              ) : summaryRows.length === 0 ? (
                <p className="aq-empty-state">No pending assignments — they may have already been processed.</p>
              ) : (
                <>
                  <div className="aq-summary-table-wrapper">
                    <table className="aq-summary-table">
                      <thead>
                        <tr>
                          <th>No.</th>
                          <th>Serial Number</th>
                          <th>New Product Name</th>
                          <th>Previous Product Name</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedSummaryRows.map((r, i) => (
                          <tr key={r.qr_id}>
                            <td>{(summaryPage - 1) * SUMMARY_PAGE_SIZE + i + 1}</td>
                            <td className="aq-summary-serial-cell">{r.serial_number}</td>
                            <td>{displayName(r.target_sku, r.target_product_name)}</td>
                            <td>
                              {r.previous_sku
                                ? displayName(r.previous_sku, r.previous_product_name)
                                : <span className="aq-muted-dash">— (first assignment)</span>}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="aq-btn-remove-row"
                                onClick={() => removeSummaryRow(r.qr_id)}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {summaryTotalPages > 1 && (
                    <div className="aq-summary-pagination">
                      <button
                        type="button"
                        className="aq-btn-secondary"
                        onClick={() => setSummaryPage((p) => Math.max(1, p - 1))}
                        disabled={summaryPage <= 1}
                      >
                        Previous
                      </button>
                      <span className="aq-summary-pagination-status">
                        Page {summaryPage} of {summaryTotalPages}
                      </span>
                      <button
                        type="button"
                        className="aq-btn-secondary"
                        onClick={() => setSummaryPage((p) => Math.min(summaryTotalPages, p + 1))}
                        disabled={summaryPage >= summaryTotalPages}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="aq-modal-footer">
              <button
                type="button"
                className="aq-btn-reject"
                onClick={() => runSummaryAction('reject')}
                disabled={isProcessingSummary || summaryRows.length === 0}
              >
                Reject Selected ({summaryRows.length})
              </button>
              <button
                type="button"
                className="aq-btn-primary"
                onClick={() => runSummaryAction('approve')}
                disabled={isProcessingSummary || summaryRows.length === 0}
              >
                {isProcessingSummary ? 'Processing…' : `Confirm & Submit (${summaryRows.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}