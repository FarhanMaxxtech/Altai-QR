// src/pages/merchant/RegisterProduct.jsx
import React, { useState, useEffect } from 'react';
import { PackageCheck } from 'lucide-react';
import { apiFetch } from '../../utils/api';
import '../../styles/AssetRegistry.css';

const DRAFT_STORAGE_KEY = 'register-product-draft-v1';

function productPrefix(name) {
  if (!name) return 'PROD';
  return name.replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase() || 'PROD';
}

function computeVariantSku(variant, index, skuPrefix) {
  if (!variant.autoSku) return variant.sku;
  return `${skuPrefix || 'PROD'}-V${index + 1}`;
}

function attributesObjectToArray(attributesObject) {
  if (!attributesObject) return [];
  return Object.entries(attributesObject).map(([key, value]) => ({
    id: crypto.randomUUID(),
    key,
    value,
  }));
}

// near the top, with the other constants
const ATTRIBUTE_PRESETS = ['Model', 'Color', 'Capacity', 'Material', 'Pack Size'];

function makeEmptyVariant() {
  return {
    variant_id: crypto.randomUUID(),
    attributes: [],
    price: '',
    openingQty: '',
    sku: '',
    autoSku: true,
    remarks: '',
  };
}

const handleSingleVariant = () => {
  setVariantDrafts((prev) => [
    { ...prev[0], variant_id: prev[0]?.variant_id || crypto.randomUUID() },
  ]);
};

const updateAttributeKeyFromSelect = (variantId, attrId, value) => {
  updateAttribute(variantId, attrId, 'key', value === 'Custom' ? '' : value);
};

function makeEmptyProductForm() {
  return { name: '', skuPrefix: '', category: '', description: '', reorderPoint: '' };
}

export default function RegisterProduct() {
  const [productForm, setProductForm] = useState(makeEmptyProductForm());
  const [autoSkuPrefix, setAutoSkuPrefix] = useState(true);
  const [variantDrafts, setVariantDrafts] = useState([makeEmptyVariant()]);
  const [draftSavedMessage, setDraftSavedMessage] = useState('');
  const [categoryOptions, setCategoryOptions] = useState([]);

  const [lastRegistered, setLastRegistered] = useState(null);

  useEffect(() => {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw);
      if (draft.productForm) setProductForm(draft.productForm);
      if (draft.variantDrafts) setVariantDrafts(draft.variantDrafts);
      setAutoSkuPrefix(false);
    } catch (err) {
      console.error('Failed to restore draft:', err);
    }
  }, []);

  useEffect(() => {
    apiFetch('/api/products/categories')
      .then((res) => res.json())
      .then((data) => setCategoryOptions(data))
      .catch((err) => console.error('Failed to load categories:', err));
  }, []);

  // --- Product-level field handlers ----------------------------------------

const handleProductFieldChange = (e) => {
  const { name, value } = e.target;
  setProductForm((prev) => ({ ...prev, [name]: value }));

  if (name === 'name' && autoSkuPrefix) {
    const nextPrefix = productPrefix(value); // productPrefix() already .toUpperCase()s
    setProductForm((prev) => ({ ...prev, skuPrefix: nextPrefix }));
  }
};

const handleSkuPrefixChange = (e) => {
  const value = e.target.value.toUpperCase();
  setAutoSkuPrefix(false); // user has taken manual control of the prefix
  setProductForm((prev) => ({ ...prev, skuPrefix: value }));
};

  // --- Variant-level handlers ------------------------------------------------

  const addVariantDraft = () => {
    setVariantDrafts((prev) => [...prev, makeEmptyVariant(prev.length + 1, productForm.skuPrefix)]);
  };

  const removeVariantDraft = (variantId) => {
    setVariantDrafts((prev) => prev.filter((v) => v.variant_id !== variantId));
  };

const duplicateVariantDraft = (variantId) => {
  setVariantDrafts((prev) => {
    const idx = prev.findIndex((v) => v.variant_id === variantId);
    if (idx === -1) return prev;
    const source = prev[idx];
    const sourceSku = computeVariantSku(source, idx, productForm.skuPrefix);

    const copy = {
      ...source,
      variant_id: crypto.randomUUID(),
      attributes: source.attributes.map((attr) => ({ ...attr, id: crypto.randomUUID() })),
      autoSku: false,
      sku: `${sourceSku}-COPY`,
    };

    return [...prev, copy];
  });
};

  const updateVariant = (variantId, field, value) => {
    setVariantDrafts((prev) =>
      prev.map((v) => (v.variant_id === variantId ? { ...v, [field]: value } : v))
    );
  };

  const handleSkuFieldChange = (variantId, value) => {
    setVariantDrafts((prev) =>
      prev.map((v) => (v.variant_id === variantId ? { ...v, sku: value, autoSku: false } : v))
    );
  };

