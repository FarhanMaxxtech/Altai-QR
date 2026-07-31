// src/pages/merchant/UserManagement.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { apiFetch } from '../../utils/api';
import { MODULE_DEFS, ACTIONS, PRESETS, buildPresetPermissions } from '../../utils/permissionPresets';
import '../../styles/UserManagement.css';

const PAGE_SIZE = 10;
const ROLE_OPTIONS = ['Admin', 'Staff']; // account-level role for invites; super_admin is platform-level only

function initialsOf(name) {
  if (!name) return '—';
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function formatRelativeTime(iso) {
  if (!iso) return 'Never';
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return 'Now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return 'Yesterday';
  return `${diffDay}d ago`;
}

function isAdminAccountOf(user) {
  return user?.role === 'admin' || user?.role === 'super_admin';
}

function accessLabel(user) {
  if (isAdminAccountOf(user)) return 'All stores';
  const count = (user.store_ids || []).length;
  return `${count} store${count === 1 ? '' : 's'}`;
}

function roleBadgeLabel(user) {
  if (user.role === 'admin') return 'Admin';
  if (user.role === 'super_admin') return 'Super Admin';
  return user.permission_preset || 'Viewer';
}

function makeEmptyInviteForm() {
  return { name: '', email: '', password: '', role: 'Staff' };
}

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [stores, setStores] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [page, setPage] = useState(1);

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState(makeEmptyInviteForm());
  const [inviteError, setInviteError] = useState('');

  const storedUser = localStorage.getItem('authUser');
  const currentMerchant = storedUser ? JSON.parse(storedUser) : null;

  const loadUsers = () => {
    apiFetch('/api/users')
      .then((res) => res.json())
      .then((data) => {
        setUsers(data);
        setSelectedUserId((prev) => prev || data[0]?.user_id || null);
      })
      .catch((err) => console.error('Failed to load users:', err));
  };

  useEffect(() => {
    loadUsers();
    apiFetch('/api/stores')
      .then((res) => res.json())
      .then((data) => setStores(data))
      .catch((err) => console.error('Failed to load stores:', err));
  }, []);

  const totalPages = Math.max(1, Math.ceil(users.length / PAGE_SIZE));
  const pagedUsers = users.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selectedUser = users.find((u) => u.user_id === selectedUserId) || null;
  const adminAccount = isAdminAccountOf(selectedUser);

  // --- Invite user -----------------------------------------------------------

  const handleInviteFieldChange = (e) => {
    const { name, value } = e.target;
    setInviteForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleInviteSubmit = async (e) => {
    e.preventDefault();
    setInviteError('');

    if (!inviteForm.name.trim() || !inviteForm.email.trim() || !inviteForm.password) {
      setInviteError('Name, email, and password are required.');
      return;
    }

    try {
      const res = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: inviteForm.name.trim(),
          email: inviteForm.email.trim(),
          password: inviteForm.password,
          role: inviteForm.role.toLowerCase(),
          merchant_id: currentMerchant?.merchant_id || null,
          modules: [],
        }),
      });
      const result = await res.json();

      if (!res.ok) {
        setInviteError(result.message || 'Could not create account.');
        return;
      }

      setIsInviteOpen(false);
      setInviteForm(makeEmptyInviteForm());
      loadUsers();
      setSelectedUserId(result.user_id);
    } catch (err) {
      setInviteError('Could not reach server. Check it is running.');
      console.error(err);
    }
  };

  const removeUser = async (userId) => {
    if (!window.confirm('Remove this account?')) return;
    try {
      const res = await apiFetch(`/api/users/${userId}`, { method: 'DELETE' });
      if (!res.ok) {
        alert('Could not remove account.');
        return;
      }
      setUsers((prev) => prev.filter((u) => u.user_id !== userId));
      if (selectedUserId === userId) setSelectedUserId(null);
    } catch (err) {
      alert('Could not reach server. Check it is running.');
      console.error(err);
    }
  };

  // --- Preset / permission editing --------------------------------------------
const [draft, setDraft] = useState(null); // { userId, permissions, store_ids, preset } | null

useEffect(() => {
  if (!selectedUser) { setDraft(null); return; }
  setDraft({
    userId: selectedUser.user_id,
    permissions: selectedUser.permissions || {},
    store_ids: selectedUser.store_ids || [],
    preset: selectedUser.permission_preset || null,
  });
}, [selectedUser?.user_id]); // eslint-disable-line react-hooks/exhaustive-deps

const isDirty = draft && selectedUser && (
  JSON.stringify(draft.permissions) !== JSON.stringify(selectedUser.permissions || {}) ||
  JSON.stringify([...draft.store_ids].sort()) !== JSON.stringify([...(selectedUser.store_ids || [])].sort()) ||
  draft.preset !== (selectedUser.permission_preset || null)
);



const applyPreset = (preset) => {
  if (!draft || adminAccount) return;
  setDraft((d) => ({ ...d, preset, permissions: buildPresetPermissions(preset) }));
};

