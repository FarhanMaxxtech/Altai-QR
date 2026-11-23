import React, { useEffect, useMemo, useState } from 'react';
import { Pencil, Search, Trash2, Truck, RotateCcw } from 'lucide-react';
import { apiFetch } from '../../utils/api';
import { getAuthUser } from '../../utils/authStorage';
import { useConfirm } from '../../context/ConfirmContext';
import '../../styles/AgentDistributor.css';

const EMPTY_FORM = { name: '', phone: '', address: '' };
const MODULE = 'Agent / Distributor';

export default function AgentDistributor() {
  const confirm = useConfirm();
  const currentUser = getAuthUser();
  const isFullAccess = currentUser?.role === 'admin' || currentUser?.role === 'super_admin';
  const canCreate = isFullAccess || (currentUser?.permissions?.[MODULE] || []).includes('create');
  const canEdit = isFullAccess || (currentUser?.permissions?.[MODULE] || []).includes('edit');
  const canDelete = isFullAccess || (currentUser?.permissions?.[MODULE] || []).includes('delete');

  const [agents, setAgents] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [mode, setMode] = useState('view');
  const [form, setForm] = useState(EMPTY_FORM);
  const [stats, setStats] = useState({ assigned_bundles: 0, total_units: 0 });
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const selectedAgent = agents.find((agent) => agent.agent_id === selectedId) || null;

  const loadAgents = async () => {
    try {
      const res = await apiFetch('/api/agents');
      if (!res) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Could not load agents.');
      setAgents(data);
      setSelectedId((current) => {
        if (current && data.some((agent) => agent.agent_id === current)) return current;
        return data[0]?.agent_id || null;
      });
      if (data.length === 0 && canCreate) {
        setMode('create');
        setForm(EMPTY_FORM);
      }
    } catch (err) {
      setMessage(err.message || 'Could not load agents.');
    }
  };

  useEffect(() => {
    loadAgents();
    // Permission state is read from the persisted auth user once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId || mode === 'create') {
      setStats({ assigned_bundles: 0, total_units: 0 });
      return;
    }
    setStats({ assigned_bundles: 0, total_units: 0 });
    let active = true;
    apiFetch(`/api/bundles?agent_id=${encodeURIComponent(selectedId)}&status=assigned&page=1&limit=1`)
      .then(async (res) => {
        if (!res) return null;
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Could not load agent bundle stats.');
        return data.summary;
      })
      .then((summary) => {
        if (active && summary) setStats(summary);
      })
      .catch((err) => {
        if (active) setMessage(err.message || 'Could not load agent bundle stats.');
      });
    return () => { active = false; };
  }, [selectedId, mode]);

  const filteredAgents = useMemo(() => {
    const term = search.trim().toLowerCase();
    return agents.filter((agent) => (
      !term
      || agent.name.toLowerCase().includes(term)
      || agent.phone?.toLowerCase().includes(term)
      || agent.address?.toLowerCase().includes(term)
    ));
  }, [agents, search]);

  const chooseAgent = (agent) => {
    setSelectedId(agent.agent_id);
    setMode('view');
    setMessage('');
  };

  const startCreate = () => {
    if (!canCreate) return;
    setSelectedId(null);
    setMode('create');
    setForm(EMPTY_FORM);
    setMessage('');
  };

  const startEdit = () => {
    if (!selectedAgent || !canEdit) return;
    setForm({
      name: selectedAgent.name || '',
      phone: selectedAgent.phone || '',
      address: selectedAgent.address || '',
    });
    setMode('edit');
    setMessage('');
  };

  const handleStatusChange = async (status) => {
    if (!selectedAgent || !canEdit) return;
    const assigned = Number(stats.assigned_bundles) || 0;
    const confirmed = await confirm(
      status === 'Inactive'
        ? `Deactivate ${selectedAgent.name}?${assigned ? ` This agent currently has ${assigned} assigned bundle${assigned === 1 ? '' : 's'}; those bundles will remain assigned.` : ''}`
        : `Reactivate ${selectedAgent.name}?`,
      {
        title: status === 'Inactive' ? 'Deactivate agent?' : 'Reactivate agent?',
        confirmLabel: status === 'Inactive' ? 'Deactivate' : 'Reactivate',
        cancelLabel: 'Cancel',
        danger: status === 'Inactive',
      }
    );
    if (!confirmed) return;

    try {
      const res = await apiFetch(
        status === 'Inactive' ? `/api/agents/${selectedAgent.agent_id}` : `/api/agents/${selectedAgent.agent_id}/status`,
        status === 'Inactive'
          ? { method: 'DELETE' }
          : { method: 'PUT', body: JSON.stringify({ status }) }
      );
      if (!res) return;
      const result = await res.json();
      if (!res.ok) throw new Error(result.message || 'Could not update agent status.');
      setAgents((prev) => prev.map((agent) => (agent.agent_id === result.agent_id ? result : agent)));
      setMessage(status === 'Inactive' ? 'Agent deactivated.' : 'Agent reactivated.');
    } catch (err) {
      setMessage(err.message || 'Could not update agent status.');
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.name.trim() || isSaving) return;
    setIsSaving(true);
    setMessage('');
    try {
      const editing = mode === 'edit' && selectedAgent;
      const res = await apiFetch(
        editing ? `/api/agents/${selectedAgent.agent_id}` : '/api/agents',
        {
          method: editing ? 'PUT' : 'POST',
          body: JSON.stringify({
            name: form.name.trim(),
            phone: form.phone.trim(),
            address: form.address.trim(),
          }),
        }
      );
      if (!res) return;
      const result = await res.json();
      if (!res.ok) throw new Error(result.message || 'Could not save agent.');
      setAgents((prev) => (
        editing
          ? prev.map((agent) => (agent.agent_id === result.agent_id ? result : agent))
          : [...prev, result].sort((a, b) => a.name.localeCompare(b.name))
      ));
      setSelectedId(result.agent_id);
      setMode('view');
      setMessage(editing ? 'Agent details updated.' : 'Agent created.');
    } catch (err) {
      setMessage(err.message || 'Could not save agent.');
    } finally {
      setIsSaving(false);
    }
  };

  const cancelEdit = () => {
    setMessage('');
    if (mode === 'create' && !agents.length) return;
    if (mode === 'create' && !selectedId) setSelectedId(agents[0]?.agent_id || null);
    setMode('view');
  };

  const readOnly = mode === 'view';
  const showDetail = mode === 'create' || selectedAgent;

  return (
    <div className="ad-layout">
      <aside className="ad-sidebar">
        <div className="ad-sidebar-header">
          <div>
            <h2>Agents</h2>
            <p>Distribution partners</p>
          </div>
          <span className="ad-count">{agents.length}</span>
        </div>

        <label className="ad-search">
          <Search size={16} aria-hidden="true" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search agents" />
        </label>

        <div className="ad-agent-list">
          {agents.length === 0 ? (
            <p className="ad-empty-list">No agents yet.</p>
          ) : filteredAgents.length === 0 ? (
            <p className="ad-empty-list">No agents match this search.</p>
          ) : filteredAgents.map((agent) => (
            <button
              type="button"
              key={agent.agent_id}
              className={`ad-agent-card ${agent.agent_id === selectedId && mode !== 'create' ? 'ad-agent-card-active' : ''}`}
              onClick={() => chooseAgent(agent)}
            >
              <span className="ad-agent-card-top">
                <strong>{agent.name}</strong>
                <span className={`ad-status ad-status-${agent.status.toLowerCase()}`}>{agent.status}</span>
              </span>
              <span className="ad-agent-card-meta">{agent.phone || 'No phone number'}</span>
            </button>
          ))}
        </div>

        {canCreate && (
          <button type="button" className="ad-add-btn" onClick={startCreate}>+ New agent</button>
        )}
      </aside>

      <section className="ad-detail">
        {!showDetail ? (
          <div className="ad-empty-detail">
            <Truck size={28} />
            <h2>Select an agent</h2>
            <p>Choose an agent from the list to view or edit their details.</p>
          </div>
        ) : (
          <>
            <header className="ad-detail-header">
              <div className="ad-detail-icon"><Truck size={20} /></div>
              <div className="ad-detail-title">
                <h2>{mode === 'create' ? 'New agent' : selectedAgent.name}</h2>
                <p>{mode === 'create' ? 'Add a distribution partner' : 'Agent / Distributor'}</p>
              </div>
              {mode !== 'create' && selectedAgent.status === 'Active' && canDelete && (
                <button
                  type="button"
                  className="ad-danger-btn"
                  onClick={() => handleStatusChange('Inactive')}
                  disabled={mode !== 'view'}
                >
                  <Trash2 size={15} /> Deactivate
                </button>
              )}
              {mode !== 'create' && selectedAgent.status === 'Inactive' && canEdit && (
                <button type="button" className="ad-secondary-btn" onClick={() => handleStatusChange('Active')}>
                  <RotateCcw size={15} /> Reactivate
                </button>
              )}
              {mode !== 'create' && canEdit && (
                <button type="button" className="ad-edit-btn" onClick={startEdit} disabled={mode === 'edit'}>
                  <Pencil size={15} /> Edit
                </button>
              )}
            </header>

            {mode !== 'create' && (
              <div className="ad-stats">
                <div className="ad-stat">
                  <span>Assigned bundles</span>
                  <strong>{stats.assigned_bundles}</strong>
                </div>
                <div className="ad-stat">
                  <span>Total units</span>
                  <strong>{stats.total_units}</strong>
                </div>
                <div className="ad-stat ad-status-stat">
                  <span>Status</span>
                  <strong className={`ad-status ad-status-${selectedAgent.status.toLowerCase()}`}>{selectedAgent.status}</strong>
                </div>
              </div>
            )}

            <form className="ad-form-card" onSubmit={handleSubmit}>
              <div className="ad-form-heading">
                <h3>Agent details</h3>
                <span className={`ad-mode ad-mode-${mode}`}>{mode === 'view' ? 'Read only' : mode === 'edit' ? 'Editing' : 'New'}</span>
              </div>
              <div className="ad-form-grid">
                <label className="ad-field">
                  <span>Name <b>*</b></span>
                  <input
                    value={readOnly ? selectedAgent?.name || '' : form.name}
                    onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                    readOnly={readOnly}
                    required
                    maxLength={200}
                    placeholder="Agent or distributor name"
                  />
                </label>
                <label className="ad-field">
                  <span>Phone</span>
                  <input
                    type="tel"
                    value={readOnly ? selectedAgent?.phone || '' : form.phone}
                    onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                    readOnly={readOnly}
                    placeholder="Phone number"
                  />
                </label>
                <label className="ad-field ad-field-wide">
                  <span>Address</span>
                  <textarea
                    value={readOnly ? selectedAgent?.address || '' : form.address}
                    onChange={(event) => setForm((prev) => ({ ...prev, address: event.target.value }))}
                    readOnly={readOnly}
                    rows={4}
                    placeholder="Business address"
                  />
                </label>
              </div>

              {message && <p className="ad-message" role="status">{message}</p>}

              {(mode === 'edit' || mode === 'create') && (
                <div className="ad-form-actions">
                  <button type="button" className="ad-secondary-btn" onClick={cancelEdit}>Cancel</button>
                  <button type="submit" className="ad-primary-btn" disabled={!form.name.trim() || isSaving}>
                    {isSaving ? 'Saving…' : mode === 'create' ? 'Create agent' : 'Save changes'}
                  </button>
                </div>
              )}
            </form>
          </>
        )}
      </section>
    </div>
  );
}
