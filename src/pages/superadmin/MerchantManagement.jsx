// src/pages/superadmin/MerchantManagement.jsx
import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../utils/api';
import '../../styles/superadmin/MerchantManagement.css';

// TODO: GET /api/superadmin/merchants
const MOCK_MERCHANTS = [];

const STATUSES = ['Active', 'Suspended'];

function formatTimestamp(iso) {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Postgres DATE columns arrive as UTC-midnight ISO strings (e.g.
// "2026-07-31T00:00:00.000Z"). We compare using UTC getters on both
// sides so the day count is correct regardless of the viewer's local
// timezone — using local getters here would shift the day for anyone
// west of UTC.
function getCountdownDays(expiryIso) {
  if (!expiryIso) return null;

  const expiry = new Date(expiryIso);
  const expiryUTC = Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate());

  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  return Math.round((expiryUTC - todayUTC) / 86400000);
}

function renderCountdown(expiryIso) {
  const days = getCountdownDays(expiryIso);

  if (days === null) {
    return <span className="countdown-badge countdown-badge-none">—</span>;
  }
  if (days > 0) {
    const soon = days <= 7;
    return (
      <span className={`countdown-badge ${soon ? 'countdown-badge-warning' : 'countdown-badge-active'}`}>
        {days} day{days === 1 ? '' : 's'} left
      </span>
    );
  }
  if (days === 0) {
    return <span className="countdown-badge countdown-badge-warning">Expires today</span>;
  }
  return (
    <span className="countdown-badge countdown-badge-expired">
      Expired {Math.abs(days)} day{Math.abs(days) === 1 ? '' : 's'} ago
    </span>
  );
}


function makeEmptyMerchantForm() {
  return { business_name: '', email: '', phone: '', password: '', expiry_date: '' };
}

export default function MerchantManagement() {
  const [merchants, setMerchants] = useState(MOCK_MERCHANTS);
  const [merchantForm, setMerchantForm] = useState(makeEmptyMerchantForm());
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    apiFetch('/api/superadmin/merchants')
      .then((res) => res.json())
      .then((data) => setMerchants(data))
      .catch((err) => console.error('Failed to load merchants:', err));
  }, []);

  const filteredMerchants = merchants.filter((m) => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return true;
    return (
      m.business_name.toLowerCase().includes(term) ||
      m.email.toLowerCase().includes(term)
    );
  });

  // --- Form handlers -------------------------------------------------------

  const handleFieldChange = (e) => {
    const { name, value } = e.target;
    setMerchantForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleCreateMerchant = async (e) => {
    e.preventDefault();

    if (!merchantForm.business_name.trim() || !merchantForm.email.trim()) {
      alert('Business name and email are required.');
      return;
    }

    try {
      const res = await apiFetch('/api/superadmin/merchants', {
        method: 'POST',
        body: JSON.stringify({
          business_name: merchantForm.business_name.trim(),
          email: merchantForm.email.trim(),
          phone: merchantForm.phone.trim(),
          password: merchantForm.password,
          expiry_date: merchantForm.expiry_date || null,
        }),
      });
      const result = await res.json();

      if (!res.ok) {
        alert(result.message || 'Could not create merchant.');
        return;
      }

      setMerchants((prev) => [result, ...prev]);
      setMerchantForm(makeEmptyMerchantForm());
    } catch (err) {
      alert('Could not reach server. Check it is running.');
      console.error(err);
    }
  };

  // --- Status handlers -------------------------------------------------------

  const toggleMerchantStatus = async (merchantId) => {
    const merchant = merchants.find((m) => m.merchant_id === merchantId);
    const nextStatus = merchant.status === 'Active' ? 'Suspended' : 'Active';

    try {
      const res = await apiFetch(`/api/superadmin/merchants/${merchantId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        alert('Could not update status.');
        return;
      }
      setMerchants((prev) =>
        prev.map((m) => (m.merchant_id === merchantId ? { ...m, status: nextStatus } : m))
      );
    } catch (err) {
      alert('Could not reach server. Check it is running.');
      console.error(err);
    }
    // NOTE: Suspending a merchant here only changes this status field — it
    // does NOT currently block their login or API access. That check would
    // need to live inside auth.js's /login route (reject if merchant status
    // is 'Suspended') to actually mean something security-wise.
  };

const removeMerchant = async (merchantId) => {
  if (!window.confirm('Remove this merchant? This will also remove their login accounts.')) return;

  try {
    const res = await apiFetch(`/api/superadmin/merchants/${merchantId}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      const result = await res.json().catch(() => ({}));
      alert(result.message || 'Could not remove merchant.');
      return;
    }

    setMerchants((prev) => prev.filter((m) => m.merchant_id !== merchantId));
  } catch (err) {
    alert('Could not reach server. Check it is running.');
    console.error(err);
  }
};
    // NOTE: your users table's merchant_id column has no ON DELETE CASCADE,
    // so deleting a merchant here will leave that merchant's staff accounts
    // orphaned with a merchant_id pointing at nothing — same class of bug
    // as the earlier "stale merchant_id" issue. Worth adding CASCADE or
    // handling it explicitly before relying on this in real use.
  return (
    <div className="merchant-management">
      <section className="merchant-form-section">
        <h2>Add Merchant</h2>
        <form className="merchant-form" onSubmit={handleCreateMerchant}>
          <div className="form-group">
            <label htmlFor="business_name">Business Name</label>
            <input
              id="business_name"
              name="business_name"
              type="text"
              value={merchantForm.business_name}
              onChange={handleFieldChange}
              placeholder="e.g. Kedai Ali Sdn Bhd"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              value={merchantForm.email}
              onChange={handleFieldChange}
              placeholder="owner@example.com"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="phone">Phone</label>
            <input
              id="phone"
              name="phone"
              type="text"
              value={merchantForm.phone}
              onChange={handleFieldChange}
              placeholder="Optional"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              value={merchantForm.password}
              onChange={handleFieldChange}
              placeholder="Set login password for this merchant"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="expiry_date">Account Expiry Date</label>
            <input
              id="expiry_date"
              name="expiry_date"
              type="date"
              value={merchantForm.expiry_date}
              onChange={handleFieldChange}
              min={new Date().toISOString().split('T')[0]}
            />
          </div>

          <button type="submit" className="btn-primary">Add Merchant</button>
        </form>
      </section>

      <section className="merchant-list-section">
        <div className="merchant-list-header">
          <h2>Merchants ({filteredMerchants.length})</h2>
          <input
            type="text"
            className="search-input"
            placeholder="Search by name or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {filteredMerchants.length === 0 ? (
          <p className="empty-state">No merchants match your search.</p>
        ) : (
          <table className="merchants-table">
            <thead>
              <tr>
                <th>Business Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Expiry Date</th>
                <th>Countdown</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredMerchants.map((merchant) => (
                <tr key={merchant.merchant_id}>
                  <td>{merchant.business_name}</td>
                  <td>{merchant.email}</td>
                  <td>{merchant.phone || '—'}</td>
                  <td>
                    <span className={`status-badge status-badge-${merchant.status.toLowerCase()}`}>
                      {merchant.status}
                    </span>
                  </td>
                  <td>{formatDate(merchant.expiry_date)}</td>
                  <td>{renderCountdown(merchant.expiry_date)}</td>
                  <td>{formatTimestamp(merchant.created_at)}</td>
                  <td className="actions-cell">
                    <button
                      className="btn-secondary"
                      onClick={() => toggleMerchantStatus(merchant.merchant_id)}
                    >
                      {merchant.status === 'Active' ? 'Suspend' : 'Reactivate'}
                    </button>
                    <button
                      className="btn-remove-small"
                      onClick={() => removeMerchant(merchant.merchant_id)}
                    >
                      Remove
                    </button>
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