// src/pages/UserManagement.jsx
import React, { useState, useRef, useEffect } from 'react';
import { apiFetch } from '../../utils/api';
import '../../styles/UserManagement.css';

// TODO: GET /api/users
const MOCK_USERS = [];

const ROLES = ['Admin', 'Staff'];

// Every page/module in the app that access can be granted to.
// Keep this list in sync with your actual routes/nav.
const MODULES = [
  'Store Management',
  'Asset Registry',
  'Product Listing',
  'Stock Adjustment',
  'User Management',
];

function makeEmptyAccountForm() {
  return { name: '', email: '', password: '', role: 'Staff', modules: [] };
}

export default function UserManagement() {
  const [users, setUsers] = useState(MOCK_USERS);
  const [accountForm, setAccountForm] = useState(makeEmptyAccountForm());

  // New staff accounts are created under whichever merchant is currently logged in
  const storedUser = localStorage.getItem('authUser');
  const currentMerchant = storedUser ? JSON.parse(storedUser) : null;

  useEffect(() => {
    apiFetch('/api/users')
      .then((res) => res.json())
      .then((data) => setUsers(data))
      .catch((err) => console.error('Failed to load users:', err));
  }, []);

  // --- Module checkboxes for the account being created --------------------

  const toggleModuleForForm = (moduleName) => {
    setAccountForm((prev) => {
      const current = prev.modules;
      const next = current.includes(moduleName)
        ? current.filter((m) => m !== moduleName)
        : [...current, moduleName];
      return { ...prev, modules: next };
    });
  };

  // --- Account form handlers -----------------------------------------------

  const handleAccountFieldChange = (e) => {
    const { name, value } = e.target;
    setAccountForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleAccountSubmit = async (e) => {
    e.preventDefault();

    if (!accountForm.name.trim() || !accountForm.email.trim() || !accountForm.password) {
      alert('Name, email, and password are required.');
      return;
    }

    try {
      const res = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: accountForm.name.trim(),
          email: accountForm.email.trim(),
          password: accountForm.password,
          role: accountForm.role.toLowerCase(),
          merchant_id: currentMerchant?.merchant_id || null,
          modules: accountForm.modules,
        }),
      });
      const result = await res.json();

      if (!res.ok) {
        alert(result.message || 'Could not create account.');
        return;
      }

      setUsers((prev) => [result, ...prev]);
      setAccountForm(makeEmptyAccountForm());
    } catch (err) {
      alert('Could not reach server. Check it is running.');
      console.error(err);
    }
  };

  const removeUser = async (userId) => {
    try {
      const res = await apiFetch(`/api/users/${userId}`, { method: 'DELETE' });
      if (!res.ok) {
        alert('Could not remove account.');
        return;
      }
      setUsers((prev) => prev.filter((u) => u.user_id !== userId));
    } catch (err) {
      alert('Could not reach server. Check it is running.');
      console.error(err);
    }
  };

  return (
    <div className="user-management">
      <section className="account-form-section">
        <h2>Add Account</h2>
        <form className="account-form" onSubmit={handleAccountSubmit}>
          <div className="form-group">
            <label htmlFor="name">Name</label>
            <input
              id="name"
              name="name"
              type="text"
              value={accountForm.name}
              onChange={handleAccountFieldChange}
              placeholder="e.g. Jane Tan"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              value={accountForm.email}
              onChange={handleAccountFieldChange}
              placeholder="jane@example.com"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="role">Role</label>
            <select
              id="role"
              name="role"
              value={accountForm.role}
              onChange={handleAccountFieldChange}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              value={accountForm.password}
              onChange={handleAccountFieldChange}
              placeholder="Set a password for this account"
              required
            />
          </div>

          <div className="form-group form-group-wide module-checkbox-block">
            <label>Module Access</label>
            {MODULES.map((moduleName) => (
              <label key={moduleName} className="module-checkbox-row">
                <input
                  type="checkbox"
                  checked={accountForm.modules.includes(moduleName)}
                  onChange={() => toggleModuleForForm(moduleName)}
                />
                {moduleName}
              </label>
            ))}
          </div>

          <button type="submit" className="btn-primary">Add Account</button>
        </form>
      </section>

      <section className="accounts-list-section">
        <h2>Accounts ({users.length})</h2>

        {users.length === 0 ? (
          <p className="empty-state">No accounts created yet.</p>
        ) : (
          <table className="accounts-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Module Access</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.user_id}>
                  <td>{user.name}</td>
                  <td>{user.email}</td>
                  <td>
                    <span className={`role-badge role-badge-${user.role.toLowerCase()}`}>
                      {user.role}
                    </span>
                  </td>
                  <td>{(user.modules || []).join(', ') || '—'}</td>
                  <td>
                    <button className="btn-remove-small" onClick={() => removeUser(user.user_id)}>
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
