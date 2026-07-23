// src/pages/merchant/RegisterProduct.jsx
import React, { useState } from 'react';
import { apiFetch } from '../../utils/api';
import '../../styles/AssetRegistry.css';

function randomColor() {
  const hex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  return `#${hex}`;
}

function productPrefix(name) {
  if (!name) return 'PROD';
  return name.replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase() || 'PROD';
}

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
    attributes: [],
    price: '',
    sku: `${productPrefix(productName)}-V${index}`,
    autoSku: true,
    remarks: '',
    color: randomColor(),
  };
}

export default function RegisterProduct() {
  const [productForm, setProductForm] = useState({ name: '', description: '' });
  const [variantDrafts, setVariantDrafts] = useState([makeEmptyVariant(1, '')]);

  // Just-registered product, shown for immediate verification. No fetch —
  // the POST response already contains the full product + variants.
  const [lastRegistered, setLastRegistered] = useState(null);

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
    setVariantDrafts((prev) => [...prev, makeEmptyVariant(prev.length + 1, productForm.name)]);
  };

  const removeVariantDraft = (variantId) => {
    setVariantDrafts((prev) => prev.filter((v) => v.variant_id !== variantId));
  };

  const copyVariantDraft = (variantId) => {
    setVariantDrafts((prev) => {
      const source = prev.find((v) => v.variant_id === variantId);
      if (!source) return prev;
      const newIndex = prev.length + 1;
      const copy = {
        ...source,
        variant_id: crypto.randomUUID(),
        attributes: source.attributes.map((attr) => ({ ...attr, id: crypto.randomUUID() })),
        sku: source.autoSku
          ? `${productPrefix(productForm.name)}-V${newIndex}`
          : `${source.sku}-COPY`,
      };
      return [...prev, copy];
    });
  };

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

  const handleAutoColor = (variantId) => updateVariant(variantId, 'color', randomColor());

  const addAttribute = (variantId) => {
    setVariantDrafts((prev) =>
      prev.map((v) =>
        v.variant_id === variantId
          ? { ...v, attributes: [...v.attributes, { id: crypto.randomUUID(), key: '', value: '' }] }
          : v
      )
    );
  };

  const updateAttribute = (variantId, attrId, field, value) => {
    setVariantDrafts((prev) =>
      prev.map((v) =>
        v.variant_id === variantId
          ? { ...v, attributes: v.attributes.map((a) => (a.id === attrId ? { ...a, [field]: value } : a)) }
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

      setLastRegistered(result); // <-- shows immediately below, no refetch
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
                        onChange={(e) => updateAttribute(variant.variant_id, attr.id, 'key', e.target.value)}
                      />
                      <input
                        type="text"
                        placeholder="Value (e.g. Large)"
                        value={attr.value}
                        onChange={(e) => updateAttribute(variant.variant_id, attr.id, 'value', e.target.value)}
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
                  <button type="button" className="btn-add-attribute" onClick={() => addAttribute(variant.variant_id)}>
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
                      <button type="button" className="btn-secondary" onClick={() => handleAutoColor(variant.variant_id)}>
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

      {lastRegistered && (
        <section className="registry-grid-section">
          <h2>Just Registered</h2>
          <div className="product-block">
            <div className="product-block-header">
              <h3>{lastRegistered.product_name}</h3>
              {lastRegistered.product_description && (
                <p className="product-description">{lastRegistered.product_description}</p>
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
                {lastRegistered.variants.map((variant) => {
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
                      <td data-label="Price (RM)">
                        {variant.price ? Number(variant.price).toFixed(2) : '—'}
                      </td>
                      <td data-label="Remarks">{variant.remarks || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="section-hint">
            Head to Product InfoCenter → Product Listing to see all registered products.
          </p>
        </section>
      )}
    </div>
  );
}