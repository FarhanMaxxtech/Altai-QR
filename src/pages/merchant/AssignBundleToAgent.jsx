import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Search, X, QrCode, PackageCheck, Download, Printer, Calendar } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { apiFetch } from '../../utils/api';
import { getAuthUser } from '../../utils/authStorage';
import { useConfirm } from '../../context/ConfirmContext';
import TableControls from '../../components/TableControls';
import { exportRowsToCsv, exportRowsToExcel, exportRowsToPdf } from '../../utils/tableExport';
import '../../styles/AssignBundleToAgent.css';

const ITEM_PAGE_SIZE = 50;
const EMPTY_ITEMS = [];

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function exportRows(bundles) {
  return bundles.map((bundle) => ({
    'Bundle QR': bundle.bundle_code,
    Product: bundle.product_name,
    SKU: bundle.sku,
    Quantity: Number(bundle.qty),
    Status: bundle.status === 'assigned' ? 'Assigned' : bundle.status === 'voided' ? 'Voided' : 'Unassigned',
    'Stock state': bundle.label || bundle.stock_state || '',
    Agent: bundle.agent_name || '',
    Created: formatDate(bundle.created_at),
    'Assigned date': formatDate(bundle.assigned_at),
    Remarks: bundle.remarks || '',
    'Expiry date': formatDate(bundle.expiry_date),
  }));
}

