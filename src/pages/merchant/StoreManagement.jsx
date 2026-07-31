// src/pages/StoreManagement.jsx
import React, { useState, useMemo, useEffect } from 'react';
import { Store, Pencil, Trash2 } from 'lucide-react';
import { apiFetch } from '../../utils/api';
import '../../styles/StoreManagement.css';

const TYPE_OPTIONS = ['Flagship', 'Retail', 'Warehouse', 'Pop-up'];
const STATUS_OPTIONS = ['Active', 'Inactive'];

const storedUser = localStorage.getItem('authUser');
const currentUser = storedUser ? JSON.parse(storedUser) : null;
const isFullAccess = currentUser?.role === 'admin' || currentUser?.role === 'super_admin';
const canEditStores = isFullAccess || (currentUser?.permissions?.['Store Management'] || []).includes('edit');
const canCreateStores = isFullAccess || (currentUser?.permissions?.['Store Management'] || []).includes('create');

function emptyForm() {
  return {
    location: '',
    store_code: '',
    type: 'Retail',
    status: 'Active',
    manager_name: '',
    phone: '',
    address: '',
    opening_hours: '10:00 - 22:00',
  };
}

function statusBadgeClass(status) {
  if (status === 'Active') return 'sm2-badge sm2-badge-active';
  return 'sm2-badge sm2-badge-inactive';
}

