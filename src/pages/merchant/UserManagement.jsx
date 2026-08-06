// src/pages/merchant/UserManagement.jsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  Search, Plus, Check, X, ShieldCheck, Store as StoreIcon,
  LayoutGrid, KeyRound, Clock, RotateCcw, Save, UserCircle2,
} from 'lucide-react';
import { apiFetch } from '../../utils/api';
import { MODULE_DEFS, ACTIONS, PRESETS, buildPresetPermissions } from '../../utils/permissionPresets';
import '../../styles/UserManagement.css';

const PAGE_SIZE = 10;
const ROLE_OPTIONS = ['Admin', 'Staff']; // account-level role for invites; super_admin is platform-level only

// UI-only extension: 'delete' is stored the same way as any other action
// string inside the existing permissions JSONB — no schema/API change.
const DISPLAY_ACTIONS = [...ACTIONS, 'delete'];

// UI-only grouping for readability — purely presentational, does not
// change which modules exist or how permissions are stored.
const MODULE_CATEGORIES = [
  { label: 'Core', modules: ['Dashboard', 'Product InfoCenter', 'Product Balance'] },
  { label: 'Operations', modules: ['Store Management', 'Stock Adjustment'] },
  { label: 'Reporting', modules: ['Transaction Ledger'] },
  { label: 'Administration', modules: ['User Management'] },
];

const PRESET_META = {
  Admin: 'Full access to every module and action.',
  Manager: 'Broad access; limited on store & user admin.',
  Operator: 'Day-to-day operations only.',
  Viewer: 'Read-only access across the system.',
};

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

// Soft UI-only heuristic — no "active" column exists in the users table,
// so this never gets persisted; it just informs a status dot/badge.
function isRecentlyActive(iso) {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < 1000 * 60 * 60 * 24 * 30;
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
  return { name: '', email: '', password: '', role: 'Staff', expiry_date: '' };
}

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [stores, setStores] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [page, setPage] = useState(1);

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState(makeEmptyInviteForm());
  const [inviteError, setInviteError] = useState('');

  // --- UI-only additions (search) ------------------------------------------
  const [userSearch, setUserSearch] = useState('');
  const [storeSearch, setStoreSearch] = useState('');

  const storedUser = localStorage.getItem('authUser');
  const currentMerchant = storedUser ? JSON.parse(storedUser) : null;

  const isFullAccess = currentMerchant?.role === 'admin' || currentMerchant?.role === 'super_admin';
  const canCreateUsers = isFullAccess || (currentMerchant?.permissions?.['User Management'] || []).includes('create');
  const canEditUsers = isFullAccess || (currentMerchant?.permissions?.['User Management'] || []).includes('edit');
  const canDeleteUsers = isFullAccess || (currentMerchant?.permissions?.['User Management'] || []).includes('delete');

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

  // --- Sidebar filtering + pagination --------------------------------------
  const filteredUsers = useMemo(() => {
    const term = userSearch.trim().toLowerCase();
    if (!term) return users;
    return users.filter(
      (u) =>
        u.name?.toLowerCase().includes(term) ||
        u.email?.toLowerCase().includes(term) ||
        roleBadgeLabel(u).toLowerCase().includes(term)
    );
  }, [users, userSearch]);

  useEffect(() => setPage(1), [userSearch]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const pagedUsers = filteredUsers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
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
        expiry_date: inviteForm.expiry_date || null,
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
    if (!draft || adminAccount || !canEditUsers) return;
    setDraft((d) => ({ ...d, preset, permissions: buildPresetPermissions(preset) }));
  };

  // Dependency rule: granting edit/delete implies view; revoking view
  // revokes edit/delete for that module too. Purely a UI-side convenience
  // on top of the same permissions[module] = [actions] shape as before.