const toggleCell = (moduleName, action) => {
  if (!draft || adminAccount) return;
  const current = new Set(draft.permissions[moduleName] || []);
  current.has(action) ? current.delete(action) : current.add(action);
  setDraft((d) => ({
    ...d,
    preset: null, // hand-edited, no longer matches a clean preset
    permissions: { ...d.permissions, [moduleName]: Array.from(current) },
  }));
};

const toggleStore = (storeId) => {
  if (!draft || adminAccount) return;
  const has = draft.store_ids.includes(storeId);
  setDraft((d) => ({
    ...d,
    store_ids: has ? d.store_ids.filter((id) => id !== storeId) : [...d.store_ids, storeId],
  }));
};

const allStoresSelected = stores.length > 0 && (draft?.store_ids || []).length === stores.length;

const toggleAllStores = () => {
  if (!draft || adminAccount) return;
  setDraft((d) => ({ ...d, store_ids: allStoresSelected ? [] : stores.map((s) => s.store_id) }));
};

const grantTotal = useMemo(() => {
  if (!draft) return 0;
  return Object.values(draft.permissions).reduce((sum, actions) => sum + actions.length, 0);
}, [draft]);

  // --- Store access ------------------------------------------------------------

const resetToPreset = () => {
  if (!selectedUser) return;
  setDraft({
    userId: selectedUser.user_id,
    permissions: selectedUser.permission_preset
      ? buildPresetPermissions(selectedUser.permission_preset)
      : (selectedUser.permissions || {}),
    store_ids: selectedUser.store_ids || [],
    preset: selectedUser.permission_preset || null,
  });
};

const [isSaving, setIsSaving] = useState(false);
const [saveMessage, setSaveMessage] = useState('');