export default function StoreManagement() {
  const [stores, setStores] = useState([]);
  const [balanceRows, setBalanceRows] = useState([]);
  const [totalVariants, setTotalVariants] = useState(0);

  const [selectedStoreId, setSelectedStoreId] = useState(null);
  const [mode, setMode] = useState('view'); // 'view' | 'edit' | 'create'
  const [form, setForm] = useState(emptyForm());
  const [statusMessage, setStatusMessage] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const loadStores = () => {
    apiFetch('/api/stores')
      .then((res) => res.json())
      .then((data) => {
        setStores(data);
        if (data.length > 0 && !selectedStoreId) {
          setSelectedStoreId(data[0].store_id);
        } else if (data.length === 0) {
          setMode('create');
          setForm(emptyForm());
        }
      })
      .catch((err) => console.error('Failed to load stores:', err));
  };

  useEffect(() => {
    loadStores();
    apiFetch('/api/stock-balance')
      .then((res) => res.json())
      .then((data) => setBalanceRows(data))
      .catch((err) => console.error('Failed to load stock balance:', err));
    apiFetch('/api/products')
      .then((res) => res.json())
      .then((data) => setTotalVariants(data.reduce((sum, p) => sum + (p.variants?.length || 0), 0)))
      .catch((err) => console.error('Failed to load products:', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedStore = stores.find((s) => s.store_id === selectedStoreId) || null;

  const unitsByStore = useMemo(() => {
    const map = {};
    balanceRows.forEach((row) => {
      map[row.store_id] = map[row.store_id] || { units: 0, skus: new Set() };
      map[row.store_id].units += Number(row.qty) || 0;
      if (Number(row.qty) > 0) map[row.store_id].skus.add(row.variant_id);
    });
    return map;
  }, [balanceRows]);

  const selectedStats = selectedStoreId
    ? {
        units: unitsByStore[selectedStoreId]?.units || 0,
        skus: unitsByStore[selectedStoreId]?.skus.size || 0,
      }
    : { units: 0, skus: 0 };

  // --- Selection / navigation --------------------------------------------

  const handleSelectStore = (store) => {
    setSelectedStoreId(store.store_id);
    setMode('view');
    setStatusMessage('');
  };

  const handleNewStore = () => {
    if (!canCreateStores) return;
    setSelectedStoreId(null);
    setMode('create');
    setForm(emptyForm());
    setStatusMessage('');
  };

  const handleEditStore = () => {
    if (!selectedStore || !canEditStores) return;
    setForm({
      location: selectedStore.location || '',
      store_code: selectedStore.store_code || '',
      type: selectedStore.type || 'Retail',
      status: selectedStore.status || 'Active',
      manager_name: selectedStore.manager_name || '',
      phone: selectedStore.phone || '',
      address: selectedStore.address || '',
      opening_hours: selectedStore.opening_hours || '',
    });
    setMode('edit');
    setStatusMessage('');
  };

  const handleDeleteStore = async () => {
    if (!selectedStore) return;
    const confirmed = window.confirm(
      `Close "${selectedStore.location}"? It will be marked Inactive but its data is kept, and it can be reopened later.`
    );
    if (!confirmed) return;

    setIsDeleting(true);
    setStatusMessage('');
    try {
      const res = await apiFetch(`/api/stores/${selectedStore.store_id}`, { method: 'DELETE' });
      const result = await res.json();

      if (!res.ok) {
        setStatusMessage(result.message || 'Could not close store.');
        return;
      }

      setStores((prev) => prev.map((s) => (s.store_id === result.store_id ? result : s)));
      setStatusMessage('Store marked Inactive.');
    } catch (err) {
      setStatusMessage('Could not reach server. Check it is running.');
      console.error(err);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleFieldChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const isValid = form.location.trim() && form.store_code.trim() && form.manager_name.trim();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isValid) return;

    if (mode === 'create') {
      try {
        const res = await apiFetch('/api/stores', {
          method: 'POST',
          body: JSON.stringify(form),
        });
        const result = await res.json();
        if (!res.ok) {
          setStatusMessage(result.message || 'Could not create store.');
          return;
        }
        setStores((prev) => [...prev, result]);
        setSelectedStoreId(result.store_id);
        setMode('view');
        setStatusMessage('Store created.');
      } catch (err) {
        setStatusMessage('Could not reach server. Check it is running.');
        console.error(err);
      }
    } else if (mode === 'edit' && selectedStore) {
      try {
        const res = await apiFetch(`/api/stores/${selectedStore.store_id}`, {
          method: 'PUT',
          body: JSON.stringify(form),
        });
        const result = await res.json();
        if (!res.ok) {
          setStatusMessage(result.message || 'Could not update store.');
          return;
        }
        setStores((prev) => prev.map((s) => (s.store_id === result.store_id ? result : s)));
        setMode('view');
        setStatusMessage('Store updated.');
      } catch (err) {
        setStatusMessage('Could not reach server. Check it is running.');
        console.error(err);
      }
    }
  };

  const showHeader = mode === 'create' || selectedStore;
  const showStats = mode !== 'create' && selectedStore;
  const readOnly = mode === 'view';

  return (
    <div className="sm2-layout">
      {/* --- Left: locations list --- */}
      <aside className="sm2-sidebar">
        <div className="sm2-sidebar-header">
          <h2>Locations</h2>
          <span className="sm2-count-badge">{stores.length}</span>
        </div>

        <div className="sm2-list">
          {stores.length === 0 ? (
            <p className="sm2-empty-list">No stores yet.</p>
          ) : (
            stores.map((store) => {
              const stats = unitsByStore[store.store_id];
              const isActive = store.store_id === selectedStoreId && mode !== 'create';
              return (
                <button
                  key={store.store_id}
                  type="button"
                  className={`sm2-store-card ${isActive ? 'sm2-store-card-active' : ''}`}
                  onClick={() => handleSelectStore(store)}
                >
                  <div className="sm2-store-card-top">
                    <span className="sm2-store-card-name">{store.location}</span>
                    <span className={statusBadgeClass(store.status)}>{store.status}</span>
                  </div>
                  <div className="sm2-store-card-bottom">
                    <span className="sm2-store-card-meta">
                      {store.store_code}
                      {store.type ? ` · ${store.type}` : ''}
                    </span>
                    <span className="sm2-store-card-units">{stats?.units || 0} units</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {canCreateStores && (
            <button type="button" className="sm2-add-store-btn" onClick={handleNewStore}>
              + New store
            </button>
          )}
      </aside>

      {/* --- Right: details --- */}
      <section className="sm2-detail">
        {showHeader && (
          <div className="sm2-detail-header">
            <div className="sm2-detail-icon">
              <Store size={20} />
            </div>
            <div className="sm2-detail-heading">
              <h2>{mode === 'create' ? 'New store' : selectedStore.location}</h2>
              <p>
                {mode === 'create'
                  ? 'Fill in the details to add a location'
                  : `${selectedStore.store_code || '—'} · ${selectedStore.type || '—'} · ${selectedStore.manager_name || '—'}`}
              </p>
            </div>
            {mode !== 'create' && canEditStores && (
              <>
                <button
                  type="button"
                  className="sm2-delete-btn"
                  onClick={handleDeleteStore}
                  disabled={mode === 'edit' || isDeleting || selectedStore?.status === 'Inactive'}
                >
                  <Trash2 size={14} />
                  {isDeleting ? 'Closing…' : 'Delete'}
                </button>
                <button type="button" className="sm2-edit-btn" onClick={handleEditStore} disabled={mode === 'edit'}>
                  <Pencil size={14} />
                  Edit store
                </button>
              </>
            )}
          </div>
        )}

        {showStats && (
          <div className="sm2-stats-row">
            <div className="sm2-stat-card">
              <span className="sm2-stat-label">Units on hand</span>
              <div className="sm2-stat-value-row">
                <span className="sm2-stat-value">{selectedStats.units}</span>
                <span className="sm2-stat-unit">units</span>
              </div>
            </div>
            <div className="sm2-stat-card">
              <span className="sm2-stat-label">SKUs stocked</span>
              <div className="sm2-stat-value-row">
                <span className="sm2-stat-value">{selectedStats.skus}</span>
                <span className="sm2-stat-unit">of {totalVariants}</span>
              </div>
            </div>
          </div>
        )}

        {showHeader && (
          <form className="sm2-form-card" onSubmit={handleSubmit}>
            <div className="sm2-form-card-header">
              <h3>Store details</h3>
              <span className={`sm2-mode-tag sm2-mode-tag-${mode}`}>
                {mode === 'view' ? 'Read only' : mode === 'edit' ? 'Editing' : 'New'}
              </span>
            </div>

            <div className="sm2-form-grid">
              <div className="sm2-field">
                <label>
                  Store name <span className="sm2-required">*</span>
                </label>
                <input
                  name="location"
                  type="text"
                  value={readOnly ? selectedStore.location : form.location}
                  onChange={handleFieldChange}
                  placeholder="e.g. Mont Kiara"
                  readOnly={readOnly}
                  required
                />
              </div>

              <div className="sm2-field">
                <label>
                  Store code <span className="sm2-required">*</span>
                </label>
                <input
                  name="store_code"
                  type="text"
                  className="sm2-mono-input"
                  value={readOnly ? selectedStore.store_code || '' : form.store_code}
                  onChange={handleFieldChange}
                  placeholder="MY-XX-00"
                  readOnly={readOnly}
                  required
                />
              </div>

              <div className="sm2-field">
                <label>Type</label>
                {readOnly ? (
                  <input type="text" value={selectedStore.type || '—'} readOnly />
                ) : (
                  <select name="type" value={form.type} onChange={handleFieldChange}>
                    {TYPE_OPTIONS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                )}
              </div>

              <div className="sm2-field">
                <label>Status</label>
                {readOnly ? (
                  <input type="text" value={selectedStore.status} readOnly />
                ) : (
                  <select name="status" value={form.status} onChange={handleFieldChange}>
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                )}
              </div>

              <div className="sm2-field">
                <label>
                  Manager <span className="sm2-required">*</span>
                </label>
                <input
                  name="manager_name"
                  type="text"
                  value={readOnly ? selectedStore.manager_name || '' : form.manager_name}
                  onChange={handleFieldChange}
                  placeholder="Full name"
                  readOnly={readOnly}
                  required
                />
              </div>

              <div className="sm2-field">
                <label>Phone</label>
                <input
                  name="phone"
                  type="tel"
                  className="sm2-mono-input"
                  value={readOnly ? selectedStore.phone || '' : form.phone}
                  onChange={handleFieldChange}
                  placeholder="+60 3-0000 0000"
                  readOnly={readOnly}
                />
              </div>

              <div className="sm2-field sm2-field-wide">
                <label>Address</label>
                <input
                  name="address"
                  type="text"
                  value={readOnly ? selectedStore.address || '' : form.address}
                  onChange={handleFieldChange}
                  placeholder="Street, postcode, state"
                  readOnly={readOnly}
                />
              </div>

              <div className="sm2-field">
                <label>Opening hours</label>
                <input
                  name="opening_hours"
                  type="text"
                  className="sm2-mono-input"
                  value={readOnly ? selectedStore.opening_hours || '' : form.opening_hours}
                  onChange={handleFieldChange}
                  placeholder="10:00 - 22:00"
                  readOnly={readOnly}
                />
              </div>
            </div>

            {statusMessage && <p className="sm2-status-text">{statusMessage}</p>}

            {(mode === 'edit' || mode === 'create') && (
              <div className="sm2-form-actions">
                <span className="sm2-form-hint">
                  {isValid ? 'Name, code and manager are set.' : 'Name, code and manager are required.'}
                </span>
                <div className="sm2-form-actions-buttons">
                  <button type="button" className="sm2-btn-secondary" onClick={handleDeleteStore}>
                    Cancel
                  </button>
                  <button type="submit" className="sm2-btn-primary" disabled={!isValid}>
                    {mode === 'create' ? 'Create store' : 'Save changes'}
                  </button>
                </div>
              </div>
            )}
          </form>
        )}
      </section>
    </div>
  );
}