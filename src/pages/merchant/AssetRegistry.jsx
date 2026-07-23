// src/pages/AssetRegistry.jsx
import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../utils/api';
import '../../styles/AssetRegistry.css';

// Generates a random hex color for the "auto-generate" color option
function randomColor() {
  const hex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  return `#${hex}`;
}

// Builds a SKU prefix from the product name, e.g. "Dell Latitude" -> "DELL"
function productPrefix(name) {
  if (!name) return 'PROD';
  return name.replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase() || 'PROD';
}

// Converts the backend's JSONB object shape { Size: "Large" } back into
// the array-of-objects shape this page's UI expects: [{ id, key, value }]
function attributesObjectToArray(attributesObject) {
  if (!attributesObject) return [];
  return Object.entries(attributesObject).map(([key, value]) => ({
    id: crypto.randomUUID(),
    key,
    value,
  }));
}

function makeEmptyVariant(index, productName) {
  return {
    variant_id: crypto.randomUUID(),
    attributes: [], // [{ id, key, value }] — fully user-defined (weight, size, etc.)
    price: '',
    sku: `${productPrefix(productName)}-V${index}`,
    autoSku: true,
    remarks: '',
    color: randomColor(),
  };
}

export default function AssetRegistry() {
  const [products, setProducts] = useState([]);

  useEffect(() => {
    apiFetch('/api/products')
      .then((res) => res.json())
      .then((data) => setProducts(data))
      .catch((err) => console.error('Failed to load products:', err));
  }, []);

  const [productForm, setProductForm] = useState({ name: '', description: '' });
  const [variantDrafts, setVariantDrafts] = useState([makeEmptyVariant(1, '')]);

  // --- Product-level handlers -------------------------------------------

  const handleProductFieldChange = (e) => {
    const { name, value } = e.target;
    setProductForm((prev) => ({ ...prev, [name]: value }));

    if (name === 'name') {
      setVariantDrafts((prev) =>
        prev.map((v, i) =>
          v.autoSku ? { ...v, sku: `${productPrefix(value)}-V${i + 1}` } : v
        )
      );
    }
  };

  const addVariantDraft = () => {
    setVariantDrafts((prev) => [
      ...prev,
      makeEmptyVariant(prev.length + 1, productForm.name),
    ]);
  };

  const removeVariantDraft = (variantId) => {
    setVariantDrafts((prev) => prev.filter((v) => v.variant_id !== variantId));
  };

  // Duplicates an existing variant's attributes/price/remarks/color into a
  // brand new variant draft — saves re-typing Size/Color/etc. one by one
  // when several variants share most of the same details.
  const copyVariantDraft = (variantId) => {
    setVariantDrafts((prev) => {
      const source = prev.find((v) => v.variant_id === variantId);
      if (!source) return prev;

      const newIndex = prev.length + 1;
      const copy = {
        ...source,
        variant_id: crypto.randomUUID(),
        // New random IDs for each attribute row too, so editing the copy
        // doesn't accidentally affect the original's attribute list.
        attributes: source.attributes.map((attr) => ({
          ...attr,
          id: crypto.randomUUID(),
        })),
        sku: source.autoSku
          ? `${productPrefix(productForm.name)}-V${newIndex}`
          : `${source.sku}-COPY`,
      };

      return [...prev, copy];
    });
  };

  // --- Variant-level handlers ---------------------------------------------

  const updateVariant = (variantId, field, value) => {
    setVariantDrafts((prev) =>
      prev.map((v) => (v.variant_id === variantId ? { ...v, [field]: value } : v))
    );
  };

  const toggleAutoSku = (variantId, checked) => {
    setVariantDrafts((prev) =>
      prev.map((v, i) => {
        if (v.variant_id !== variantId) return v;
        return {
          ...v,
          autoSku: checked,
          sku: checked ? `${productPrefix(productForm.name)}-V${i + 1}` : v.sku,
        };
      })
    );
  };

  const handleAutoColor = (variantId) => {
    updateVariant(variantId, 'color', randomColor());
  };

  // --- Attribute handlers (dynamic key/value pairs per variant) ----------

  const addAttribute = (variantId) => {
    setVariantDrafts((prev) =>
      prev.map((v) =>
        v.variant_id === variantId
          ? {
              ...v,
              attributes: [
                ...v.attributes,
                { id: crypto.randomUUID(), key: '', value: '' },
              ],
            }
          : v
      )
    );
  };

  const updateAttribute = (variantId, attrId, field, value) => {
    setVariantDrafts((prev) =>
      prev.map((v) =>
        v.variant_id === variantId
          ? {
              ...v,
              attributes: v.attributes.map((a) =>
                a.id === attrId ? { ...a, [field]: value } : a
              ),
            }
          : v
      )
    );
  };

  const removeAttribute = (variantId, attrId) => {
    setVariantDrafts((prev) =>
      prev.map((v) =>
        v.variant_id === variantId
          ? { ...v, attributes: v.attributes.filter((a) => a.id !== attrId) }
          : v
      )
    );
  };

  // --- Print / submit -------------------------------------------------------

  const handleProductSubmit = async (e) => {
    e.preventDefault();

    if (!productForm.name.trim()) return;
    if (variantDrafts.length === 0) return;

    const missingSku = variantDrafts.some((v) => !v.sku.trim());
    if (missingSku) {
      alert('Every variant needs a SKU.');
      return;
    }

    const payload = {
      product_name: productForm.name.trim(),
      product_description: productForm.description.trim(),
      variants: variantDrafts.map((v) => ({ ...v })),
    };

    try {
      const res = await apiFetch('/api/products', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const result = await res.json();

      if (!res.ok) {
        alert(result.message || 'Failed to save product.');
        return;
      }

      setProducts((prev) => [result, ...prev]);
      setProductForm({ name: '', description: '' });
      setVariantDrafts([makeEmptyVariant(1, '')]);
    } catch (err) {
      alert('Could not reach server. Check it is running.');
      console.error(err);
    }
  };

  return (
    <div className="asset-registry">
      <section className="registry-form-section">
        <h2>Register New Product</h2>
        <form className="product-form" onSubmit={handleProductSubmit}>
          <div className="form-group">
            <label htmlFor="name">Product Name</label>
            <input
              id="name"
              name="name"
              type="text"
              value={productForm.name}
              onChange={handleProductFieldChange}
              placeholder="e.g. Cotton T-Shirt"
              required
            />
          </div>

          <div className="form-group form-group-wide">
            <label htmlFor="description">Product Description</label>
            <textarea
              id="description"
              name="description"
              value={productForm.description}
              onChange={handleProductFieldChange}
              placeholder="Optional notes about the product overall"
              rows={2}
            />
          </div>

          <div className="variants-block">
            <div className="variants-header">
              <h3>Variants</h3>
              <button type="button" className="btn-secondary" onClick={addVariantDraft}>
                + Add Variant
              </button>
            </div>

            {variantDrafts.map((variant, index) => (
              <div key={variant.variant_id} className="variant-card">
                <div className="variant-card-header">
                  <span className="variant-index">Variant {index + 1}</span>
                  <div className="variant-card-actions">
                    <button
                      type="button"
                      className="btn-secondary btn-copy-variant"
                      onClick={() => copyVariantDraft(variant.variant_id)}
                    >
                      Copy
                    </button>
                    {variantDrafts.length > 1 && (
                      <button
                        type="button"
                        className="btn-remove"
                        onClick={() => removeVariantDraft(variant.variant_id)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                <div className="attributes-block">
                  <label className="section-label">Attributes</label>
                  {variant.attributes.map((attr) => (
                    <div key={attr.id} className="attribute-row">
                      <input
                        type="text"
                        placeholder="Attribute name (e.g. Size)"
                        value={attr.key}
                        onChange={(e) =>
                          updateAttribute(variant.variant_id, attr.id, 'key', e.target.value)
                        }
                      />
                      <input
                        type="text"
                        placeholder="Value (e.g. Large)"
                        value={attr.value}
                        onChange={(e) =>
                          updateAttribute(variant.variant_id, attr.id, 'value', e.target.value)
                        }
                      />
                      <button
                        type="button"
                        className="btn-remove-small"
                        onClick={() => removeAttribute(variant.variant_id, attr.id)}
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn-add-attribute"
                    onClick={() => addAttribute(variant.variant_id)}
                  >
                    + Add Attribute
                  </button>
                </div>

                <div className="variant-fields-row">
                  <div className="form-group">
                    <label>Price (RM)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={variant.price}
                      onChange={(e) => updateVariant(variant.variant_id, 'price', e.target.value)}
                      placeholder="0.00"
                    />
                  </div>

                  <div className="form-group">
                    <label>SKU</label>
                    <input
                      type="text"
                      value={variant.sku}
                      onChange={(e) => updateVariant(variant.variant_id, 'sku', e.target.value)}
                      disabled={variant.autoSku}
                    />
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={variant.autoSku}
                        onChange={(e) => toggleAutoSku(variant.variant_id, e.target.checked)}
                      />
                      Auto-generate SKU
                    </label>
                  </div>

                  <div className="form-group">
                    <label>Color</label>
                    <div className="color-row">
                      <input
                        type="color"
                        value={variant.color}
                        onChange={(e) => updateVariant(variant.variant_id, 'color', e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => handleAutoColor(variant.variant_id)}
                      >
                        Auto
                      </button>
                    </div>
                  </div>
                </div>

                <div className="form-group form-group-wide">
                  <label>Remarks</label>
                  <input
                    type="text"
                    value={variant.remarks}
                    onChange={(e) => updateVariant(variant.variant_id, 'remarks', e.target.value)}
                    placeholder="Optional notes for this variant"
                  />
                </div>
              </div>
            ))}
          </div>

          <button type="submit" className="btn-primary btn-submit-product">
            Save Product & All Variants
          </button>
        </form>
      </section>

      <section className="registry-grid-section">
        <h2>Registered Products ({products.length})</h2>

        {products.length === 0 ? (
          <p className="empty-state">No products registered yet.</p>
        ) : (
          products.map((product) => (
            <div key={product.product_id} className="product-block">
              <div className="product-block-header">
                <h3>{product.product_name}</h3>
                {product.product_description && (
                  <p className="product-description">{product.product_description}</p>
                )}
              </div>

              <table className="variant-list-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Attributes</th>
                    <th>Color</th>
                    <th>Price (RM)</th>
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {product.variants.map((variant) => {
                    const attributesArray = attributesObjectToArray(variant.attributes);
                    return (
                    <tr key={variant.variant_id}>
                      <td data-label="SKU">{variant.sku}</td>
                      <td data-label="Attributes">
                        {attributesArray.length > 0
                          ? attributesArray.map((a) => `${a.key}: ${a.value}`).join(', ')
                          : '—'}
                      </td>
                      <td data-label="Color">
                        <span className="variant-color-dot" style={{ background: variant.color }} />
                      </td>
                      <td data-label="Price (RM)">{variant.price ? Number(variant.price).toFixed(2) : '—'}</td>
                      <td data-label="Remarks">{variant.remarks || '—'}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))
        )}
      </section>
    </div>
  );
}