const savePermissions = async () => {
  if (!draft || !selectedUser) return;
  setIsSaving(true);
  setSaveMessage('');
  try {
    const [permRes, storeRes] = await Promise.all([
      apiFetch(`/api/users/${draft.userId}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({ permissions: draft.permissions, permission_preset: draft.preset }),
      }),
      apiFetch(`/api/users/${draft.userId}/stores`, {
        method: 'PUT',
        body: JSON.stringify({ store_ids: draft.store_ids }),
      }),
    ]);
    if (!permRes.ok || !storeRes.ok) {
      setSaveMessage('Could not save changes.');
      return;
    }
    loadUsers();
    setSaveMessage('Saved.');
    setTimeout(() => setSaveMessage(''), 2000);
  } catch (err) {
    setSaveMessage('Could not reach server. Check it is running.');
    console.error(err);
  } finally {
    setIsSaving(false);
  }
};

  return (
    <div className="um-layout">
      {/* --- Left: user list --- */}
      <aside className="um-sidebar">
        <div className="um-sidebar-header">
          <h2>Users</h2>
          <span className="um-count-badge">{users.length}</span>
        </div>

        <div className="um-list">
          {pagedUsers.length === 0 ? (
            <p className="um-empty-list">No accounts yet.</p>
          ) : (
            pagedUsers.map((user) => (
              <button
                key={user.user_id}
                type="button"
                className={`um-user-card ${user.user_id === selectedUserId ? 'um-user-card-active' : ''}`}
                onClick={() => setSelectedUserId(user.user_id)}
              >
                <span className="um-avatar">{initialsOf(user.name)}</span>
                <span className="um-user-meta">
                  <span className="um-user-name">{user.name}</span>
                  <span className="um-user-sub">{roleBadgeLabel(user)} · {accessLabel(user)}</span>
                </span>
              </button>
            ))
          )}
        </div>

        {totalPages > 1 && (
          <div className="um-pagination">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>‹</button>
            <span>Page {page} of {totalPages}</span>
            <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>›</button>
          </div>
        )}

        <button type="button" className="um-invite-btn" onClick={() => setIsInviteOpen(true)}>
          + Add user
        </button>
      </aside>

      {/* --- Right: detail --- */}
      <section className="um-detail">
        {!selectedUser ? (
          <div className="um-detail-empty">
            <p className="empty-state">Select a user to view their details.</p>
          </div>
        ) : (
          <>
            <div className="um-profile-card">
              <span className="um-profile-avatar">{initialsOf(selectedUser.name)}</span>
              <div className="um-profile-meta">
                <span className="um-profile-name">{selectedUser.name}</span>
                <span className="um-profile-sub">
                  {selectedUser.email} · last seen {formatRelativeTime(selectedUser.last_seen)}
                </span>
              </div>

              {!adminAccount && (
                <div className="um-preset-block">
                  <span className="um-preset-label">Role Preset</span>
                  <div className="um-preset-tabs">
                    {PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        className={`um-preset-tab ${draft?.preset === preset ? 'um-preset-tab-active' : ''}`}
                        onClick={() => applyPreset(preset)}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="um-card">
              <div className="um-card-header">
                <h3>Warehouse & store access</h3>
                <span className="um-count-badge">{(draft?.store_ids || []).length} OF {stores.length}</span>
                <div className="um-spacer" />
                <button type="button" className="um-secondary-btn" onClick={toggleAllStores} disabled={adminAccount}>
                  {allStoresSelected ? 'Clear all' : 'Select all'}
                </button>
              </div>

              <div className="um-store-grid">
                {stores.map((store) => {
                  const isChecked = adminAccount || (draft?.store_ids || []).includes(store.store_id);
                  return (
                    <button
                      key={store.store_id}
                      type="button"
                      className={`um-store-toggle ${isChecked ? 'um-store-toggle-active' : ''}`}
                      onClick={() => toggleStore(store.store_id)}
                      disabled={adminAccount}
                    >
                      <span className="um-store-check">{isChecked ? '✓' : ''}</span>
                      <span className="um-store-meta">
                        <span className="um-store-name">{store.location}</span>
                        <span className="um-store-code">{store.store_code}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="um-card">
              <div className="um-card-header">
                <h3>Modules & functions</h3>
                <span className="um-count-badge">
                  {adminAccount ? MODULE_DEFS.length * ACTIONS.length : grantTotal} GRANTS
                </span>
                <div className="um-spacer" />
                <span className="um-hint">Click a cell to grant or revoke</span>
              </div>

              <div className="um-permission-table-wrapper">
                <table className="um-permission-table">
                  <thead>
                    <tr>
                      <th className="um-col-module">Module</th>
                      <th className="um-col-functions">Functions</th>
                      {ACTIONS.map((action) => (
                        <th key={action} className="um-col-action">
                          {action.charAt(0).toUpperCase() + action.slice(1)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {MODULE_DEFS.map((mod) => {
                      const grantedActions = adminAccount ? ACTIONS : (draft?.permissions?.[mod.key] || []);
                      return (
                        <tr key={mod.key}>
                          <td className="um-col-module">
                            <span className={`um-module-dot ${grantedActions.length > 0 ? 'um-module-dot-active' : ''}`} />
                            {mod.key}
                          </td>
                          <td className="um-col-functions">
                            {mod.functions.map((fn) => (
                              <span key={fn} className="um-function-chip">{fn}</span>
                            ))}
                          </td>
                          {ACTIONS.map((action) => {
                            const isGranted = grantedActions.includes(action);
                            return (
                              <td key={action} className="um-col-action">
                                <button
                                  type="button"
                                  className={`um-cell-btn ${isGranted ? 'um-cell-btn-active' : ''}`}
                                  onClick={() => toggleCell(mod.key, action)}
                                  disabled={adminAccount}
                                >
                                  {isGranted ? '✓' : ''}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="um-card-footer">
                  <span className="um-footer-hint">
                    {adminAccount
                      ? 'Admin accounts always have full access.'
                      : `${grantTotal} permission${grantTotal === 1 ? '' : 's'} across ${MODULE_DEFS.length} modules · ${(draft?.store_ids || []).length} store${(draft?.store_ids || []).length === 1 ? '' : 's'}`}
                  </span>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button type="button" className="um-secondary-btn" onClick={resetToPreset} disabled={adminAccount || !isDirty}>
                      Reset to preset
                    </button>
                    <button type="button" className="um-primary-btn" onClick={savePermissions} disabled={adminAccount || !isDirty || isSaving}>
                      {isSaving ? 'Saving…' : 'Save permissions'}
                    </button>
                  </div>
                </div>
                {saveMessage && <p className="um-status-text">{saveMessage}</p>}
            </div>
          </>
        )}
      </section>

      {/* --- Invite user modal --- */}
      {isInviteOpen && (
        <div className="um-modal-overlay" onClick={() => setIsInviteOpen(false)}>
          <div className="um-modal-panel" onClick={(e) => e.stopPropagation()}>
            <h3>Invite User</h3>
            <form onSubmit={handleInviteSubmit} className="um-invite-form">
              <div className="um-field">
                <label>Name</label>
                <input name="name" type="text" value={inviteForm.name} onChange={handleInviteFieldChange} placeholder="e.g. Jane Tan" required />
              </div>
              <div className="um-field">
                <label>Email</label>
                <input name="email" type="email" value={inviteForm.email} onChange={handleInviteFieldChange} placeholder="jane@example.com" required />
              </div>
              <div className="um-field">
                <label>Role</label>
                <select name="role" value={inviteForm.role} onChange={handleInviteFieldChange}>
                  {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="um-field">
                <label>Password</label>
                <input name="password" type="password" value={inviteForm.password} onChange={handleInviteFieldChange} placeholder="Set a password" required />
              </div>

              {inviteError && <p className="error-text">{inviteError}</p>}

              <div className="um-modal-actions">
                <button type="button" className="um-secondary-btn" onClick={() => setIsInviteOpen(false)}>Cancel</button>
                <button type="submit" className="um-primary-btn">Send Invite</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}