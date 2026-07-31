// src/components/ScanLookupModal.jsx
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import { QrCode, Camera, X } from 'lucide-react';
import { apiFetch } from '../utils/api';
import { formatRelativeTime } from '../utils/dateFormat';
import '../styles/ScanLookupModal.css';

const RECENTS_KEY = 'scan-lookup-recents';
const MAX_RECENTS = 4;

function initialsOf(name) {
  if (!name) return '—';
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function loadRecentIds() {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecentIds(ids) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

// Sums balances across every variant of a product, per store, plus the
// derived totals/attributes/last-updated shown in the detail view.
function aggregateProduct(product, stores) {
  const variants = product.variants || [];
  const storeQtys = {};
  stores.forEach((s) => { storeQtys[s.store_id] = 0; });
  variants.forEach((v) => {
    Object.entries(v.balances || {}).forEach(([storeId, qty]) => {
      storeQtys[storeId] = (storeQtys[storeId] || 0) + Number(qty);
    });
  });
  const total = Object.values(storeQtys).reduce((a, c) => a + c, 0);

  const attributeValues = [];
  const seen = new Set();
  variants.forEach((v) => {
    Object.values(v.attributes || {}).forEach((val) => {
      if (val && !seen.has(val)) { seen.add(val); attributeValues.push(val); }
    });
  });

  const lastUpdated = variants.reduce((latest, v) => {
    const t = v.updated_at || v.created_at;
    if (!t) return latest;
    return !latest || new Date(t) > new Date(latest) ? t : latest;
  }, null);

  return {
    storeQtys,
    total,
    attributeValues,
    lastUpdated,
    primarySku: variants[0]?.sku || '—',
  };
}

function healthOf(total, reorder) {
  if (reorder == null) return { label: 'Healthy', className: 'sl-badge-healthy' };
  if (total <= reorder * 0.5) return { label: 'Critical', className: 'sl-badge-critical' };
  if (total < reorder) return { label: 'Low', className: 'sl-badge-low' };
  return { label: 'Healthy', className: 'sl-badge-healthy' };
}

// Matches typed text against SKU / product name — exact SKU first, then
// exact product name, then a loose partial match on either.
function findProductMatch(products, term) {
  const q = term.trim().toLowerCase();
  if (!q) return null;

  const exactSku = products.find((p) => (p.variants || []).some((v) => v.sku?.toLowerCase() === q));
  if (exactSku) return exactSku;

  const exactName = products.find((p) => p.product_name?.toLowerCase() === q);
  if (exactName) return exactName;

  return (
    products.find(
      (p) =>
        p.product_name?.toLowerCase().includes(q) ||
        (p.variants || []).some((v) => v.sku?.toLowerCase().includes(q))
    ) || null
  );
}

export default function ScanLookupModal({ isOpen, onClose }) {
  const navigate = useNavigate();

  const [products, setProducts] = useState([]);
  const [stores, setStores] = useState([]);
  const [dataLoaded, setDataLoaded] = useState(false);

  const [query, setQuery] = useState('');
  const [hit, setHit] = useState(null); // { product, stats }
  const [notFound, setNotFound] = useState(false);

  const [recentIds, setRecentIds] = useState(() => loadRecentIds());

  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const html5QrRef = useRef(null);
  const lastScannedRef = useRef('');
  const inputRef = useRef(null);

  // Lazy-load products + stores the first time the modal is opened.
  useEffect(() => {
    if (!isOpen || dataLoaded) return;
    Promise.all([
      apiFetch('/api/products').then((res) => res.json()),
      apiFetch('/api/stores').then((res) => res.json()),
    ])
      .then(([productsData, storesData]) => {
        setProducts(productsData);
        setStores(storesData);
        setDataLoaded(true);
      })
      .catch((err) => console.error('Failed to load scan lookup data:', err));
  }, [isOpen, dataLoaded]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
      setHit(null);
      setNotFound(false);
      if (html5QrRef.current) html5QrRef.current.stop().catch(() => {});
      setIsCameraOpen(false);
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (html5QrRef.current) html5QrRef.current.stop().catch(() => {});
    };
  }, []);

  const showHit = (product) => {
    const stats = aggregateProduct(product, stores);
    setHit({ product, stats });
    setNotFound(false);
    setQuery(stats.primarySku);

    setRecentIds((prev) => {
      const next = [product.product_id, ...prev.filter((id) => id !== product.product_id)].slice(0, MAX_RECENTS);
      saveRecentIds(next);
      return next;
    });
  };

  // Tries a local product/SKU match first (instant), then falls back to
  // the serial-number/QR-value backend lookup for physical labels.
  const runLookup = async (rawValue) => {
    const value = rawValue.trim();
    if (!value) return;

    setNotFound(false);

    const productMatch = findProductMatch(products, value);
    if (productMatch) {
      showHit(productMatch);
      return;
    }

    try {
      const res = await apiFetch(`/api/transactions/scan-lookup?serial_number=${encodeURIComponent(value)}`);
      if (res.ok) {
        const result = await res.json();
        const product = products.find((p) => p.product_id === result.product_id);
        if (product) {
          showHit(product);
          return;
        }
      }
    } catch (err) {
      console.error('Scan lookup failed:', err);
    }

    setHit(null);
    setNotFound(true);
  };

  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runLookup(query);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const handleClear = () => {
    setQuery('');
    setHit(null);
    setNotFound(false);
    inputRef.current?.focus();
  };

  const toggleCamera = async () => {
    if (isCameraOpen) {
      if (html5QrRef.current) {
        await html5QrRef.current.stop().then(() => html5QrRef.current.clear()).catch(() => {});
      }
      setIsCameraOpen(false);
      return;
    }

    lastScannedRef.current = '';
    setIsCameraOpen(true);

    setTimeout(async () => {
      try {
        const html5Qr = new Html5Qrcode('scan-lookup-camera-reader');
        html5QrRef.current = html5Qr;
        await html5Qr.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (decodedText) => {
            const trimmed = decodedText.trim();
            if (trimmed === lastScannedRef.current) return;
            lastScannedRef.current = trimmed;
            setQuery(trimmed);
            runLookup(trimmed);
          },
          () => {}
        );
      } catch (err) {
        console.error('Could not access camera:', err);
        setIsCameraOpen(false);
      }
    }, 0);
  };

  const recentProducts = recentIds.map((id) => products.find((p) => p.product_id === id)).filter(Boolean);

  const handleOpenBalance = () => {
    if (!hit) return;
    navigate('/stock-balance', { state: { presetProductId: hit.product.product_id } });
    onClose();
  };

  const handleAdjustStock = () => {
    navigate('/stock');
    onClose();
  };

  if (!isOpen) return null;

  const health = hit ? healthOf(hit.stats.total, hit.product.reorder_point) : null;

  return (
    <div className="sl-overlay" onClick={onClose}>
      <div className="sl-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sl-header">
          <div className="sl-header-top">
            <span className="sl-header-title">Scan lookup</span>
            <div className="sl-header-actions">
              <span className="sl-esc-hint">ESC to close</span>
              <button type="button" className="sl-close-btn" onClick={onClose} aria-label="Close">
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="sl-search-row">
            <QrCode size={18} className="sl-search-icon" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="Scan a QR label, or type a SKU / product name"
            />
            {query && (
              <button type="button" className="sl-clear-btn" onClick={handleClear}>
                Clear
              </button>
            )}
            <button
              type="button"
              className={`sl-camera-btn ${isCameraOpen ? 'sl-camera-btn-active' : ''}`}
              onClick={toggleCamera}
              aria-label="Scan with camera"
            >
              <Camera size={18} />
            </button>
          </div>

          {isCameraOpen && (
            <div className="sl-camera-block">
              <div id="scan-lookup-camera-reader" className="sl-camera-reader-box" />
            </div>
          )}
        </div>

        <div className="sl-body">
          {!dataLoaded ? (
            <p className="sl-empty-text">Loading…</p>
          ) : hit ? (
            <div className="sl-hit">
              <div className="sl-hit-top">
                <span className="sl-hit-avatar">{initialsOf(hit.product.product_name)}</span>
                <div className="sl-hit-meta">
                  <div className="sl-hit-name-row">
                    <span className="sl-hit-name">{hit.product.product_name}</span>
                    <span className={`sl-badge ${health.className}`}>{health.label}</span>
                  </div>
                  <span className="sl-hit-sub">
                    {hit.stats.primarySku}
                    {hit.product.product_category ? ` · ${hit.product.product_category}` : ''}
                  </span>
                  {hit.product.product_description && (
                    <span className="sl-hit-desc">{hit.product.product_description}</span>
                  )}
                  {hit.stats.attributeValues.length > 0 && (
                    <div className="sl-hit-attrs">
                      {hit.stats.attributeValues.map((val) => (
                        <span key={val} className="sl-attr-chip">{val}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="sl-hit-onhand">
                  <span className="sl-onhand-label">ON HAND</span>
                  <span className="sl-onhand-value">{hit.stats.total}</span>
                  <span className="sl-onhand-reorder">reorder at {hit.product.reorder_point ?? '—'}</span>
                </div>
              </div>

              <div className="sl-section">
                <span className="sl-section-label">QUANTITY BY STORE</span>
                <div className="sl-store-list">
                  {stores.map((s) => {
                    const qty = hit.stats.storeQtys[s.store_id] || 0;
                    const maxQty = Math.max(1, ...Object.values(hit.stats.storeQtys));
                    const widthPct = qty ? Math.max((qty / maxQty) * 100, 3) : 0;
                    return (
                      <div key={s.store_id} className="sl-store-row">
                        <span className="sl-store-name">{s.location}</span>
                        <span className="sl-store-bar">
                          <span
                            className="sl-store-bar-fill"
                            style={{ width: `${widthPct}%`, background: qty ? '#2e7d14' : '#e0e6da' }}
                          />
                        </span>
                        <span className="sl-store-qty">{qty}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="sl-section sl-updated-row">
                <span className="sl-section-label">LAST UPDATED</span>
                <span className="sl-updated-value">{formatRelativeTime(hit.stats.lastUpdated)}</span>
              </div>

              <div className="sl-actions">
                <button type="button" className="sl-btn-secondary" onClick={handleOpenBalance}>
                  Open in Balance
                </button>
                <button type="button" className="sl-btn-primary" onClick={handleAdjustStock}>
                  Adjust stock
                </button>
              </div>
            </div>
          ) : notFound ? (
            <div className="sl-no-match">
              <span className="sl-no-match-title">No product found for that code</span>
              <span className="sl-no-match-sub">Check the label, or try the SKU / product name instead.</span>
            </div>
          ) : (
            <>
              <span className="sl-section-label sl-recents-label">RECENT LOOKUPS</span>
              {recentProducts.length === 0 ? (
                <p className="sl-empty-text">No recent lookups yet — scan a label or search above.</p>
              ) : (
                <div className="sl-recent-list">
                  {recentProducts.map((p) => {
                    const stats = aggregateProduct(p, stores);
                    return (
                      <button key={p.product_id} type="button" className="sl-recent-row" onClick={() => showHit(p)}>
                        <span className="sl-recent-avatar">{initialsOf(p.product_name)}</span>
                        <span className="sl-recent-meta">
                          <span className="sl-recent-name">{p.product_name}</span>
                          <span className="sl-recent-sku">{stats.primarySku}</span>
                        </span>
                        <span className="sl-recent-qty">{stats.total}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}