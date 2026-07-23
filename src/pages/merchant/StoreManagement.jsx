// src/pages/StoreManagement.jsx
import React, { useState, useMemo, useEffect } from 'react';
import { apiFetch } from '../../utils/api';
import '../../styles/StoreManagement.css';

const STATUS_OPTIONS = ['Active', 'Inactive'];

// Client-side placeholder — once the backend exists, this should be a
// real Postgres sequence, same reasoning as the SKU sequence issue earlier.
function generateStoreId(existingStores) {
  const nextNumber = existingStores.length + 1;
  return `STR-${String(nextNumber).padStart(4, '0')}`;
}

const emptyForm = { location: '', email: '', phone: '', status: 'Active' };

export default function StoreManagement() {
  const [stores, setStores] = useState([]);

  useEffect(() => {
    apiFetch('/api/stores')
      .then((res) => res.json())
      .then((data) => setStores(data))
      .catch((err) => console.error('Failed to load stores:', err));
  }, []);

  const [form, setForm] = useState(emptyForm);
  const [editingStoreId, setEditingStoreId] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const resetForm = () => {
    setForm(emptyForm);
    setEditingStoreId(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatusMessage('');

    if (!form.location.trim() || !form.email.trim() || !form.phone.trim()) {
      setStatusMessage('Fill in outlet location, email, and phone number.');
      return;
    }

    if (editingStoreId) {
      try {
        const res = await apiFetch(`/api/stores/${editingStoreId}`, {
          method: 'PUT',
          body: JSON.stringify(form),
        });
        const result = await res.json();

        if (!res.ok) {
          setStatusMessage(result.message || 'Could not update store.');
          return;
        }

        setStores((prev) =>
          prev.map((s) => (s.store_id === editingStoreId ? result : s))
        );
        setStatusMessage('Store updated.');
      } catch (err) {
        setStatusMessage('Could not reach server. Check it is running.');
        console.error(err);
      }
    } else {
      try {
        const res = await apiFetch('/api/stores', {
          method: 'POST',
          body: JSON.stringify(form),
        });
        const savedStore = await res.json();
        setStores((prev) => [...prev, savedStore]);
        setStatusMessage('Store added.');
      } catch (err) {
        setStatusMessage('Failed to add store.');
      }
    }

    resetForm();
  };

  const handleEdit = (store) => {
    setEditingStoreId(store.store_id);
    setForm({
      location: store.location,
      email: store.email,
      phone: store.phone,
      status: store.status,
    });
    setStatusMessage('');
  };

  const handleRemove = async (storeId) => {
    const confirmed = window.confirm('Remove this store? This cannot be undone.');
    if (!confirmed) return;

    try {
      const res = await apiFetch(`/api/stores/${storeId}`, { method: 'DELETE' });
      if (!res.ok) {
        const result = await res.json();
        setStatusMessage(result.message || 'Could not remove store.');
        return;
      }
      setStores((prev) => prev.filter((s) => s.store_id !== storeId));
      if (editingStoreId === storeId) resetForm();
    } catch (err) {
      setStatusMessage('Could not reach server. Check it is running.');
      console.error(err);
    }
  };

  const filteredStores = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return stores;

    return stores.filter((s) =>
      [s.store_id, s.location, s.email, s.phone].some((field) =>
        field.toLowerCase().includes(term)
      )
    );
  }, [stores, searchTerm]);

  return (
    <div className="store-management">
      <section className="store-form-section">
        <h2>{editingStoreId ? 'Edit Store' : 'Add New Store'}</h2>

        <form className="store-form" onSubmit={handleSubmit}>
          <div className="form-group form-group-wide">
            <label htmlFor="location">Location / Outlet</label>
            <input
              id="location"
              name="location"
              type="text"
              value={form.location}
              onChange={handleChange}
              placeholder="e.g. Branch C - Johor Bahru"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input
              id="email"
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              placeholder="store@maxxtech.com"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="phone">Phone Number</label>
            <input
              id="phone"
              name="phone"
              type="tel"
              value={form.phone}
              onChange={handleChange}
              placeholder="03-1234 5678"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="status">Status</label>
            <select id="status" name="status" value={form.status} onChange={handleChange}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn-primary">
              {editingStoreId ? 'Update Store' : 'Add Store'}
            </button>
            {editingStoreId && (
              <button type="button" className="btn-secondary" onClick={resetForm}>
                Cancel
              </button>
            )}
          </div>
        </form>

        {statusMessage && <p className="status-text">{statusMessage}</p>}
      </section>

      <section className="store-list-section">
        <div className="store-list-header">
          <h2>All Stores ({filteredStores.length})</h2>
          <input
            type="text"
            className="search-input"
            placeholder="Search by ID, location, email, or phone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {filteredStores.length === 0 ? (
          <p className="empty-state">No stores match your search.</p>
        ) : (
          <table className="stores-table">
            <thead>
              <tr>
                <th>No.</th>
                <th>Store ID</th>
                <th>Location / Outlet</th>
                <th>Email</th>
                <th>Phone Number</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredStores.map((store, index) => (
                <tr key={store.store_id}>
                  <td>{index + 1}</td>
                  <td>{store.store_id}</td>
                  <td>{store.location}</td>
                  <td>{store.email}</td>
                  <td>{store.phone}</td>
                  <td>
                    <span
                      className={`status-badge ${
                        store.status === 'Active' ? 'status-active' : 'status-inactive'
                      }`}
                    >
                      {store.status}
                    </span>
                  </td>
                  <td className="actions-cell">
                    <button className="btn-link" onClick={() => handleEdit(store)}>Edit</button>
    <button className="btn-link btn-link-danger" onClick={() => handleRemove(store.store_id)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}