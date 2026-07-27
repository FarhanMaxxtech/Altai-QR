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
  // Replaces availableBatches / batchSelections
  const [availableBalance, setAvailableBalance] = useState(0);
  const [quantityInputs, setQuantityInputs] = useState({}); // { [variant_id]: string }
  const [assigningVariantId, setAssigningVariantId] = useState(null);
  const [assignError, setAssignError] = useState('');
  const [assignSuccess, setAssignSuccess] = useState('');

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
        }
      })
      .catch((err) => console.error('Failed to load product:', err))
      .finally(() => setLoading(false));
  };

  // Merchant-scoped: only batches generated for the currently logged-in
  // merchant come back from this endpoint (req.user.user_id on the backend).
    const loadAvailableBalance = () => {
      apiFetch('/api/qrcode/balance')
        .then((res) => res.json())
        .then((data) => setAvailableBalance(data.available))
        .catch((err) => console.error('Failed to load QR balance:', err));
    };

    useEffect(() => {
      loadProduct();
      loadAvailableBalance();
    }, [productId]);

    const handleAssignQuantity = async (variantId) => {
    setAssignError('');
    setAssignSuccess('');

    const qty = Number(quantityInputs[variantId]);
    if (!qty || qty <= 0) {
      setAssignError('Enter a valid quantity.');
      return;
    }
    if (qty > availableBalance) {
      setAssignError(`Only ${availableBalance} unassigned codes available in your balance.`);
      return;
    }

    setAssigningVariantId(variantId);
    try {
      const res = await apiFetch('/api/qrcode/assign-quantity', {
        method: 'POST',
        body: JSON.stringify({ variant_id: variantId, quantity: qty }),
      });
      const result = await res.json();

      if (!res.ok) {
        setAssignError(result.message || 'Could not assign codes.');
        return;
      }

      setAssignSuccess(`Assigned ${result.assigned_count} codes to this variant.`);
      setQuantityInputs((prev) => ({ ...prev, [variantId]: '' }));
      loadProduct();          // refresh in_stock/assigned counts
      loadAvailableBalance(); // pool just shrank
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
                <th>Batch Assignment</th>
              </tr>
            </thead>
            <tbody>
              {product.variants.map((variant, index) => {
                const attributesArray = attributesObjectToArray(variant.attributes);
                const isAssigned = variant.assigned_unit_count > 0;

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
                    <td data-label="Batch Assignment">
                      {isAssigned ? (
                        <div className="batch-assigned-info">
                          <span className="batch-assigned-badge">Assigned</span>
                          <span className="batch-assigned-stat">
                            {variant.assigned_unit_count} unit{variant.assigned_unit_count === 1 ? '' : 's'} linked
                          </span>
                          <span className="batch-assigned-stat batch-assigned-stat-muted">
                            {variant.in_stock_count ?? 0} in stock
                          </span>
                        </div>
                      ) : (
                        <div className="batch-assign-block">
                          {availableBalance === 0 ? (
                            <span className="batch-none-text">No unassigned codes left</span>
                          ) : (
                            <>
                              <input
                                type="number"
                                min="1"
                                max={availableBalance}
                                placeholder={`up to ${availableBalance}`}
                                value={quantityInputs[variant.variant_id] || ''}
                                onChange={(e) =>
                                  setQuantityInputs((prev) => ({ ...prev, [variant.variant_id]: e.target.value }))
                                }
                              />
                              <button
                                type="button"
                                className="btn-secondary btn-assign-batch"
                                onClick={() => handleAssignQuantity(variant.variant_id)}
                                disabled={assigningVariantId === variant.variant_id}
                              >
                                {assigningVariantId === variant.variant_id ? 'Assigning…' : 'Assign'}
                              </button>
                            </>
                          )}
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