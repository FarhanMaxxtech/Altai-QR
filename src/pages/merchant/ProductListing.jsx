// src/pages/merchant/ProductListing.jsx
import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { Search, ScanBarcode, Pencil } from 'lucide-react';
import { apiFetch } from '../../utils/api';
import { formatRelativeTime } from '../../utils/dateFormat';
import EditVariantModal from '../../components/EditVariantModal';
import '../../styles/ProductListing.css';
import { guardAction } from '../../utils/permissionGuard';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const storedUser = localStorage.getItem('authUser');
const currentUser = storedUser ? JSON.parse(storedUser) : null;
const isFullAccess = currentUser?.role === 'admin' || currentUser?.role === 'super_admin';
const canCreateProducts = isFullAccess || (currentUser?.permissions?.['Product InfoCenter'] || []).includes('create');
const canEditProducts = isFullAccess || (currentUser?.permissions?.['Product InfoCenter'] || []).includes('edit');

function attributesObjectToArray(attributesObject) {
  if (!attributesObject) return [];
  return Object.entries(attributesObject).map(([key, value]) => ({
    id: `${key}-${value}`,
    key,
    value,
  }));
}

function initialsOf(name) {
  if (!name) return '—';
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function quantityClass(qty) {
  if (!qty) return 'pl-qty-zero';
  if (qty < 5) return 'pl-qty-low';
  return 'pl-qty-healthy';
}

function flattenForExport(rows) {
  return rows.map(({ product, variant }) => ({
    'Product Name': product.product_name,
    SKU: variant.sku,
    Category: product.product_category || '',
    Description: product.product_description || '',
    Attributes: attributesObjectToArray(variant.attributes)
      .map((a) => `${a.key}: ${a.value}`)
      .join(', '),
    Quantity: variant.in_stock_count ?? 0,
    Updated: formatRelativeTime(variant.updated_at),
  }));
}

export default function ProductListing() {
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [editingRow, setEditingRow] = useState(null); // { product, variant } | null

  const loadProducts = () => {
    apiFetch('/api/products')
      .then((res) => res.json())
      .then((data) => setProducts(data))
      .catch((err) => console.error('Failed to load products:', err));
  };

  useEffect(() => {
    loadProducts();
  }, []);

  const categories = useMemo(() => {
    const set = new Set();
    products.forEach((p) => {
      if (p.product_category) set.add(p.product_category);
    });
    return ['All', ...Array.from(set).sort()];
  }, [products]);

  const rows = useMemo(() => {
    const flat = [];
    products.forEach((p) => {
      (p.variants || []).forEach((v) => flat.push({ product: p, variant: v }));
    });
    return flat;
  }, [products]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows
      .filter(({ product, variant }) => {
        const categoryMatch = activeCategory === 'All' || product.product_category === activeCategory;
        const searchMatch =
          !term ||
          product.product_name.toLowerCase().includes(term) ||
          variant.sku.toLowerCase().includes(term);
        return categoryMatch && searchMatch;
      })
      .sort(
        (a, b) =>
          new Date(b.variant.updated_at || b.variant.created_at) -
          new Date(a.variant.updated_at || a.variant.created_at)
      );
  }, [rows, activeCategory, search]);

  useEffect(() => setPage(1), [search, activeCategory]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const pagedRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);

  const handlePageChange = (next) => {
    if (next < 1 || next > totalPages) return;
    setPage(next);
  };

  // --- Export handlers -------------------------------------------------

  const handleCopy = async () => {
    const exportRows = flattenForExport(filteredRows);
    if (exportRows.length === 0) return;
    const header = Object.keys(exportRows[0]).join('\t');
    const body = exportRows.map((r) => Object.values(r).join('\t')).join('\n');
    try {
      await navigator.clipboard.writeText(`${header}\n${body}`);
      alert('Copied to clipboard.');
    } catch (err) {
      console.error('Copy failed:', err);
      alert('Could not copy — your browser may be blocking clipboard access.');
    }
  };

  const handleCsv = () => {
    const exportRows = flattenForExport(filteredRows);
    if (exportRows.length === 0) return;
    const header = Object.keys(exportRows[0]).join(',');
    const body = exportRows
      .map((r) => Object.values(r).map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\uFEFF' + header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'products.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExcel = () => {
    const exportRows = flattenForExport(filteredRows);
    if (exportRows.length === 0) return;
    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Products');
    XLSX.writeFile(workbook, 'products.xlsx');
  };

  const handlePrint = () => window.print();

  // --- Edit modal --------------------------------------------------------

    const handleVariantSaved = (updatedVariant) => {
    setProducts((prev) =>
      prev.map((p) => ({
        ...p,
        variants: p.variants.map((v) =>
          v.variant_id === updatedVariant.variant_id ? { ...v, ...updatedVariant } : v
        ),
      }))
    );
    setEditingRow(null);
  };

  // Soft-deleted variants (status flipped to 'inactive' server-side) drop
  // out of the listing immediately — the row underneath still exists.
  const handleVariantDeleted = (variantId) => {
    setProducts((prev) =>
      prev.map((p) => ({
        ...p,
        variants: p.variants.filter((v) => v.variant_id !== variantId),
      }))
    );
    setEditingRow(null);
  };

  return (
    <div className="pl-page">
      <div className="pl-toolbar-row">
        <div className="pl-search">
          <Search size={16} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search product or SKU"
          />
        </div>

        <div className="pl-category-pills">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`pl-pill ${activeCategory === cat ? 'pl-pill-active' : ''}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="pl-toolbar-spacer" />

        <div className="pl-export-buttons">
          <button type="button" onClick={handleCopy}>Copy</button>
          <button type="button" onClick={handleCsv}>CSV</button>
          <button type="button" onClick={handleExcel}>Excel</button>
          <button type="button" onClick={handlePrint}>Print</button>
        </div>

        {canCreateProducts && (
            <button type="button" className="pl-add-product-btn" onClick={() => navigate('/registry')}>
              + Add product
            </button>
          )}
      </div>

      <div className="pl-card">
        <div className="pl-table-wrapper">
          <table className="pl-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Description</th>
                <th>Variants</th>
                <th className="pl-col-qty">Quantity</th>
                <th className="pl-col-updated">Updated</th>
                <th className="pl-col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="pl-empty-cell">
                    {products.length === 0 ? 'No products registered yet.' : 'No products match your search.'}
                  </td>
                </tr>
              ) : (
                pagedRows.map(({ product, variant }) => {
                  const qty = variant.in_stock_count ?? 0;
                  const attrs = attributesObjectToArray(variant.attributes);
                  return (
                    <tr key={variant.variant_id}>
                      <td>
                        <div className="pl-product-cell">
                          <span className="pl-avatar">{initialsOf(product.product_name)}</span>
                          <div className="pl-product-meta">
                            <span className="pl-product-name">{product.product_name}</span>
                            <span className="pl-product-sub">
                              {variant.sku}
                              {product.product_category && <> · {product.product_category}</>}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="pl-desc-cell">{product.product_description || '—'}</td>
                      <td>
                        <div className="pl-attr-chips">
                          {attrs.length === 0 ? (
                            <span className="muted-dash">—</span>
                          ) : (
                            attrs.map((a) => (
                              <span key={a.id} className="pl-attr-chip">
                                {a.key}: {a.value}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="pl-col-qty">
                        <span className={`pl-qty-badge ${quantityClass(qty)}`}>{qty}</span>
                      </td>
                      <td className="pl-col-updated">{formatRelativeTime(variant.updated_at)}</td>
                      <td className="pl-col-actions">
                        <div className="pl-actions-cell">
                          {canEditProducts && (
                            <button
                              type="button"
                              className="pl-edit-btn"
                              onClick={() => setEditingRow({ product, variant })}
                            >
                              <Pencil size={13} /> Edit
                            </button>
                          )}
                          {canCreateProducts && (
                            <button
                              type="button"
                              className="pl-scan-btn"
                              onClick={() =>
                                navigate('/assign-qr', {
                                  state: { presetProductId: product.product_id, presetVariantId: variant.variant_id },
                                })
                              }
                              aria-label="Assign QR"
                            >
                              <ScanBarcode size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="pl-footer">
          <div className="pl-footer-left">
            <span>Show</span>
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <span>entries · Showing {pagedRows.length} of {filteredRows.length}</span>
          </div>

          {totalPages > 1 && (
            <div className="pl-pagination">
              <button disabled={page <= 1} onClick={() => handlePageChange(page - 1)}>‹</button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .slice(Math.max(0, page - 3), Math.max(0, page - 3) + 5)
                .map((n) => (
                  <button
                    key={n}
                    className={n === page ? 'pl-page-active' : ''}
                    onClick={() => handlePageChange(n)}
                  >
                    {n}
                  </button>
                ))}
              <button disabled={page >= totalPages} onClick={() => handlePageChange(page + 1)}>›</button>
            </div>
          )}
        </div>
      </div>

      {editingRow && (
        <EditVariantModal
          product={editingRow.product}
          variant={editingRow.variant}
          onClose={() => setEditingRow(null)}
          onSaved={handleVariantSaved}
          onDeleted={handleVariantDeleted}
        />
      )}
    </div>
  );
}