function safeFileName(value) {
  return String(value || 'bundle').replace(/[^a-z0-9-_]/gi, '_');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function statusLabel(status) {
  if (status === 'assigned') return 'Assigned';
  if (status === 'voided') return 'Voided';
  return 'Unassigned';
}

function itemStatusLabel(item) {
  return item.friendly_status || item.status;
}

function itemStatusClass(item) {
  return itemStatusLabel(item).startsWith('Assigned to ') ? 'aba-item-status-assigned' : '';
}

export default function AssignBundleToAgent() {
  const confirm = useConfirm();
  const currentUser = getAuthUser();
  const canEditBundles = currentUser?.role === 'admin'
    || currentUser?.role === 'super_admin'
    || (currentUser?.permissions?.['Agent / Distributor'] || []).includes('edit');
  const [bundles, setBundles] = useState([]);
  const [agents, setAgents] = useState([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const fromDateInputRef = useRef(null);
  const toDateInputRef = useRef(null);
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailPage, setDetailPage] = useState(1);
  const detailCanvasRef = useRef(null);

  const [assignTarget, setAssignTarget] = useState(null);
  const [agentId, setAgentId] = useState('');
  const [isSavingAssignment, setIsSavingAssignment] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setErrorMessage('');
    const params = new URLSearchParams({ page: String(page), limit: String(pageSize) });
    if (search) params.set('search', search);
    if (filter === 'assigned') params.set('status', 'assigned');
    if (filter === 'unassigned') params.set('status', 'active');
    if (filter === 'voided') params.set('status', 'voided');
    if (fromDate) params.set('from_date', fromDate);
    if (toDate) params.set('to_date', toDate);

    apiFetch(`/api/bundles?${params}`)
      .then(async (res) => {
        if (!res) return null;
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Could not load bundles.');
        return data;
      })
      .then((data) => {
        if (!active || !data) return;
        setBundles(data.bundles || []);
        setTotal(Number(data.total) || 0);
      })
      .catch((err) => {
        if (active) setErrorMessage(err.message || 'Could not load bundles.');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => { active = false; };
  }, [page, pageSize, search, filter, fromDate, toDate, refreshKey]);

  useEffect(() => {
    apiFetch('/api/agents?status=Active')
      .then(async (res) => {
        if (!res) return [];
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Could not load agents.');
        return data;
      })
      .then(setAgents)
      .catch((err) => setStatusMessage(err.message || 'Could not load agents.'));
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const detailItems = detail?.items || EMPTY_ITEMS;
  const detailTotalPages = Math.max(1, Math.ceil(detailItems.length / ITEM_PAGE_SIZE));
  const pagedItems = useMemo(
    () => detailItems.slice((detailPage - 1) * ITEM_PAGE_SIZE, detailPage * ITEM_PAGE_SIZE),
    [detailItems, detailPage]
  );
  const selectedAgent = agents.find((agent) => agent.agent_id === agentId);

  const setStatusFilter = (value) => {
    setFilter(value);
    setPage(1);
  };

  const openDatePicker = (inputRef) => {
    if (typeof inputRef.current?.showPicker === 'function') inputRef.current.showPicker();
    else inputRef.current?.focus();
  };

  const setQuickDateRange = (days) => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - (days - 1));
    const toInputValue = (date) => (
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    );
    setFromDate(toInputValue(start));
    setToDate(toInputValue(end));
    setPage(1);
  };

  const clearDateRange = () => {
    setFromDate('');
    setToDate('');
    setPage(1);
  };

  const loadDetail = async (bundleId) => {
    setDetail(null);
    setDetailLoading(true);
    setDetailError('');
    setDetailPage(1);
    try {
      const res = await apiFetch(`/api/bundles/${bundleId}`);
      if (!res) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Could not load bundle details.');
      setDetail(data);
    } catch (err) {
      setDetailError(err.message || 'Could not load bundle details.');
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshCurrentBundle = async (bundleId) => {
    setRefreshKey((current) => current + 1);
    if (bundleId) await loadDetail(bundleId);
  };

  const openAssign = (bundle) => {
    setAssignTarget(bundle);
    setAgentId(bundle.agent_id || '');
    setStatusMessage('');
  };

  const assignBundle = async () => {
    if (!assignTarget || !selectedAgent || isSavingAssignment) return;
    const confirmed = await confirm(
      `${assignTarget.status === 'assigned' ? 'Reassign' : 'Assign'} ${assignTarget.bundle_code} to ${selectedAgent.name}?`,
      {
        title: assignTarget.status === 'assigned' ? 'Reassign bundle?' : 'Assign bundle?',
        confirmLabel: assignTarget.status === 'assigned' ? 'Reassign' : 'Assign',
        cancelLabel: 'Cancel',
      }
    );
    if (!confirmed) return;

    setIsSavingAssignment(true);
    setStatusMessage('');
    try {
      const res = await apiFetch(`/api/bundles/${assignTarget.bundle_id}/assign`, {
        method: 'PUT',
        body: JSON.stringify({ agent_id: selectedAgent.agent_id }),
      });
      if (!res) return;
      const result = await res.json();
      if (!res.ok) throw new Error(result.message || 'Could not assign bundle.');
      setAssignTarget(null);
      setStatusMessage(`${result.bundle_code} assigned to ${result.agent_name}.`);
      await refreshCurrentBundle(result.bundle_id);
    } catch (err) {
      setStatusMessage(err.message || 'Could not assign bundle.');
    } finally {
      setIsSavingAssignment(false);
    }
  };

  const unassignBundle = async (bundle) => {
    const confirmed = await confirm(
      `Unassign ${bundle.bundle_code} from ${bundle.agent_name || 'this agent'}?`,
      { title: 'Unassign bundle?', confirmLabel: 'Unassign', cancelLabel: 'Cancel', danger: true }
    );
    if (!confirmed) return;
    setStatusMessage('');
    try {
      const res = await apiFetch(`/api/bundles/${bundle.bundle_id}/unassign`, { method: 'PUT' });
      if (!res) return;
      const result = await res.json();
      if (!res.ok) throw new Error(result.message || 'Could not unassign bundle.');
      setStatusMessage(`${result.bundle_code} is now unassigned.`);
      await refreshCurrentBundle(result.bundle_id);
    } catch (err) {
      setStatusMessage(err.message || 'Could not unassign bundle.');
    }
  };

  const removeBundle = async (bundle) => {
    const confirmed = await confirm(
      `Remove ${bundle.bundle_code}? This will release all member codes and make them available as normal unit labels.`,
      { title: 'Remove bundle?', confirmLabel: 'Remove', cancelLabel: 'Cancel', danger: true }
    );
    if (!confirmed) return;
    setStatusMessage('');
    try {
      const res = await apiFetch(`/api/bundles/${bundle.bundle_id}`, { method: 'DELETE' });
      if (!res) return;
      const result = await res.json();
      if (!res.ok) throw new Error(result.message || 'Could not remove bundle.');
      setStatusMessage(`${result.bundle_code} removed. Its codes have been released.`);
      await refreshCurrentBundle(result.bundle_id);
    } catch (err) {
      setStatusMessage(err.message || 'Could not remove bundle.');
    }
  };

  const buildFilters = () => {
    const params = new URLSearchParams({ page: '1', limit: '100' });
    if (search) params.set('search', search);
    if (filter === 'assigned') params.set('status', 'assigned');
    if (filter === 'unassigned') params.set('status', 'active');
    if (filter === 'voided') params.set('status', 'voided');
    if (fromDate) params.set('from_date', fromDate);
    if (toDate) params.set('to_date', toDate);
    return params;
  };

  const loadAllFilteredBundles = async () => {
    const all = [];
    let params = buildFilters();
    let totalRows = Infinity;
    while (all.length < totalRows) {
      const res = await apiFetch(`/api/bundles?${params}`);
      if (!res) throw new Error('Your session is no longer valid.');
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Could not load bundles for export.');
      totalRows = Number(data.total) || 0;
      all.push(...(data.bundles || []));
      if (!data.bundles?.length) break;
      params = new URLSearchParams(params);
      params.set('page', String(Number(params.get('page')) + 1));
    }
    return exportRows(all);
  };

  const exportFiltered = async (format) => {
    try {
      const rows = await loadAllFilteredBundles();
      if (!rows.length) {
        setStatusMessage('There are no bundles to export.');
        return;
      }
      if (format === 'excel') exportRowsToExcel(rows, 'qr-bundles.xlsx', 'Bundles');
      if (format === 'csv') exportRowsToCsv(rows, 'qr-bundles.csv');
      if (format === 'pdf') exportRowsToPdf(rows, 'qr-bundles.pdf', 'QR Bundles');
    } catch (err) {
      setStatusMessage(err.message || 'Could not export bundles.');
    }
  };

  const downloadQr = (canvas, bundleCode) => {
    if (!canvas) return;
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `${safeFileName(bundleCode)}.png`;
    link.click();
  };

  const downloadItems = (format) => {
    if (!detailItems.length || !detail) return;
    const rows = detailItems.map((item) => ({
      'Bundle QR': detail.bundle_code,
      'Label ID': item.label_id,
      'QR ID': item.qr_id,
      Status: itemStatusLabel(item),
    }));
    const file = `${safeFileName(detail.bundle_code)}-items`;
    if (format === 'excel') exportRowsToExcel(rows, `${file}.xlsx`, 'Bundle items');
    if (format === 'pdf') exportRowsToPdf(rows, `${file}.pdf`, `${detail.bundle_code} · Items`);
  };

  const printLabel = () => {
    if (!detail || !detailCanvasRef.current) return;
    const popup = window.open('', '_blank', 'width=480,height=640');
    if (!popup) {
      setStatusMessage('Allow pop-ups to print the bundle label.');
      return;
    }
    const image = detailCanvasRef.current.toDataURL('image/png');
    const label = `${detail.bundle_code} · ${detail.sku} · ${detail.qty}`;
    popup.document.open();
    popup.document.write(`<!doctype html><html><head><title>${escapeHtml(detail.bundle_code)}</title><style>
      body{font-family:Arial,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#111827}
      main{text-align:center;padding:24px}img{width:260px;height:260px}.code{font:700 15px ui-monospace,monospace;margin-top:12px}
      @media print{@page{margin:12mm}main{padding:0}}
    </style></head><body><main><img src="${image}" alt="Bundle QR"><div class="code">${escapeHtml(label)}</div></main></body></html>`);
    popup.document.close();
    popup.focus();
    window.setTimeout(() => popup.print(), 250);
  };

  return (
    <div className="aba-page">
      <div className="aba-info-note">
        <AlertTriangle size={17} />
        <span>Bundles assigned to an agent/distributor are locked and cannot be used for stock actions.</span>
      </div>

      <div className="aba-toolbar">
        <label className="aba-search">
          <Search size={16} />
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search bundle, product, SKU or agent"
          />
        </label>
        <div className="aba-filters" role="group" aria-label="Bundle status">
          {[
            ['all', 'All'],
            ['unassigned', 'Unassigned'],
            ['assigned', 'Assigned'],
            ['voided', 'Voided'],
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={`aba-filter ${filter === value ? 'aba-filter-active' : ''}`}
              onClick={() => setStatusFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="aba-date-tools">
          <div className="aba-date-range">
            <div className="aba-date-field">
              <label htmlFor="aba-from-date">From</label>
              <div className="aba-date-control">
                <input
                  ref={fromDateInputRef}
                  id="aba-from-date"
                  type="date"
                  value={fromDate}
                  max={toDate || undefined}
                  onChange={(event) => { setFromDate(event.target.value); setPage(1); }}
                />
                <button type="button" className="aba-date-picker-button" aria-label="Open From date picker" onClick={() => openDatePicker(fromDateInputRef)}>
                  <Calendar size={18} />
                </button>
              </div>
            </div>
            <div className="aba-date-field">
              <label htmlFor="aba-to-date">To</label>
              <div className="aba-date-control">
                <input
                  ref={toDateInputRef}
                  id="aba-to-date"
                  type="date"
                  value={toDate}
                  min={fromDate || undefined}
                  onChange={(event) => { setToDate(event.target.value); setPage(1); }}
                />
                <button type="button" className="aba-date-picker-button" aria-label="Open To date picker" onClick={() => openDatePicker(toDateInputRef)}>
                  <Calendar size={18} />
                </button>
              </div>
            </div>
          </div>
          <div className="aba-date-quick-ranges" aria-label="Quick date ranges">
            <button type="button" onClick={() => setQuickDateRange(7)}>Last 7 days</button>
            <button type="button" onClick={() => setQuickDateRange(30)}>Last 30 days</button>
            <button type="button" className="aba-date-clear" onClick={clearDateRange}><X size={14} /> Clear</button>
          </div>
        </div>
      </div>

      {statusMessage && <p className="aba-status-message" role="status">{statusMessage}</p>}
      {errorMessage && <p className="aba-error-message" role="alert">{errorMessage}</p>}

      <div className="aba-card">
        <TableControls
          pageSize={pageSize}
          onPageSizeChange={(value) => { setPageSize(value); setPage(1); }}
          onExportExcel={() => exportFiltered('excel')}
          onExportCsv={() => exportFiltered('csv')}
          onExportPdf={() => exportFiltered('pdf')}
          disabled={isLoading || total === 0}
        />
        <div className="aba-table-scroll">
          <table className="aba-table">
            <thead>
              <tr>
                <th>Bundle QR</th>
                <th>Product / SKU</th>
                <th className="aba-number-col">Qty</th>
                <th>Status</th>
                <th>Agent / Distributor</th>
                <th>Created</th>
                <th>Assigned</th>
                <th className="aba-actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td className="aba-empty-cell" colSpan="8">Loading bundles…</td></tr>
              ) : bundles.length === 0 ? (
                <tr>
                  <td className="aba-empty-cell" colSpan="8">
                    <PackageCheck size={24} />
                    <strong>No bundles found</strong>
                    <span>Create a bundle from the Assign QR to Product page after approving scanned codes.</span>
                  </td>
                </tr>
              ) : bundles.map((bundle) => (
                <tr
                  key={bundle.bundle_id}
                  className="aba-row-clickable"
                  tabIndex={0}
                  onClick={() => loadDetail(bundle.bundle_id)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      loadDetail(bundle.bundle_id);
                    }
                  }}
                >
                  <td data-label="Bundle QR">
                    <div className="aba-bundle-link">
                      <QRCodeCanvas value={bundle.bundle_code} size={42} level="M" />
                      <code>{bundle.bundle_code}</code>
                    </div>
                  </td>
                  <td data-label="Product / SKU">
                    <div className="aba-product-name">{bundle.product_name}</div>
                    <div className="aba-sku">{bundle.sku}</div>
                    <div className="aba-attribute-chips">
                      {Object.entries(bundle.attributes || {}).slice(0, 3).map(([key, value]) => (
                        <span key={key}>{key}: {String(value)}</span>
                      ))}
                    </div>
                  </td>
                  <td className="aba-number-col" data-label="Qty">{bundle.qty}</td>
                  <td data-label="Status">
                    <span className={`aba-status aba-status-${bundle.status}`}>{statusLabel(bundle.status)}</span>
                    {bundle.stock_state && bundle.status !== 'assigned' && bundle.status !== 'voided' && <span className="aba-stock-state">{bundle.label || bundle.stock_state}</span>}
                  </td>
                  <td data-label="Agent / Distributor">{bundle.agent_name || '—'}</td>
                  <td className="aba-date-nowrap" data-label="Created">{formatDate(bundle.created_at)}</td>
                  <td className="aba-date-nowrap" data-label="Assigned">{formatDate(bundle.assigned_at)}</td>
                  <td className="aba-actions-col" data-label={canEditBundles && bundle.status !== 'voided' ? 'Actions' : undefined}>
                    {canEditBundles && bundle.status !== 'voided' && (
                      <div className="aba-row-actions">
                        <button type="button" onClick={(event) => { event.stopPropagation(); openAssign(bundle); }} disabled={!bundle.can_assign} title={bundle.can_assign ? '' : bundle.lock_reason}>
                            {bundle.status === 'assigned' ? 'Reassign' : 'Assign'}
                          </button>
                          {bundle.status === 'assigned' && (
                          <button type="button" className="aba-danger-btn" onClick={(event) => { event.stopPropagation(); unassignBundle(bundle); }}>Unassign</button>
                          )}
                        <button type="button" className="aba-danger-btn" onClick={(event) => { event.stopPropagation(); removeBundle(bundle); }}>Remove</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="aba-pagination">
          <span>{total ? `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}` : 'No bundles'}</span>
          <div className="aba-pagination-controls">
            <button type="button" className="aba-pagination-btn" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
            <span className="aba-pagination-status">Page {page} of {totalPages}</span>
            <button type="button" className="aba-pagination-btn" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</button>
          </div>
        </div>
      </div>

      {(detail || detailLoading || detailError) && (
        <div className="aba-panel-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) { setDetail(null); setDetailError(''); } }}>
          <aside className="aba-detail-panel" aria-label="Bundle details">
            <header className="aba-panel-header">
              <div>
                <span>Bundle details</span>
                <h2>{detail?.bundle_code || (detailLoading ? 'Loading…' : 'Bundle')}</h2>
              </div>
              <button type="button" aria-label="Close details" onClick={() => { setDetail(null); setDetailError(''); }}><X size={18} /></button>
            </header>
            {detailLoading ? (
              <p className="aba-panel-message">Loading bundle items…</p>
            ) : detailError ? (
              <p className="aba-panel-error">{detailError}</p>
            ) : detail && (
              <>
                <div className="aba-detail-qr">
                  <QRCodeCanvas ref={detailCanvasRef} value={detail.bundle_code} size={190} level="H" />
                  <strong>{detail.bundle_code} · {detail.sku} · {detail.qty}</strong>
                </div>
                <div className="aba-detail-summary">
                  <div><span>Product</span><strong>{detail.product_name}</strong></div>
                  <div><span>SKU</span><strong>{detail.sku}</strong></div>
                  <div><span>Quantity</span><strong>{detail.qty} units</strong></div>
                  <div><span>Status</span><strong className={`aba-status aba-status-${detail.status}`}>{statusLabel(detail.status)}</strong></div>
                  <div><span>Stock state</span><strong>{detail.status === 'assigned' ? '—' : (detail.label || detail.stock_state)}</strong></div>
                  <div><span>Agent</span><strong>{detail.agent_name || '—'}</strong></div>
                  <div><span>Created</span><strong>{formatDate(detail.created_at)}</strong></div>
                  {detail.remarks && <div><span>Remarks</span><strong>{detail.remarks}</strong></div>}
                  {detail.expiry_date && <div><span>Expiry</span><strong>{formatDate(detail.expiry_date)}</strong></div>}
                </div>
                <div className="aba-panel-actions">
                  <button type="button" onClick={() => downloadQr(detailCanvasRef.current, detail.bundle_code)}><Download size={15} /> Download QR (PNG)</button>
                  <button type="button" onClick={() => downloadItems('excel')}><Download size={15} /> Download items (Excel)</button>
                  <button type="button" onClick={() => downloadItems('pdf')}><Download size={15} /> Download items (PDF)</button>
                  <button type="button" onClick={printLabel}><Printer size={15} /> Print label</button>
                </div>
                <div className="aba-items-heading">
                  <h3>Bundle items</h3>
                  <span>{detailItems.length} labels</span>
                </div>
                <div className="aba-item-list">
                  {pagedItems.map((item) => (
                    <div className="aba-item-row" key={item.qr_batch}>
                      <QrCode size={14} />
                      <code>{item.label_id}</code>
                      <span className={itemStatusClass(item)}>{itemStatusLabel(item)}</span>
                    </div>
                  ))}
                </div>
                {detailTotalPages > 1 && (
                  <div className="aba-item-pagination">
                    <button type="button" disabled={detailPage <= 1} onClick={() => setDetailPage((value) => Math.max(1, value - 1))}>Previous</button>
                    <span>Page {detailPage} of {detailTotalPages}</span>
                    <button type="button" disabled={detailPage >= detailTotalPages} onClick={() => setDetailPage((value) => Math.min(detailTotalPages, value + 1))}>Next</button>
                  </div>
                )}
              </>
            )}
          </aside>
        </div>
      )}

      {assignTarget && (
        <div className="aba-modal-overlay">
          <section className="aba-assign-modal" role="dialog" aria-modal="true" aria-labelledby="aba-assign-title">
            <header>
              <div>
                <span>{assignTarget.status === 'assigned' ? 'REASSIGN BUNDLE' : 'ASSIGN BUNDLE'}</span>
                <h2 id="aba-assign-title">{assignTarget.bundle_code}</h2>
              </div>
              <button type="button" onClick={() => setAssignTarget(null)} aria-label="Close"><X size={18} /></button>
            </header>
            <p>Choose an active agent / distributor for this bundle.</p>
            <label>
              Agent / Distributor
              <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                <option value="">Select an agent</option>
                {agents.map((agent) => <option key={agent.agent_id} value={agent.agent_id}>{agent.name}</option>)}
              </select>
            </label>
            {agents.length === 0 && <p className="aba-modal-hint">Create an active agent before assigning bundles.</p>}
            <footer>
              <button type="button" className="aba-cancel-btn" onClick={() => setAssignTarget(null)}>Cancel</button>
              <button type="button" className="aba-confirm-btn" disabled={!agentId || isSavingAssignment} onClick={assignBundle}>
                {isSavingAssignment ? 'Saving…' : assignTarget.status === 'assigned' ? 'Confirm reassignment' : 'Confirm assignment'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
