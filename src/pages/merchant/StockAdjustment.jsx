// src/pages/merchant/StockAdjustment.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import { ScanBarcode, X, ChevronDown, ChevronRight, RotateCcw, Download } from 'lucide-react';
import { apiFetch } from '../../utils/api';
import { exportRowsToCsv } from '../../utils/tableExport';
import '../../styles/StockAdjustment.css';

function attrsToArray(attributes) {
  if (!attributes) return [];
  return Object.entries(attributes).map(([key, value]) => ({ key, value }));
}

// "sizes" if every variant only varies by one attribute like "Size",
// otherwise falls back to the generic "variants".
function variantGroupLabel(variants) {
  const keys = new Set();
  variants.forEach((v) => Object.keys(v.attributes || {}).forEach((k) => keys.add(k)));
  if (keys.size === 1) {
    const key = [...keys][0].toLowerCase();
    return key.endsWith('s') ? key : `${key}s`;
  }
  return 'variants';
}

function variantLabel(variant, sharedKey) {
  const attrs = attrsToArray(variant.attributes);
  if (attrs.length === 0) return variant.sku;
  if (sharedKey && attrs.length === 1) return attrs[0].value;
  return attrs.map((a) => `${a.key}: ${a.value}`).join(', ');
}

// Per-store cell coloring: needs a per-store threshold (reorder / #stores).
function cellHealth(qty, threshold) {
  if (qty === 0) return 'zero';
  if (threshold == null) return 'healthy';
  if (qty <= threshold * 0.5) return 'critical';
  if (qty < threshold) return 'low';
  return 'healthy';
}

// Row-level health: compares the product's full total against its own reorder point.
function rowHealth(total, reorder) {
  if (reorder == null) return 'healthy';
  if (total <= reorder * 0.5) return 'critical';
  if (total < reorder) return 'low';
  return 'healthy';
}