// Dependency rule (bottom-up): view is the base. create/edit each need
// view. delete needs view + create + edit — granting delete grants the
// whole chain; revoking view/create/edit strips anything above it,
// including delete.
const toggleCell = (moduleName, action) => {
  if (!draft || adminAccount || !canEditUsers) return;
  const current = new Set(draft.permissions[moduleName] || []);
  const granting = !current.has(action);

  if (granting) {
    if (action === 'delete') {
      current.add('view');
      current.add('create');
      current.add('edit');
      current.add('delete');
    } else if (action === 'edit' || action === 'create') {
      current.add('view');
      current.add(action);
    } else {
      current.add(action); // 'view'
    }
  } else {
    current.delete(action);
    if (action === 'view') {
      current.delete('create');
      current.delete('edit');
      current.delete('delete');
    } else if (action === 'create' || action === 'edit') {
      // delete depends on both create and edit — losing either strips it
      current.delete('delete');
    }
  }

  setDraft((d) => ({
    ...d,
    preset: null, // hand-edited, no longer matches a clean preset
    permissions: { ...d.permissions, [moduleName]: Array.from(current) },
  }));
};

  // Select-all for a single module row (grants every action for that module)
  const toggleRowAll = (moduleName) => { 
    if (!draft || adminAccount || !canEditUsers) return;
    const current = new Set(draft.permissions[moduleName] || []);
    const allGranted = DISPLAY_ACTIONS.every((a) => current.has(a));
    const next = allGranted ? [] : [...DISPLAY_ACTIONS];
    setDraft((d) => ({
      ...d,
      preset: null,
      permissions: { ...d.permissions, [moduleName]: next },
    }));
  };

  // Select-all for a single action column (grants that action across every module)
