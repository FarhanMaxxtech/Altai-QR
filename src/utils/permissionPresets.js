// Shared between the UI and the server routes — defines the module/function
// catalogue and what each permission preset grants. Only three actions are
// exposed for now: view, create, edit.

export const MODULE_DEFS = [
  { key: 'Dashboard', functions: ['View KPIs', 'Export charts'] },
  { key: 'Product InfoCenter', functions: ['Register product', 'Edit catalogue', 'Assign QR'] },
  { key: 'Product Balance', functions: ['View balance', 'Export CSV'] },
  { key: 'Store Management', functions: ['View stores', 'Edit stores'] },
  { key: 'Stock Adjustment', functions: ['Create adjustment', 'Approve adjustment'] },
  { key: 'Transaction Ledger', functions: ['View ledger', 'Export ledger'] },
  { key: 'User Management', functions: ['View users', 'Invite users', 'Edit permissions'] },
];

export const ALL_MODULES = MODULE_DEFS.map((m) => m.key);
export const ACTIONS = ['view', 'create', 'edit'];
export const PRESETS = ['Admin', 'Manager', 'Operator', 'Viewer'];

function fullAccess() {
  const perms = {};
  ALL_MODULES.forEach((m) => { perms[m] = ['view', 'create', 'edit']; });
  return perms;
}

export function buildPresetPermissions(preset) {
  if (preset === 'Admin') return fullAccess();

  if (preset === 'Manager') {
    const perms = fullAccess();
    perms['Store Management'] = ['view'];
    perms['User Management'] = ['view'];
    return perms;
  }

  if (preset === 'Operator') {
    const perms = {};
    ['Dashboard', 'Product InfoCenter', 'Product Balance', 'Store Management', 'Stock Adjustment', 'Transaction Ledger']
      .forEach((m) => { perms[m] = ['view']; });
    perms['Product InfoCenter'] = ['view', 'edit'];
    perms['Stock Adjustment'] = ['view', 'edit'];
    return perms;
  }

  if (preset === 'Viewer') {
    const perms = {};
    ['Dashboard', 'Product InfoCenter', 'Product Balance', 'Store Management', 'Transaction Ledger']
      .forEach((m) => { perms[m] = ['view']; });
    return perms;
  }

  return {};
}

// Flattens a permissions map down to the simple module-name array that
// Navigation.jsx / ProtectedRoute.jsx already understand — any module with
// at least one granted action counts as accessible.
export function permissionsToModuleList(permissions) {
  return Object.entries(permissions || {})
    .filter(([, actions]) => Array.isArray(actions) && actions.length > 0)
    .map(([moduleName]) => moduleName);
}