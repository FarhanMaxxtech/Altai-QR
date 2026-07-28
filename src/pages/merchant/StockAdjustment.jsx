// src/pages/StockAdjustment.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import { PackageSearch, ScanBarcode, X } from 'lucide-react';
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

// Client-side safety net on top of the backend's ORDER BY last_movement DESC
// — keeps the table correctly ordered by the full timestamp even after
// client-side product/variant filtering, and treats rows with no movement
// yet (null last_movement) as the oldest, not the newest.
function sortByLastMovementDesc(rows) {
  return [...rows].sort((a, b) => {
    const aTime = a.last_movement ? new Date(a.last_movement).getTime() : -Infinity;
    const bTime = b.last_movement ? new Date(b.last_movement).getTime() : -Infinity;
    return bTime - aTime;
  });
}

export default function StockAdjustment() {
  const navigate = useNavigate();
  const [stores, setStores] = useState([]);
  const [products, setProducts] = useState([]);

  const [productFilter, setProductFilter] = useState('');
  const [variantFilter, setVariantFilter] = useState('');
  const [storeFilter, setStoreFilter] = useState('');

  const [rows, setRows] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  // --- Scan-to-search state ------------------------------------------------
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

  const variantOptions = useMemo(() => {
    if (!productFilter) return [];
    const product = products.find((p) => p.product_id === productFilter);
    return product ? product.variants : [];
  }, [products, productFilter]);

  const handleProductChange = (e) => {
    setProductFilter(e.target.value);
    setVariantFilter('');
  };

  // Runs the actual search against explicit filter values, so callers
  // (scan handler) can pass fresh values without waiting on setState.
  const performSearch = ({ product_id, variant_id, store_id }) => {
    setIsLoading(true);
    setErrorMessage('');

    const params = new URLSearchParams();
    if (store_id) params.set('store_id', store_id);

    apiFetch(`/api/stock-balance?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        let filtered = data;

        if (variant_id) {
          filtered = filtered.filter((r) => r.variant_id === variant_id);
        } else if (product_id) {
          const productVariants = products.find((p) => p.product_id === product_id);
          const variantIds = new Set((productVariants?.variants || []).map((v) => v.variant_id));
          filtered = filtered.filter((r) => variantIds.has(r.variant_id));
        }

        setRows(sortByLastMovementDesc(filtered));
        setHasSearched(true);
        setPage(1);
      })
      .catch((err) => {
        setErrorMessage('Could not reach server. Check it is running.');
        console.error(err);
      })
      .finally(() => setIsLoading(false));
  };

  const runSearch = (e) => {
    e.preventDefault();
    performSearch({
      product_id: productFilter,
      variant_id: variantFilter,
      store_id: storeFilter,
    });
  };

  // --- Scan handling ---------------------------------------------------------

  const handleScanResult = async (value) => {
    setScanError('');

    try {
      const res = await apiFetch(`/api/transactions/scan-lookup?serial_number=${encodeURIComponent(value)}`);
      const result = await res.json();

      if (!res.ok) {
        setScanError(result.message || 'Could not recognize this code.');
        return;
      }

      // Auto-select product, variant, and (if the unit is currently in a
      // store) that store, then immediately run the search with those
      // values — no need to wait for a second click.
      setProductFilter(result.product_id);
      setVariantFilter(result.variant_id);
      setStoreFilter(result.current_store_id || '');

      performSearch({
        product_id: result.product_id,
        variant_id: result.variant_id,
        store_id: result.current_store_id || '',
      });
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
        const html5Qr = new Html5Qrcode('stock-adjustment-qr-reader');
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

  const exportRows = useMemo(
    () =>
      rows.map((r) => ({
        Store: r.store_name,
        'SKU ID': r.sku,
        'Product Name': r.product_name,
        Variation: formatVariation(r.attributes),
        'Price (RM)': r.price ? Number(r.price).toFixed(2) : '',
        Balance: r.qty,
        Date: formatDateTime(r.last_movement),
      })),
    [rows]
  );

  const handleExportExcel = () => exportRowsToExcel(exportRows, 'product-balance.xlsx', 'Product Balance');
  const handleExportCsv = () => exportRowsToCsv(exportRows, 'product-balance.csv');
  const handleExportPdf = () => exportRowsToPdf(exportRows, 'product-balance.pdf', 'Product Balance');

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize);

  const handlePageChange = (next) => {
    if (next < 1 || next > totalPages) return;
    setPage(next);
  };

  return (
    <div className="stock-adjustment">
      <section className="balance-card">


        {/* --- Scan-to-search row ------------------------------------------- */}
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
                  autoFocus
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
              <div id="stock-adjustment-qr-reader" className="qr-reader-box" />
              <button type="button" className="btn-secondary" onClick={toggleCamera}>
                Stop Camera
              </button>
            </div>
          )}
        </div>
        {scanError && <p className="error-text">{scanError}</p>}

        <div className="or-divider-row">
          <span className="or-divider">or filter manually</span>
        </div>

        <form className="balance-filter-grid" onSubmit={runSearch}>
          <div className="form-group">
            <label>Product</label>
            <select value={productFilter} onChange={handleProductChange}>
              <option value="">-- All Products --</option>
              {products.map((p) => (
                <option key={p.product_id} value={p.product_id}>{p.product_name}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>SKU / Variant</label>
            <select
              value={variantFilter}
              onChange={(e) => setVariantFilter(e.target.value)}
              disabled={!productFilter}
            >
              <option value="">-- All Variants --</option>
              {variantOptions.map((v) => (
                <option key={v.variant_id} value={v.variant_id}>
                  {v.sku} ({formatVariation(v.attributes)})
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Store</label>
            <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}>
              <option value="">-- All Stores --</option>
              {stores.map((s) => (
                <option key={s.store_id} value={s.store_id}>{s.location}</option>
              ))}
            </select>
          </div>

          <div className="balance-filter-actions">
            <button type="submit" className="btn-primary" disabled={isLoading}>
              {isLoading ? 'Searching…' : 'Search'}
            </button>
          </div>
        </form>

        {errorMessage && <p className="error-text">{errorMessage}</p>}
      </section>

      <section className="balance-card">
        <div className="balance-results-header">
          <h2>Results {hasSearched ? `(${rows.length})` : ''}</h2>
        </div>

        {!hasSearched ? (
          <p className="empty-state">Scan a code or choose your filters and click Search to view balances.</p>
        ) : rows.length === 0 ? (
          <p className="empty-state">No stock found for this query.</p>
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

            <table className="balance-table" style={{ maxWidth: 'none' }}>
              <thead>
                <tr>
                  <th>Store</th>
                  <th>SKU ID</th>
                  <th>Product Name</th>
                  <th>Variation</th>
                  <th>Price (RM)</th>
                  <th>Balance</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((r) => (
                  <tr key={`${r.variant_id}-${r.store_id}`}>
                    <td data-label="Store">
                      <button
                        type="button"
                        className="product-link"
                        onClick={() =>
                          navigate(`/stock-balance/${r.variant_id}/${r.store_id}`, {
                            state: {
                              product_name: r.product_name,
                              sku: r.sku,
                              store_name: r.store_name,
                              price: r.price,
                              attributes: r.attributes,
                              qty: r.qty,
                            },
                          })
                        }
                      >
                        {r.store_name}
                      </button>
                    </td>
                    <td data-label="SKU ID">{r.sku}</td>
                    <td data-label="Product Name">{r.product_name}</td>
                    <td data-label="Variation">{formatVariation(r.attributes)}</td>
                    <td data-label="Price (RM)">{r.price ? Number(r.price).toFixed(2) : '—'}</td>
                    <td data-label="Balance"><span className="balance-badge">{r.qty}</span></td>
                    <td data-label="Date">{formatDateTime(r.last_movement)}</td>
                  </tr>
                ))}
              </tbody>
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