const toggleColumnAll = (action) => { 
  if (!draft || adminAccount || !canEditUsers) return;
  const allGranted = MODULE_DEFS.every((m) => (draft.permissions[m.key] || []).includes(action));
  const nextPermissions = { ...draft.permissions };
  MODULE_DEFS.forEach((m) => {
    const set = new Set(nextPermissions[m.key] || []);
    if (allGranted) {
      set.delete(action);
      if (action === 'view') { set.delete('create'); set.delete('edit'); set.delete('delete'); }
      else if (action === 'create' || action === 'edit') { set.delete('delete'); }
    } else {
      if (action === 'delete') {
        set.add('view'); set.add('create'); set.add('edit'); set.add('delete');
      } else if (action === 'edit' || action === 'create') {
        set.add('view'); set.add(action);
      } else {
        set.add(action);
      }
    }
    nextPermissions[m.key] = Array.from(set);
  });
  setDraft((d) => ({ ...d, preset: null, permissions: nextPermissions }));
};

  const toggleStore = (storeId) => { 
    if (!draft || adminAccount || !canEditUsers) return;
    const has = draft.store_ids.includes(storeId);
    setDraft((d) => ({
      ...d,
      store_ids: has ? d.store_ids.filter((id) => id !== storeId) : [...d.store_ids, storeId],
    }));
  };

  const filteredStores = useMemo(() => {
    const term = storeSearch.trim().toLowerCase();
    if (!term) return stores;
    return stores.filter(
      (s) => s.location?.toLowerCase().includes(term) || s.store_code?.toLowerCase().includes(term)
    );
  }, [stores, storeSearch]);

  const allStoresSelected = stores.length > 0 && (draft?.store_ids || []).length === stores.length;

  const toggleAllStores = () => { 
    if (!draft || adminAccount || !canEditUsers) return;
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

  const activeNow = selectedUser ? isRecentlyActive(selectedUser.last_seen) : false;

  return (
    <div className="um2-layout">
      {/* --- Left: user list --- */}
      <aside className="um2-sidebar">
        <div className="um2-sidebar-header">
          <h2>Users</h2>
          <span className="um2-count-badge">{users.length}</span>
        </div>

        <div className="um2-search">
          <Search size={15} />
          <input
            type="text"
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            placeholder="Search name, email, role…"
          />
          {userSearch && (
            <button type="button" className="um2-search-clear" onClick={() => setUserSearch('')} aria-label="Clear search">
              <X size={13} />
            </button>
          )}
        </div>

        <div className="um2-list">
          {pagedUsers.length === 0 ? (
            <p className="um2-empty-list">No accounts match.</p>
          ) : (
            pagedUsers.map((user) => {
              const online = isRecentlyActive(user.last_seen);
              return (
                <button
                  key={user.user_id}
                  type="button"
                  className={`um2-user-card ${user.user_id === selectedUserId ? 'um2-user-card-active' : ''}`}
                  onClick={() => setSelectedUserId(user.user_id)}
                >
                  <span className="um2-avatar-wrap">
                    <span className="um2-avatar">{initialsOf(user.name)}</span>
                    <span className={`um2-status-dot ${online ? 'um2-status-dot-on' : 'um2-status-dot-off'}`} />
                  </span>
                  <span className="um2-user-meta">
                    <span className="um2-user-name">{user.name}</span>
                    <span className="um2-user-sub">
                      <span className="um2-role-chip">{roleBadgeLabel(user)}</span>
                      <span className="um2-dot-sep">·</span>
                      {accessLabel(user)}
                    </span>
                    <span className="um2-user-lastseen">
                      <Clock size={10} /> {formatRelativeTime(user.last_seen)}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        {totalPages > 1 && (
          <div className="um2-pagination">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>‹</button>
            <span>Page {page} of {totalPages}</span>
            <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>›</button>
          </div>
        )}

        {canCreateUsers && (
            <button type="button" className="um2-invite-btn" onClick={() => setIsInviteOpen(true)}>
              <Plus size={15} /> Add user
            </button>
          )}
      </aside>

      {/* --- Right: detail --- */}
      <section className="um2-detail">
        {!selectedUser ? (
          <div className="um2-detail-empty">
            <UserCircle2 size={32} className="um2-empty-icon" />
            <p>Select a user to view their details.</p>
          </div>
        ) : (
          <>
            {/* --- Profile header --- */}
            <div className="um2-profile-card">
              <div className="um2-profile-top">
                <span className="um2-profile-avatar-wrap">
                  <span className="um2-profile-avatar">{initialsOf(selectedUser.name)}</span>
                  <span className={`um2-status-dot um2-status-dot-lg ${activeNow ? 'um2-status-dot-on' : 'um2-status-dot-off'}`} />
                </span>
                <div className="um2-profile-meta">
                  <div className="um2-profile-name-row">
                    <span className="um2-profile-name">{selectedUser.name}</span>
                    <span className="um2-role-badge">{roleBadgeLabel(selectedUser)}</span>
                    <span className={`um2-active-badge ${activeNow ? 'um2-active-badge-on' : 'um2-active-badge-off'}`}>
                      {activeNow ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <span className="um2-profile-email">{selectedUser.email}</span>
                </div>

                {!adminAccount && canDeleteUsers && (
                  <button type="button" className="um2-remove-btn" onClick={() => removeUser(selectedUser.user_id)}>
                    Remove
                  </button>
                )}
              </div>

              <div className="um2-summary-grid">
                <div className="um2-summary-card">
                  <StoreIcon size={16} className="um2-summary-icon" />
                  <div>
                    <span className="um2-summary-value">{adminAccount ? stores.length : (draft?.store_ids || []).length}</span>
                    <span className="um2-summary-label">Stores</span>
                  </div>
                </div>
                <div className="um2-summary-card">
                  <LayoutGrid size={16} className="um2-summary-icon" />
                  <div>
                    <span className="um2-summary-value">
                      {adminAccount ? MODULE_DEFS.length : MODULE_DEFS.filter((m) => (draft?.permissions?.[m.key] || []).length > 0).length}
                    </span>
                    <span className="um2-summary-label">Modules</span>
                  </div>
                </div>
                <div className="um2-summary-card">
                  <KeyRound size={16} className="um2-summary-icon" />
                  <div>
                    <span className="um2-summary-value">
                      {adminAccount ? MODULE_DEFS.length * DISPLAY_ACTIONS.length : grantTotal}
                    </span>
                    <span className="um2-summary-label">Permissions</span>
                  </div>
                </div>
                <div className="um2-summary-card">
                  <Clock size={16} className="um2-summary-icon" />
                  <div>
                    <span className="um2-summary-value um2-summary-value-sm">{formatRelativeTime(selectedUser.last_seen)}</span>
                    <span className="um2-summary-label">Last Login</span>
                  </div>
                </div>
                <div className="um2-summary-card">
                  <Clock size={16} className="um2-summary-icon" />
                  <div>
                    <span className="um2-summary-value um2-summary-value-sm">
                      {selectedUser.expiry_date
                        ? new Date(selectedUser.expiry_date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
                        : 'No expiry'}
                    </span>
                    <span className="um2-summary-label">Account Expiry</span>
                  </div>
                </div>
              </div>
            </div>

            {/* --- Role preset --- */}
            {!adminAccount && (
              <div className="um2-card">
                <div className="um2-card-header">
                  <ShieldCheck size={16} className="um2-card-header-icon" />
                  <h3>Role Preset</h3>
                </div>
                <div className="um2-preset-grid">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={`um2-preset-card ${draft?.preset === preset ? 'um2-preset-card-active' : ''}`}
                      onClick={() => applyPreset(preset)}
                    >
                      <span className="um2-preset-card-top">
                        <span className="um2-preset-card-name">{preset}</span>
                        {draft?.preset === preset && <Check size={14} className="um2-preset-check" />}
                      </span>
                      <span className="um2-preset-card-desc">{PRESET_META[preset]}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* --- Store access --- */}
            <div className="um2-card">
              <div className="um2-card-header">
                <StoreIcon size={16} className="um2-card-header-icon" />
                <h3>Warehouse &amp; store access</h3>
                <span className="um2-count-badge">{(draft?.store_ids || []).length} OF {stores.length}</span>
                <div className="um2-spacer" />
                <div className="um2-mini-search">
                  <Search size={13} />
                  <input
                    type="text"
                    value={storeSearch}
                    onChange={(e) => setStoreSearch(e.target.value)}
                    placeholder="Search stores"
                  />
                </div>
                <button type="button" className="um2-secondary-btn" onClick={toggleAllStores} disabled={adminAccount}>
                  {allStoresSelected ? 'Clear all' : 'Select all'}
                </button>
              </div>

              <div className="um2-store-grid">
                {filteredStores.length === 0 ? (
                  <p className="um2-empty-inline">No stores match “{storeSearch}”.</p>
                ) : (
                  filteredStores.map((store) => {
                    const isChecked = adminAccount || (draft?.store_ids || []).includes(store.store_id);
                    return (
                      <button
                        key={store.store_id}
                        type="button"
                        className={`um2-store-toggle ${isChecked ? 'um2-store-toggle-active' : ''}`}
                        onClick={() => toggleStore(store.store_id)}
                        disabled={adminAccount}
                      >
                        <span className="um2-store-check">{isChecked ? <Check size={12} /> : ''}</span>
                        <span className="um2-store-meta">
                          <span className="um2-store-name">{store.location}</span>
                          <span className="um2-store-code">{store.store_code}</span>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* --- Permissions --- */}
            <div className="um2-card">
              <div className="um2-card-header">
                <KeyRound size={16} className="um2-card-header-icon" />
                <h3>Modules &amp; functions</h3>
                <span className="um2-count-badge">
                  {adminAccount ? MODULE_DEFS.length * DISPLAY_ACTIONS.length : grantTotal} GRANTS
                </span>
                <div className="um2-spacer" />
                <span className="um2-hint">Click a cell to grant or revoke · Edit/Delete require View</span>
              </div>

              <div className="um2-permission-table-wrapper">
                {MODULE_CATEGORIES.map((cat) => {
                  const catModules = MODULE_DEFS.filter((m) => cat.modules.includes(m.key));
                  if (catModules.length === 0) return null;
                  return (
                    <div key={cat.label} className="um2-perm-category">
                      <div className="um2-perm-category-label">{cat.label}</div>
                      <table className="um2-permission-table">
                        {cat === MODULE_CATEGORIES[0] && (
                          <thead>
                            <tr>
                              <th className="um2-col-module">Module</th>
                              <th className="um2-col-functions">Functions</th>
                              {DISPLAY_ACTIONS.map((action) => (
                                <th key={action} className="um2-col-action">
                                  <div className="um2-col-action-head">
                                    <span>{action.charAt(0).toUpperCase() + action.slice(1)}</span>
                                    <button
                                      type="button"
                                      className="um2-col-select-all"
                                      onClick={() => toggleColumnAll(action)}
                                      disabled={adminAccount}
                                    >
                                      all
                                    </button>
                                  </div>
                                </th>
                              ))}
                              <th className="um2-col-row-all"></th>
                            </tr>
                          </thead>
                        )}
                        <tbody>
                          {catModules.map((mod) => {
                            const grantedActions = adminAccount ? DISPLAY_ACTIONS : (draft?.permissions?.[mod.key] || []);
                            const allRowGranted = DISPLAY_ACTIONS.every((a) => grantedActions.includes(a));
                            return (
                              <tr key={mod.key}>
                                <td className="um2-col-module">
                                  <span className={`um2-module-dot ${grantedActions.length > 0 ? 'um2-module-dot-active' : ''}`} />
                                  {mod.key}
                                </td>
                                <td className="um2-col-functions">
                                  {mod.functions.map((fn) => (
                                    <span key={fn} className="um2-function-chip">{fn}</span>
                                  ))}
                                </td>
                                {DISPLAY_ACTIONS.map((action) => {
                                  const isGranted = grantedActions.includes(action);
                                  return (
                                    <td key={action} className="um2-col-action">
                                      <button
                                        type="button"
                                        className={`um2-cell-btn ${isGranted ? 'um2-cell-btn-active' : ''} ${action === 'delete' ? 'um2-cell-btn-danger' : ''}`}
                                        onClick={() => toggleCell(mod.key, action)}
                                        disabled={adminAccount}
                                        aria-label={`${action} ${mod.key}`}
                                      >
                                        {isGranted ? <Check size={13} /> : ''}
                                      </button>
                                    </td>
                                  );
                                })}
                                <td className="um2-col-row-all">
                                  <button
                                    type="button"
                                    className="um2-row-select-all"
                                    onClick={() => toggleRowAll(mod.key)}
                                    disabled={adminAccount}
                                  >
                                    {allRowGranted ? 'clear' : 'all'}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>

              <div className="um2-card-footer">
                <div className="um2-footer-summary">
                  <span className="um2-footer-item"><strong>{adminAccount ? stores.length : (draft?.store_ids || []).length}</strong> stores</span>
                  <span className="um2-footer-item"><strong>{adminAccount ? MODULE_DEFS.length : MODULE_DEFS.filter((m) => (draft?.permissions?.[m.key] || []).length > 0).length}</strong> modules</span>
                  <span className="um2-footer-item"><strong>{adminAccount ? MODULE_DEFS.length * DISPLAY_ACTIONS.length : grantTotal}</strong> permissions</span>
                  <span className="um2-footer-item">preset: <strong>{draft?.preset || 'Custom'}</strong></span>
                  <span className="um2-footer-item">updated <strong>{formatRelativeTime(selectedUser.last_seen)}</strong></span>
                </div>
                <div className="um2-footer-actions">
                  <button type="button" className="um2-secondary-btn" onClick={resetToPreset} disabled={adminAccount || !isDirty}>
                    <RotateCcw size={14} /> Reset to preset
                  </button>
                  <button type="button" className="um2-primary-btn" onClick={savePermissions} disabled={adminAccount || !isDirty || isSaving}>
                    <Save size={14} /> {isSaving ? 'Saving…' : 'Save permissions'}
                  </button>
                </div>
              </div>
              {saveMessage && <p className="um2-status-text">{saveMessage}</p>}
              {adminAccount && (
                <p className="um2-admin-note">Admin accounts always have full access — nothing to configure here.</p>
              )}
            </div>
          </>
        )}
      </section>

      {/* --- Invite user modal --- */}
      {isInviteOpen && (
        <div className="um2-modal-overlay" onClick={() => setIsInviteOpen(false)}>
          <div className="um2-modal-panel" onClick={(e) => e.stopPropagation()}>
            <h3>Invite User</h3>
            <form onSubmit={handleInviteSubmit} className="um2-invite-form">
              <div className="um2-field">
                <label>Name</label>
                <input name="name" type="text" value={inviteForm.name} onChange={handleInviteFieldChange} placeholder="e.g. Jane Tan" required />
              </div>
              <div className="um2-field">
                <label>Email</label>
                <input name="email" type="email" value={inviteForm.email} onChange={handleInviteFieldChange} placeholder="jane@example.com" required />
              </div>
              <div className="um2-field">
                <label>Role</label>
                <select name="role" value={inviteForm.role} onChange={handleInviteFieldChange}>
                  {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="um2-field">
                <label>Password</label>
                <input name="password" type="password" value={inviteForm.password} onChange={handleInviteFieldChange} placeholder="Set a password" required />
              </div>

              <div className="um2-field">
                <label>Account Expiry Date</label>
                <input
                  name="expiry_date"
                  type="date"
                  value={inviteForm.expiry_date}
                  onChange={handleInviteFieldChange}
                  min={new Date().toISOString().split('T')[0]}
                />
              </div>

              {inviteError && <p className="um2-error-text">{inviteError}</p>}

              <div className="um2-modal-actions">
                <button type="button" className="um2-secondary-btn" onClick={() => setIsInviteOpen(false)}>Cancel</button>
                <button type="submit" className="um2-primary-btn">Add</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}