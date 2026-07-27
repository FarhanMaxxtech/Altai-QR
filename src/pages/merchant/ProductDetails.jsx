// src/pages/merchant/ProductDetails.jsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import '../../styles/ProductListing.css';

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

  // --- Assign Batch state (migrated from the old ProductListing.jsx) -----
  const [assignForms, setAssignForms] = useState({});
  const [availableBatches, setAvailableBatches] = useState([]);
  const [assigningVariantId, setAssigningVariantId] = useState(null);
  const [assignError, setAssignError] = useState('');
  const [assignSuccess, setAssignSuccess] = useState('');
  const [batchBreakdowns, setBatchBreakdowns] = useState({}); 

  const loadProduct = () => {
    // Reuses the same /api/products list the listing page uses (rather than
    // GET /api/products/:id) so Qty here matches the real in-stock counts —
    // the per-id endpoint doesn't include those computed stats.
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

  // Merchant-scoped: only batches generated for the currently logged-in
  // merchant come back from this endpoint (req.user.user_id on the backend).
    const loadAvailableBatches = () => {
        apiFetch('/api/qrcode/batches/available')
          .then((res) => res.json())
          .then((data) => setAvailableBatches(data))
          .catch((err) => console.error('Failed to load available batches:', err));
      };

      useEffect(() => {
        loadProduct();
        loadAvailableBatches();
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

    const updateAssignForm = (variantId, field, value) => {
      setAssignForms((prev) => ({
        ...prev,
        [variantId]: { ...(prev[variantId] || { batch_id: '', quantity: '' }), [field]: value },
      }));
    };
    const handleAssignQuantity = async (variantId) => {
        setAssignError('');
        setAssignSuccess('');

        const form = assignForms[variantId] || {};
        const batch = availableBatches.find((b) => b.batch_id === form.batch_id);

        if (!form.batch_id) {
          setAssignError('Select a batch first.');
          return;
        }
        const qty = Number(form.quantity);
        if (!qty || qty <= 0) {
          setAssignError('Enter a valid quantity.');
          return;
        }
        if (batch && qty > batch.unassigned_count) {
          setAssignError(`Only ${batch.unassigned_count} unassigned codes left in that batch.`);
          return;
        }

        setAssigningVariantId(variantId);
        try {
          const res = await apiFetch(`/api/qrcode/batches/${form.batch_id}/assign-quantity`, {
            method: 'POST',
            body: JSON.stringify({ variant_id: variantId, quantity: qty }),
          });
          const result = await res.json();

          if (!res.ok) {
            setAssignError(result.message || 'Could not assign codes.');
            return;
          }

          setAssignSuccess(`Assigned ${result.assigned_count} codes to this variant.`);
          setAssignForms((prev) => {
            const next = { ...prev };
            delete next[variantId];
            return next;
          });
          loadProduct();
          loadAvailableBatches();
        } catch (err) {
          setAssignError('Could not reach server. Check it is running.');
          console.error(err);
        } finally {
          setAssigningVariantId(null);
        }
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

        {assignError && <p className="error-text">{assignError}</p>}
        {assignSuccess && <p className="success-text">{assignSuccess}</p>}

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
                  <th>Assign More</th>
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
                                <span className="assigned-batch-name">{b.company_name}</span>
                                <span className="assigned-batch-qty">{b.count} units</span>
                              </div>
                            ))}
                            <div className="assigned-batch-total">Total: {totalAssigned} units</div>
                          </div>
                        )}
                      </td>

                      <td data-label="Assign More">
                        <div className="batch-assign-block">
                          {availableBatches.length === 0 ? (
                            <span className="batch-none-text">No available batches</span>
                          ) : (
                            <>
                              <div className="assign-field">
                                <label>Batch</label>
                                <select
                                  value={assignForms[variant.variant_id]?.batch_id || ''}
                                  onChange={(e) => updateAssignForm(variant.variant_id, 'batch_id', e.target.value)}
                                >
                                  <option value="">Select a batch...</option>
                                  {availableBatches.map((batch) => (
                                    <option key={batch.batch_id} value={batch.batch_id}>
                                      {batch.company_name} — {batch.unassigned_count} available ({batch.serial_start}–{batch.serial_end})
                                    </option>
                                  ))}
                                </select>
                              </div>

                              {assignForms[variant.variant_id]?.batch_id && (() => {
                                const chosen = availableBatches.find(
                                  (b) => b.batch_id === assignForms[variant.variant_id].batch_id
                                );
                                return (
                                  <>
                                    <div className="assign-batch-summary">
                                      <span className="assign-batch-name">{chosen.company_name}</span>
                                      <span className="assign-batch-count">{chosen.unassigned_count} unassigned</span>
                                    </div>

                                    <div className="assign-field">
                                      <label>Quantity</label>
                                      <input
                                        type="number"
                                        min="1"
                                        max={chosen.unassigned_count}
                                        placeholder={`up to ${chosen.unassigned_count}`}
                                        value={assignForms[variant.variant_id]?.quantity || ''}
                                        onChange={(e) => updateAssignForm(variant.variant_id, 'quantity', e.target.value)}
                                      />
                                    </div>

                                    <button
                                      type="button"
                                      className="btn-secondary btn-assign-batch"
                                      onClick={() => handleAssignQuantity(variant.variant_id)}
                                      disabled={assigningVariantId === variant.variant_id}
                                    >
                                      {assigningVariantId === variant.variant_id ? 'Assigning…' : 'Assign'}
                                    </button>
                                  </>
                                );
                              })()}
                            </>
                          )}
                        </div>
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