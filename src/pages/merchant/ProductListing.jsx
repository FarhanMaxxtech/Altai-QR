// src/pages/merchant/ProductListing.jsx
import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { apiFetch } from '../../utils/api';
import '../../styles/ProductListing.css';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

function attributesObjectToArray(attributesObject) {
  if (!attributesObject) return [];
  return Object.entries(attributesObject).map(([key, value]) => ({
    id: crypto.randomUUID(),
    key,
    value,
  }));
}

function flattenForExport(products) {
  const rows = [];
  products.forEach((p) => {
    p.variants.forEach((v) => {
      const attrs = attributesObjectToArray(v.attributes)
        .map((a) => `${a.key}: ${a.value}`)
        .join(', ');
      rows.push({
        'Product Name': p.product_name,
        'Product Description': p.product_description || '',
        SKU: v.sku,
        Attributes: attrs,
        'Price (RM)': v.price ? Number(v.price).toFixed(2) : '',
        Qty: v.in_stock_count ?? 0,
        Remarks: v.remarks || '',
      });
    });
  });
  return rows;
}

export default function ProductListing() {
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);

  const [nameFilter, setNameFilter] = useState('');
  const [skuFilter, setSkuFilter] = useState('');
  const [appliedName, setAppliedName] = useState('');
  const [appliedSku, setAppliedSku] = useState('');

  const [sortAsc, setSortAsc] = useState(true);
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  useEffect(() => {
    apiFetch('/api/products')
      .then((res) => res.json())
      .then((data) => setProducts(data))
      .catch((err) => console.error('Failed to load products:', err));
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    setAppliedName(nameFilter.trim().toLowerCase());
    setAppliedSku(skuFilter.trim().toLowerCase());
    setPage(1);
  };

  const handleClear = () => {
    setNameFilter('');
    setSkuFilter('');
    setAppliedName('');
    setAppliedSku('');
    setPage(1);
  };

  const filteredProducts = useMemo(() => {
    let result = products.filter((p) => {
      const nameMatch = !appliedName || p.product_name.toLowerCase().includes(appliedName);
      const skuMatch = !appliedSku || p.variants.some((v) => v.sku.toLowerCase().includes(appliedSku));
      return nameMatch && skuMatch;
    });

    result = [...result].sort((a, b) =>
      sortAsc
        ? a.product_name.localeCompare(b.product_name)
        : b.product_name.localeCompare(a.product_name)
    );

    return result;
  }, [products, appliedName, appliedSku, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / pageSize));
  const pagedProducts = filteredProducts.slice((page - 1) * pageSize, page * pageSize);

  const handlePageChange = (next) => {
    if (next < 1 || next > totalPages) return;
    setPage(next);
  };

  const handleCopy = async () => {
    const rows = flattenForExport(filteredProducts);
    if (rows.length === 0) return;
    const header = Object.keys(rows[0]).join('\t');
    const body = rows.map((r) => Object.values(r).join('\t')).join('\n');
    try {
      await navigator.clipboard.writeText(`${header}\n${body}`);
      alert('Copied to clipboard.');
    } catch (err) {
      console.error('Copy failed:', err);
      alert('Could not copy — your browser may be blocking clipboard access.');
    }
  };

  const handleCsv = () => {
    const rows = flattenForExport(filteredProducts);
    if (rows.length === 0) return;
    const header = Object.keys(rows[0]).join(',');
    const body = rows
      .map((r) => Object.values(r).map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([`${header}\n${body}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'products.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExcel = () => {
    const rows = flattenForExport(filteredProducts);
    if (rows.length === 0) return;
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Products');
    XLSX.writeFile(workbook, 'products.xlsx');
  };

  const handlePrint = () => window.print();

  return (
    <div className="listing-page">
      <div className="listing-page-header">
        <h2>Products</h2>
        <p className="listing-breadcrumb">Home / Products</p>
      </div>

      <div className="listing-card">
        <form className="listing-filter-grid" onSubmit={handleSearch}>
          <div className="form-group">
            <label>Product Name</label>
            <input
              type="text"
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
              placeholder="e.g. Jacket"
            />
          </div>
          {/* <div className="form-group">
            <label>SKU</label>
            <input
              type="text"
              value={skuFilter}
              onChange={(e) => setSkuFilter(e.target.value)}
              placeholder="e.g. JACK-V1"
            />
          </div> */}
          <div className="listing-filter-actions">
            <button type="submit" className="btn-search">Search</button>
            <button type="button" className="btn-clear" onClick={handleClear}>Clear</button>
          </div>
          <div className="listing-add-action">
            <button type="button" className="btn-add-product" onClick={() => navigate('/registry')}>
              + Add Product
            </button>
          </div>
        </form>

        <div className="listing-toolbar">
          <div className="entries-control">
            <span>Show</span>
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <span>entries</span>
          </div>

          <div className="export-buttons">
            <button type="button" onClick={handleCopy}>Copy</button>
            <button type="button" onClick={handleCsv}>CSV</button>
            <button type="button" onClick={handleExcel}>Excel</button>
            <button type="button" onClick={handlePrint}>Print</button>
          </div>
        </div>

        {pagedProducts.length === 0 ? (
          <p className="empty-state">
            {products.length === 0 ? 'No products registered yet.' : 'No products match your search.'}
          </p>
        ) : (
          <table className="products-flat-table">
            <thead>
              <tr>
                <th>#</th>
                <th>
                  <button type="button" className="sort-toggle" onClick={() => setSortAsc((prev) => !prev)}>
                    Product Name {sortAsc ? '↑' : '↓'}
                  </button>
                </th>
                <th>Product Description</th>
                <th>Variants</th>
              </tr>
            </thead>
            <tbody>
              {pagedProducts.map((product, index) => (
                <tr key={product.product_id}>
                  <td>{(page - 1) * pageSize + index + 1}.</td>
                  <td>
                    <button
                      type="button"
                      className="product-link"
                      onClick={() => navigate(`/listing/${product.product_id}`)}
                    >
                      {product.product_name}
                    </button>
                  </td>
                  <td>{product.product_description || '—'}</td>
                  <td>{product.variants.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {filteredProducts.length > 0 && (
          <div className="pagination-bar">
            <button className="btn-secondary" onClick={() => handlePageChange(page - 1)} disabled={page <= 1}>
              Previous
            </button>
            <span className="pagination-status">Page {page} of {totalPages}</span>
            <button className="btn-secondary" onClick={() => handlePageChange(page + 1)} disabled={page >= totalPages}>
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}