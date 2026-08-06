// src/components/EditVariantModal.jsx
import React, { useState } from 'react';
import { X } from 'lucide-react';
import { apiFetch } from '../utils/api';
import '../styles/EditVariantModal.css';

const ATTRIBUTE_PRESETS = ['Model', 'Color', 'Capacity', 'Material', 'Pack Size'];

function attributesObjectToArray(attributesObject) {
  if (!attributesObject) return [];
  return Object.entries(attributesObject).map(([key, value]) => ({
    id: crypto.randomUUID(),
    key,
    value,
  }));
}

export default function EditVariantModal({ product, variant, onClose, onSaved, onDeleted, canDelete = true }) {
  const [sku, setSku] = useState(variant.sku || '');
  const [price, setPrice] = useState(variant.price || '');
  const [remarks, setRemarks] = useState(variant.remarks || '');
  const [attributes, setAttributes] = useState(attributesObjectToArray(variant.attributes));
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleDelete = async () => {
    const confirmed = window.confirm(
      `Delete "${variant.sku}"? It will be hidden from listings but the data is kept and can be restored later.`
    );
    if (!confirmed) return;

    setIsDeleting(true);
    setErrorMessage('');
    try {
      const res = await apiFetch(`/api/variants/${variant.variant_id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'inactive' }),
      });
      const result = await res.json();

      if (!res.ok) {
        setErrorMessage(result.message || 'Could not delete variant.');
        return;
      }

      onDeleted(result.variant_id);
    } catch (err) {
      setErrorMessage('Could not reach server. Check it is running.');
      console.error(err);
    } finally {
      setIsDeleting(false);
    }
  };

  const updateAttribute = (attrId, field, value) => {
    setAttributes((prev) => prev.map((a) => (a.id === attrId ? { ...a, [field]: value } : a)));
  };

  const removeAttribute = (attrId) => {
    setAttributes((prev) => prev.filter((a) => a.id !== attrId));
  };

  const addAttribute = () => {
    setAttributes((prev) => [...prev, { id: crypto.randomUUID(), key: ATTRIBUTE_PRESETS[0], value: '' }]);
  };

  const handleAttributeKeySelect = (attrId, value) => {
    updateAttribute(attrId, 'key', value === 'Custom' ? '' : value);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!sku.trim()) {
      setErrorMessage('SKU is required.');
      return;
    }

    const attributesObject = {};
    attributes.forEach((a) => {
      if (a.key) attributesObject[a.key] = a.value;
    });

    setIsSaving(true);
    setErrorMessage('');
    try {
      const res = await apiFetch(`/api/variants/${variant.variant_id}`, {
        method: 'PUT',
        body: JSON.stringify({
          sku: sku.trim(),
          price: price || null,
          remarks: remarks.trim() || null,
          color: variant.color || null,
          attributes: attributesObject,
        }),
      });
      const result = await res.json();

      if (!res.ok) {
        setErrorMessage(result.message || 'Could not save changes.');
        return;
      }

      onSaved(result);
    } catch (err) {
      setErrorMessage('Could not reach server. Check it is running.');
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="evm-overlay" onClick={onClose}>
      <div className="evm-panel" onClick={(e) => e.stopPropagation()}>
        <div className="evm-header">
          <div>
            <h3>Edit Variant</h3>
            <p className="evm-subtitle">{product.product_name}</p>
          </div>
          <button type="button" className="evm-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form className="evm-body" onSubmit={handleSave}>
          <div className="evm-card">
            <div className="evm-section-header">
              <span className="evm-section-title">Attributes</span>
              <button type="button" className="evm-add-attribute" onClick={addAttribute}>
                + Add Attribute
              </button>
            </div>

            <div className="evm-attributes-block">
              {attributes.length === 0 ? (
                <p className="evm-empty-attrs">No attributes yet — add one above.</p>
              ) : (
                attributes.map((attr) => {
                  const isCustom = !ATTRIBUTE_PRESETS.includes(attr.key);
                  return (
                    <div key={attr.id} className="evm-attribute-row">
                      <select
                        className="evm-attribute-key-select"
                        value={isCustom ? 'Custom' : attr.key}
                        onChange={(e) => handleAttributeKeySelect(attr.id, e.target.value)}
                      >
                        {ATTRIBUTE_PRESETS.map((preset) => (
                          <option key={preset} value={preset}>{preset}</option>
                        ))}
                        <option value="Custom">Custom</option>
                      </select>
                      {isCustom && (
                        <input
                          type="text"
                          placeholder="Attribute name"
                          value={attr.key}
                          onChange={(e) => updateAttribute(attr.id, 'key', e.target.value)}
                        />
                      )}
                      <input
                        type="text"
                        placeholder="e.g. Standard"
                        value={attr.value}
                        onChange={(e) => updateAttribute(attr.id, 'value', e.target.value)}
                      />
                      <button
                        type="button"
                        className="evm-icon-remove"
                        onClick={() => removeAttribute(attr.id)}
                        aria-label="Remove attribute"
                      >
                        &times;
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="evm-fields-row">
            <div className="evm-field">
              <label>Price (RM)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="evm-field">
              <label>SKU <span className="evm-required">*</span></label>
              <input type="text" value={sku} onChange={(e) => setSku(e.target.value)} />
            </div>
          </div>

          <div className="evm-field evm-field-wide">
            <label>Remarks</label>
            <input
              type="text"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Optional notes"
            />
          </div>

          {errorMessage && <p className="evm-error-text">{errorMessage}</p>}

          <div className="evm-actions">
            {canDelete && (
              <button
                type="button"
                className="evm-btn-danger"
                onClick={handleDelete}
                disabled={isDeleting || isSaving}
              >
                {isDeleting ? 'Deleting…' : 'Delete'}
              </button>
            )}
            <div className="evm-actions-spacer" />
            <button type="button" className="evm-btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="evm-btn-primary" disabled={isSaving || isDeleting}>
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}