const addAttribute = (variantId) => {
  setVariantDrafts((prev) =>
    prev.map((v) =>
      v.variant_id === variantId
        ? {
            ...v,
            attributes: [
              ...v.attributes,
              { id: crypto.randomUUID(), key: ATTRIBUTE_PRESETS[0], value: '' }, // 'Model'
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

  // --- Save draft / submit ---------------------------------------------------

  const handleSaveDraft = () => {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ productForm, variantDrafts }));
    setDraftSavedMessage('Draft saved on this device.');
    setTimeout(() => setDraftSavedMessage(''), 3000);
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
      // NOTE: product_category and reorder_point aren't yet columns on the
      // `products` table / accepted by POST /api/products — sending them
      // now is forward-compatible but they won't persist until the backend
      // is updated.
      product_category: productForm.category.trim(),
      reorder_point: productForm.reorderPoint ? Number(productForm.reorderPoint) : null,
      variants: variantDrafts.map((v, i) => ({
  ...v,
  sku: computeVariantSku(v, i, productForm.skuPrefix),
  opening_qty: v.openingQty ? Number(v.openingQty) : 0,
})),
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

      setLastRegistered(result);
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      setProductForm(makeEmptyProductForm());
      setAutoSkuPrefix(true);
      setVariantDrafts([makeEmptyVariant(1, '')]);
    } catch (err) {
      alert('Could not reach server. Check it is running.');
      console.error(err);
    }
  };

  return (
    <div className="register-product-layout">
      <section className="listing-card product-details-card">
        <h2>Product Details</h2>

        <form className="product-form" onSubmit={handleProductSubmit}>
          <div className="product-details-grid">
            <div className="form-group form-group-wide">
              <label htmlFor="name">Product Name <span className="required-asterisk">*</span></label>
              <input
                id="name"
                name="name"
                type="text"
                value={productForm.name}
                onChange={handleProductFieldChange}
                placeholder="e.g. Merino Turtle Neck"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="skuPrefix">SKU Prefix <span className="required-asterisk">*</span></label>
              <input
                id="skuPrefix"
                name="skuPrefix"
                type="text"
                value={productForm.skuPrefix}
                onChange={handleSkuPrefixChange}
                placeholder="TURT"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="category">Category <span className="required-asterisk">*</span></label>
              <input
                id="category"
                name="category"
                type="text"
                list="category-options"
                value={productForm.category}
                onChange={handleProductFieldChange}
                placeholder="Select existing or type a new category"
                autoComplete="off"
                required
              />
              <datalist id="category-options">
                {categoryOptions.map((cat) => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>
              <p className="field-hint">Pick from the list, or just type a new category name.</p>
            </div>

            <div className="form-group form-group-wide">
              <label htmlFor="description">Description</label>
              <textarea
                id="description"
                name="description"
                value={productForm.description}
                onChange={handleProductFieldChange}
                placeholder="Short description shown in listings"
                rows={3}
              />
            </div>

            <div className="form-group">
              <label htmlFor="reorderPoint">Reorder Point</label>
              <input
                id="reorderPoint"
                name="reorderPoint"
                type="number"
                min="0"
                value={productForm.reorderPoint}
                onChange={handleProductFieldChange}
                placeholder="10"
              />
            </div>
          </div>

          <div className="variants-block">
                <div className="variants-header">
  <h3>
    <span className="variants-title-text">Variants</span>
    <span className="variants-count-badge">
      {variantDrafts.length} VARIANT{variantDrafts.length === 1 ? '' : 'S'}
    </span>
  </h3>
  <div className="variants-header-actions">
    <button type="button" className="btn-single-variant" onClick={handleSingleVariant}>
      Single variant
    </button>
    <button type="button" className="btn-add-variant" onClick={addVariantDraft}>
      + Add Variant
    </button>
  </div>
</div>

                {variantDrafts.map((variant, index) => {
  const displaySku = computeVariantSku(variant, index, productForm.skuPrefix);
  return (
    <div key={variant.variant_id} className="variant-card">
      <div className="variant-card-header">
        <span className="variant-index">
          <span className="variant-index-number">{index + 1}</span>
          Variant {index + 1}
        </span>
        <div className="variant-card-header-actions">
          <span className="variant-sku-badge">{displaySku}</span>
          <button
            type="button"
            className="variant-duplicate-btn"
            onClick={() => duplicateVariantDraft(variant.variant_id)}
          >
            Duplicate
          </button>
          {variantDrafts.length > 1 && (
            <button
              type="button"
              className="btn-icon-remove"
              onClick={() => removeVariantDraft(variant.variant_id)}
              aria-label="Remove variant"
            >
              &times;
            </button>
          )}
        </div>
      </div>

      {/* attribute rows unchanged from before */}
      <div className="attributes-block">
                      {variant.attributes.map((attr) => {
                        const isCustom = !ATTRIBUTE_PRESETS.includes(attr.key);
                        return (
                          <div key={attr.id} className="attribute-row">
                            <select
                              className="attribute-key-select"
                              value={isCustom ? 'Custom' : attr.key}
                              onChange={(e) => updateAttributeKeyFromSelect(variant.variant_id, attr.id, e.target.value)}
                            >
                              {ATTRIBUTE_PRESETS.map((preset) => (
                                <option key={preset} value={preset}>{preset}</option>
                              ))}
                              <option value="Custom">Custom...</option>
                            </select>

                            {isCustom && (
                              <input
                                type="text"
                                placeholder="Attribute name"
                                value={attr.key}
                                onChange={(e) => updateAttribute(variant.variant_id, attr.id, 'key', e.target.value)}
                              />
                            )}

                            <input
                              type="text"
                              placeholder="e.g. Standard"
                              value={attr.value}
                              onChange={(e) => updateAttribute(variant.variant_id, attr.id, 'value', e.target.value)}
                            />
                            <button
                              type="button"
                              className="btn-icon-remove"
                              onClick={() => removeAttribute(variant.variant_id, attr.id)}
                              aria-label="Remove attribute"
                            >
                              &times;
                            </button>
                          </div>
                        );
                      })}
                      <button type="button" className="btn-add-attribute" onClick={() => addAttribute(variant.variant_id)}>
                        + Add Attribute
                      </button>
                    </div>

      <div className="variant-fields-row">
        <div className="form-group">
          <label>Price (RM)</label>
          <input
            type="number" min="0" step="0.01"
            value={variant.price}
            onChange={(e) => updateVariant(variant.variant_id, 'price', e.target.value)}
            placeholder="0.00"
          />
        </div>

        <div className="form-group">
          <label>Opening Qty</label>
          <input
            type="number" min="0"
            value={variant.openingQty}
            onChange={(e) => updateVariant(variant.variant_id, 'openingQty', e.target.value)}
            placeholder="0"
          />
        </div>

        <div className="form-group">
          <label>SKU {variant.autoSku && <span className="field-auto-tag">auto</span>}</label>
          <input
            type="text"
            value={displaySku}
            onChange={(e) => handleSkuFieldChange(variant.variant_id, e.target.value)}
          />
        </div>
      </div>

      {/* remarks unchanged */}
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
  );
})}
              </div>

          <div className="product-form-actions">
            {draftSavedMessage && <span className="status-text">{draftSavedMessage}</span>}
            <button type="button" className="btn-secondary" onClick={handleSaveDraft}>
              Save Draft
            </button>
            <button type="submit" className="btn-primary btn-submit-product">
              Register Product
            </button>
          </div>
        </form>
      </section>

      <aside className="listing-card next-steps-card">
        <h2>Next Steps</h2>
        <p className="next-steps-intro">
          After registering, print QR labels for each variant and bind them in{' '}
          <strong>Assign QR to Product</strong>. Stock only becomes visible in Balance once at
          least one code is bound.
        </p>
        <ol className="next-steps-list">
          <li className="next-steps-item">
            <span className="next-steps-badge">1</span>
            <span>Print QR labels per variant</span>
          </li>
          <li className="next-steps-item">
            <span className="next-steps-badge">2</span>
            <span>Bind codes in Assign QR to Product</span>
          </li>
          <li className="next-steps-item">
            <span className="next-steps-badge">3</span>
            <span>Receive first delivery into a store</span>
          </li>
        </ol>
      </aside>

      {lastRegistered && (
        <section className="just-registered-card register-product-full-span">
          <div className="just-registered-header">
            <PackageCheck size={18} />
            <h2>Just Registered</h2>
          </div>

          <div className="product-block">
            <div className="product-block-header">
              <h3>{lastRegistered.product_name}</h3>
              <span className="variant-count-badge">
                {lastRegistered.variants.length} variant{lastRegistered.variants.length === 1 ? '' : 's'}
              </span>
              {lastRegistered.product_description && (
                <p className="product-description">{lastRegistered.product_description}</p>
              )}
            </div>

            <div className="variant-table-wrapper">
              <table className="variant-list-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Attributes</th>
                    <th>Price (RM)</th>
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {lastRegistered.variants.map((variant) => {
                    const attributesArray = attributesObjectToArray(variant.attributes);
                    return (
                      <tr key={variant.variant_id}>
                        <td data-label="SKU">
                          <span className="sku-badge">{variant.sku}</span>
                        </td>
                        <td data-label="Attributes">
                          {attributesArray.length > 0
                            ? attributesArray.map((a) => `${a.key}: ${a.value}`).join(', ')
                            : <span className="muted-dash">—</span>}
                        </td>
                        <td data-label="Price (RM)">
                          {variant.price
                            ? <span className="price-badge">{Number(variant.price).toFixed(2)}</span>
                            : <span className="muted-dash">—</span>}
                        </td>
                        <td data-label="Remarks">{variant.remarks || <span className="muted-dash">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}