export default function StockAdjustment() {
  const navigate = useNavigate();
  const [stores, setStores] = useState([]);
  const [products, setProducts] = useState([]);

  // --- Filters -----------------------------------------------------------
  const [categoryFilter, setCategoryFilter] = useState('');
  const [skuFilter, setSkuFilter] = useState('');
  const [storeFilter, setStoreFilter] = useState('');
  const [stockState, setStockState] = useState('all'); // all | low | critical

  // --- Expand state --------------------------------------------------------
  const [expandedRows, setExpandedRows] = useState({});
  const [allExpanded, setAllExpanded] = useState(false);

  // --- Scan-to-search --------------------------------------------------------
  const [scanInput, setScanInput] = useState('');
  const [scanError, setScanError] = useState('');
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const html5QrRef = useRef(null);
  const lastScannedRef = useRef('');
  const scanInputRef = useRef(null);

  useEffect(() => {
    apiFetch('/api/stores')
      .then((res) => res.json())
      .then((data) => setStores(data))
      .catch((err) => console.error('Failed to load stores:', err));

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

  // --- One row per product, with per-store quantities summed across variants
  const rows = useMemo(() => {
    return products.map((product) => {
      const variants = product.variants || [];
      const storeQtys = {};
      stores.forEach((s) => { storeQtys[s.store_id] = 0; });
      variants.forEach((v) => {
        Object.entries(v.balances || {}).forEach(([storeId, qty]) => {
          storeQtys[storeId] = (storeQtys[storeId] || 0) + Number(qty);
        });
      });
      const totalAll = Object.values(storeQtys).reduce((a, c) => a + c, 0);

      const keys = new Set();
      variants.forEach((v) => Object.keys(v.attributes || {}).forEach((k) => keys.add(k)));
      const sharedKey = keys.size === 1 ? [...keys][0] : null;

      return {
        product,
        variants,
        storeQtys,
        totalAll,
        groupLabel: variantGroupLabel(variants),
        sharedKey,
        primarySku: variants[0]?.sku || '—',
      };
    });
  }, [products, stores]);

  const categories = useMemo(() => {
    const set = new Set();
    products.forEach((p) => { if (p.product_category) set.add(p.product_category); });
    return Array.from(set).sort();
  }, [products]);

  const skuOptions = useMemo(
    () => rows.map((r) => ({ value: r.product.product_id, label: r.primarySku })),
    [rows]
  );

  const visibleStoreIds = storeFilter ? [storeFilter] : stores.map((s) => s.store_id);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (categoryFilter && r.product.product_category !== categoryFilter) return false;
      if (skuFilter && r.product.product_id !== skuFilter) return false;

      const visibleTotal = visibleStoreIds.reduce((a, id) => a + (r.storeQtys[id] || 0), 0);
      const reorder = r.product.reorder_point;

      if (stockState === 'low') return reorder != null && visibleTotal < reorder;
      if (stockState === 'critical') return reorder != null && visibleTotal <= reorder * 0.5;
      return true;
    });
  }, [rows, categoryFilter, skuFilter, stockState, visibleStoreIds]);

  // --- Stats ---------------------------------------------------------------
  const stats = useMemo(() => {
    let unitsOnHand = 0;
    let belowReorder = 0;

    filteredRows.forEach((r) => {
      const visibleTotal = visibleStoreIds.reduce((a, id) => a + (r.storeQtys[id] || 0), 0);
      unitsOnHand += visibleTotal;
      if (r.product.reorder_point != null && visibleTotal < r.product.reorder_point) {
        belowReorder += 1;
      }
    });

    const storeTotals = stores.map((s) =>
      filteredRows.reduce((a, r) => a + (r.storeQtys[s.store_id] || 0), 0)
    );
    const storesWithZero = storeTotals.filter((t) => t === 0).length;

    return {
      matched: filteredRows.length,
      total: rows.length,
      unitsOnHand,
      belowReorder,
      storesWithZero,
      storeTotals,
      grandTotal: storeTotals.reduce((a, c) => a + c, 0),
    };
  }, [filteredRows, rows.length, stores, visibleStoreIds]);

  // --- Handlers --------------------------------------------------------------

  const resetFilters = () => {
    setCategoryFilter('');
    setSkuFilter('');
    setStoreFilter('');
    setStockState('all');
  };

  const toggleRow = (productId) => {
    setExpandedRows((prev) => ({ ...prev, [productId]: !prev[productId] }));
  };

  const toggleAllRows = () => {
    if (allExpanded) {
      setExpandedRows({});
      setAllExpanded(false);
    } else {
      const next = {};
      filteredRows.forEach((r) => { next[r.product.product_id] = true; });
      setExpandedRows(next);
      setAllExpanded(true);
    }
  };

  const handleExportCsv = () => {
    const exportRows = [];
    filteredRows.forEach((r) => {
      const row = { Product: r.product.product_name, SKU: r.primarySku };
      stores.forEach((s) => { row[s.location] = r.storeQtys[s.store_id] || 0; });
      row.Total = r.totalAll;
      row['Reorder At'] = r.product.reorder_point ?? '';
      exportRows.push(row);
    });
    exportRowsToCsv(exportRows, 'inventory-balance.csv');
  };

  // --- Scan-to-search --------------------------------------------------------

  const handleScanResult = async (value) => {
    setScanError('');
    try {
      const res = await apiFetch(`/api/transactions/scan-lookup?serial_number=${encodeURIComponent(value)}`);
      const result = await res.json();

      if (!res.ok) {
        setScanError(result.message || 'Could not recognize this code.');
        return;
      }

      setCategoryFilter('');
      setSkuFilter(result.product_id);
      setStoreFilter(result.current_store_id || '');
      setStockState('all');
    } catch (err) {
      setScanError('Could not reach server. Check it is running.');
      console.error(err);
    }
  };

  const handleScanInputSubmit = (e) => {
    e.preventDefault();
    if (!scanInput.trim()) return;
    handleScanResult(scanInput.trim());
    setScanInput('');
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
        const html5Qr = new Html5Qrcode('ib-qr-reader');
        html5QrRef.current = html5Qr;

        await html5Qr.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (decodedText) => {
            const trimmed = decodedText.trim();
            if (trimmed === lastScannedRef.current) return;
            lastScannedRef.current = trimmed;
            handleScanResult(trimmed);
          },
          () => {}
        );
      } catch (err) {
        setScanError('Could not access camera. Check permissions and try again.');
        setIsCameraOpen(false);
      }
    }, 0);
  };

  const clearScan = () => {
    setScanInput('');
    setScanError('');
  };

  return (
    <div className="ib-page">
      {/* --- Scan-to-search ---------------------------------------------- */}
      {/*<section className="balance-card">
        <div className="scan-search-row">
          {!isCameraOpen ? (
            <>
              <form className="scan-search-input-form" onSubmit={handleScanInputSubmit}>
                <ScanBarcode size={18} className="scan-search-input-icon" />
                <input
                  ref={scanInputRef}
                  type="text"
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  placeholder="Point scanner here or type serial number / QR value to auto-search..."
                />
                {scanInput && (
                  <button type="button" className="sm-input-clear" onClick={clearScan} aria-label="Clear input">
                    <X size={14} />
                  </button>
                )}
              </form>
              <button type="button" className="btn-secondary" onClick={toggleCamera}>
                Use Camera
              </button>
            </>
          ) : (
            <div className="scan-search-camera-active">
              <div id="ib-qr-reader" className="qr-reader-box" />
              <button type="button" className="btn-secondary" onClick={toggleCamera}>
                Stop Camera
              </button>
            </div>
          )}
        </div>
        {scanError && <p className="error-text">{scanError}</p>}
      </section>*/}

      {/* --- Filter row ------------------------------------------------------ */}
      <section className="ib-filter-card">
        <div className="ib-field">
          <label>Category</label>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="ib-field">
          <label>SKU</label>
          <select value={skuFilter} onChange={(e) => setSkuFilter(e.target.value)}>
            <option value="">All SKUs</option>
            {skuOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="ib-field">
          <label>Store</label>
          <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}>
            <option value="">All stores</option>
            {stores.map((s) => (
              <option key={s.store_id} value={s.store_id}>{s.location}</option>
            ))}
          </select>
        </div>

        <div className="ib-field">
          <label>Stock State</label>
          <div className="ib-segmented">
            {[['all', 'All'], ['low', 'Low'], ['critical', 'Critical']].map(([val, label]) => (
              <button
                key={val}
                type="button"
                className={`ib-segmented-btn ${stockState === val ? 'ib-segmented-btn-active' : ''}`}
                onClick={() => setStockState(val)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <button type="button" className="ib-reset-btn" onClick={resetFilters}>
          <RotateCcw size={14} />
          Reset
        </button>
      </section>

      {/* --- Stats row --------------------------------------------------------- */}
      <section className="ib-stats-grid">
        <div className="ib-stat-card">
          <span className="ib-stat-label">SKUs Matched</span>
          <div className="ib-stat-row">
            <span className="ib-stat-value">{stats.matched}</span>
            <span className="ib-stat-unit">of {stats.total}</span>
          </div>
        </div>
        <div className="ib-stat-card">
          <span className="ib-stat-label">Units on Hand</span>
          <div className="ib-stat-row">
            <span className="ib-stat-value">{stats.unitsOnHand}</span>
            <span className="ib-stat-unit">units</span>
          </div>
        </div>
        <div className="ib-stat-card">
          <span className="ib-stat-label">Below Reorder</span>
          <div className="ib-stat-row">
            <span className={`ib-stat-value ${stats.belowReorder > 0 ? 'ib-stat-value-warning' : ''}`}>
              {stats.belowReorder}
            </span>
            <span className="ib-stat-unit">SKUs</span>
          </div>
        </div>
        <div className="ib-stat-card">
          <span className="ib-stat-label">Stores with Zero</span>
          <div className="ib-stat-row">
            <span className="ib-stat-value">{stats.storesWithZero}</span>
            <span className="ib-stat-unit">locations</span>
          </div>
        </div>
      </section>

      {/* --- Table --------------------------------------------------------------- */}
      <section className="ib-table-card">
        <div className="ib-table-header">
          <h2>Balance by store</h2>
          <span className="ib-badge-count">{filteredRows.length} SKUs</span>
          <button type="button" className="ib-expand-btn" onClick={toggleAllRows}>
            {allExpanded ? 'Collapse sizes' : 'Expand sizes'}
          </button>
          <div className="ib-spacer" />
          <div className="ib-legend">
            <span className="ib-legend-item"><span className="ib-legend-dot ib-legend-dot-healthy" />healthy</span>
            <span className="ib-legend-item"><span className="ib-legend-dot ib-legend-dot-low" />low</span>
            <span className="ib-legend-item"><span className="ib-legend-dot ib-legend-dot-critical" />critical</span>
          </div>
          <button type="button" className="ib-export-btn" onClick={handleExportCsv} disabled={filteredRows.length === 0}>
            <Download size={14} />
            Export CSV
          </button>
        </div>

        {stores.length === 0 ? (
          <p className="empty-state">No stores configured yet.</p>
        ) : filteredRows.length === 0 ? (
          <p className="empty-state">No products match your filters.</p>
        ) : (
          <div className="ib-table-wrapper">
            <table className="ib-table">
              <thead>
                <tr>
                  <th className="ib-col-product">Product</th>
                  <th>SKU</th>
                  {stores.map((s) => (
                    <th key={s.store_id} className="ib-col-store">{s.location}</th>
                  ))}
                  <th className="ib-col-total">Total</th>
                  <th className="ib-col-reorder">Reorder At</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => {
                  const productId = r.product.product_id;
                  const isOpen = !!expandedRows[productId];
                  const reorder = r.product.reorder_point;
                  const health = rowHealth(r.totalAll, reorder);
                  const perStoreThreshold = reorder != null && stores.length > 0 ? reorder / stores.length : null;
                  const barPct = reorder ? Math.min(100, (r.totalAll / (reorder * 3)) * 100) : 0;

                  return (
                    <React.Fragment key={productId}>
                      <tr className="ib-row-product" onClick={() => toggleRow(productId)}>
                        <td className="ib-col-product">
                          <span className="ib-caret">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                          <span className={`ib-dot ib-dot-${health}`} />
                          <span className="ib-product-name">{r.product.product_name}</span>
                          <span className="ib-variant-count">{r.variants.length} {r.groupLabel}</span>
                        </td>
                        <td className="ib-sku-cell">{r.primarySku}</td>
                        {stores.map((s) => {
                          const qty = r.storeQtys[s.store_id] || 0;
                          const health2 = cellHealth(qty, perStoreThreshold);
                          const dimmed = storeFilter && storeFilter !== s.store_id;
                          return (
                            <td key={s.store_id} className="ib-col-store">
                              <span className={`ib-cell ib-cell-${health2} ${dimmed ? 'ib-cell-dimmed' : ''}`}>
                                {qty}
                              </span>
                            </td>
                          );
                        })}
                        <td className="ib-col-total ib-total-value">{r.totalAll}</td>
                        <td className="ib-col-reorder">
                          {reorder != null ? (
                            <div className="ib-reorder-cell">
                              <span className={`ib-reorder-bar ib-reorder-bar-${health}`}>
                                <span className="ib-reorder-bar-fill" style={{ width: `${barPct}%` }} />
                              </span>
                              <span className="ib-reorder-value">{reorder}</span>
                            </div>
                          ) : (
                            <span className="muted-dash">—</span>
                          )}
                        </td>
                      </tr>

                      {isOpen && r.variants.map((v) => {
                        const vTotal = stores.reduce((a, s) => a + (v.balances?.[s.store_id] || 0), 0);
                        return (
                          <tr key={v.variant_id} className="ib-row-variant">
                            <td className="ib-col-product ib-subrow-label">
                              <span className="ib-subrow-tick" />
                              {variantLabel(v, r.sharedKey)}
                            </td>
                            <td className="ib-sku-cell ib-subrow-sku">{v.sku}</td>
                            {stores.map((s) => {
                              const qty = v.balances?.[s.store_id] || 0;
                              const dimmed = storeFilter && storeFilter !== s.store_id;
                              return (
                                <td
                                  key={s.store_id}
                                  className={`ib-col-store ib-subcell ${qty === 0 ? 'ib-subcell-zero' : ''} ${dimmed ? 'ib-cell-dimmed' : ''}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (qty === 0) return;
                                    navigate(`/stock-balance/${v.variant_id}/${s.store_id}`, {
                                      state: {
                                        product_name: r.product.product_name,
                                        sku: v.sku,
                                        store_name: s.location,
                                        price: v.price,
                                        attributes: v.attributes,
                                        qty,
                                      },
                                    });
                                  }}
                                >
                                  {qty}
                                </td>
                              );
                            })}
                            <td className="ib-col-total ib-subrow-total">{vTotal}</td>
                            <td className="ib-col-reorder"></td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="ib-col-product ib-footer-label">Total on hand</td>
                  <td></td>
                  {stores.map((s, i) => (
                    <td key={s.store_id} className="ib-col-store ib-footer-value">{stats.storeTotals[i]}</td>
                  ))}
                  <td className="ib-col-total ib-footer-total">{stats.grandTotal}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}