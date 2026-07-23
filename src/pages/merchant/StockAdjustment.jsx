// src/pages/StockAdjustment.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { PackageSearch } from 'lucide-react';
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

  const variantOptions = useMemo(() => {
    if (!productFilter) return [];
    const product = products.find((p) => p.product_id === productFilter);
    return product ? product.variants : [];
  }, [products, productFilter]);

  const handleProductChange = (e) => {
    setProductFilter(e.target.value);
    setVariantFilter('');
  };

  const runSearch = (e) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage('');

    const params = new URLSearchParams();
    if (storeFilter) params.set('store_id', storeFilter);

    apiFetch(`/api/stock-balance?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        let filtered = data;

        if (variantFilter) {
          filtered = filtered.filter((r) => r.variant_id === variantFilter);
        } else if (productFilter) {
          const variantIds = new Set(variantOptions.map((v) => v.variant_id));
          filtered = filtered.filter((r) => variantIds.has(r.variant_id));
        }

        // Default sort: most recently moved stock first, by full timestamp.
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
        <div className="balance-card-header">
          <PackageSearch size={18} />
          <h2>Inventory Balance</h2>
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
          <p className="empty-state">Choose your filters and click Search to view balances.</p>
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