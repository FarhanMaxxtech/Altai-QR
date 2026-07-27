// src/pages/merchant/ProductDetails.jsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import '../../styles/ProductListing.css';

function batchLabel(batch) {
  const prefix = batch.serial_start?.split('-')[0];
  return prefix ? `${batch.company_name} (${prefix})` : batch.company_name;
}

function attributesObjectToArray(attributesObject) {
  if (!attributesObject) return [];
  return Object.entries(attributesObject).map(([key, value]) => ({
    id: crypto.randomUUID(),
    key,
    value,
  }));
}

export default function ProductDetails() {
  const { productId } = useParams();
  const navigate = useNavigate();

  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [batchBreakdowns, setBatchBreakdowns] = useState({});

  const loadProduct = () => {
    apiFetch('/api/products')
      .then((res) => res.json())
      .then((data) => {
        const found = data.find((p) => p.product_id === productId);
        if (!found) {
          setNotFound(true);
        } else {
          setProduct(found);
          loadBatchBreakdowns(found.variants);
        }
      })
      .catch((err) => console.error('Failed to load product:', err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadProduct();
  }, [productId]);

  const loadBatchBreakdowns = (variants) => {
    Promise.all(
      variants.map((v) =>
        apiFetch(`/api/qrcode/variants/${v.variant_id}/batch-summary`)
          .then((res) => res.json())
          .then((data) => [v.variant_id, data])
      )
    )
      .then((entries) => {
        const map = {};
        entries.forEach(([variantId, data]) => { map[variantId] = data; });
        setBatchBreakdowns(map);
      })
      .catch((err) => console.error('Failed to load batch breakdowns:', err));
  };

  if (loading) {
    return <div className="listing-page"><p className="empty-state">Loading…</p></div>;
  }

  if (notFound || !product) {
    return (
      <div className="listing-page">
        <p className="empty-state">Product not found.</p>
        <button className="btn-secondary" onClick={() => navigate('/listing')}>
          &larr; Back to Products
        </button>
      </div>
    );
  }

  return (
    <div className="listing-page">
      <div className="listing-page-header">
        <h2>Product Info</h2>
        <p className="listing-breadcrumb">
          <Link to="/listing">Products</Link> / Product Info
        </p>
      </div>

      <div className="listing-card">
        <div className="detail-section-header">
          <h3>Product Details</h3>
        </div>

        <div className="detail-fields">
          <div className="detail-field">
            <span className="detail-label">Product Name</span>
            <span className="detail-value">{product.product_name}</span>
          </div>
          <div className="detail-field">
            <span className="detail-label">Product Description</span>
            <span className="detail-value">{product.product_description || '—'}</span>
          </div>
        </div>
      </div>

      <div className="listing-card">
        <div className="detail-section-header">
          <h3>Product Variations</h3>
          <span className="variant-count-badge">{product.variants.length}</span>
        </div>

        {product.variants.length === 0 ? (
          <p className="empty-state">No variants for this product.</p>
        ) : (
          <table className="variant-list-table">
            <thead>
              <tr>
                <th>#</th>
                <th>SKU</th>
                <th>Attributes</th>
                <th>Price (RM)</th>
                <th>Qty</th>
                <th>Remarks</th>
                <th>Assigned Batches</th>
              </tr>
            </thead>
            <tbody>
              {product.variants.map((variant, index) => {
                const attributesArray = attributesObjectToArray(variant.attributes);
                const breakdown = batchBreakdowns[variant.variant_id] || [];
                const totalAssigned = breakdown.reduce((sum, b) => sum + Number(b.count), 0);

                return (
                  <tr key={variant.variant_id}>
                    <td data-label="#">{index + 1}</td>
                    <td data-label="SKU">{variant.sku}</td>
                    <td data-label="Attributes">
                      {attributesArray.length > 0
                        ? attributesArray.map((a) => `${a.key}: ${a.value}`).join(', ')
                        : '—'}
                    </td>
                    <td data-label="Price (RM)">
                      {variant.price ? Number(variant.price).toFixed(2) : '—'}
                    </td>
                    <td data-label="Qty">{variant.in_stock_count ?? 0}</td>
                    <td data-label="Remarks">{variant.remarks || '—'}</td>

                    <td data-label="Assigned Batches">
                      {breakdown.length === 0 ? (
                        <span className="batch-none-text">None yet</span>
                      ) : (
                        <div className="assigned-batches-list">
                          {breakdown.map((b) => (
                            <div key={b.batch_id} className="assigned-batch-row">
                              <span className="assigned-batch-name">{batchLabel(b)}</span>
                              <span className="assigned-batch-qty">{b.count} units</span>
                            </div>
                          ))}
                          <div className="assigned-batch-total">Total: {totalAssigned} units</div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <button className="btn-secondary" style={{ marginTop: 16 }} onClick={() => navigate('/listing')}>
          &larr; Back to Products
        </button>
      </div>
    </div>
  );
}