import React, { useEffect, useRef } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import '../styles/ConfirmDialog.css';

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  danger = false,
  hideCancel = false,
  onConfirm,
  onCancel,
}) {
  const confirmBtnRef = useRef(null);

  useEffect(() => {
    confirmBtnRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onConfirm, onCancel]);

  return (
    <div className="cfd-overlay" onClick={onCancel}>
      <div className="cfd-panel" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
        <div className="cfd-header-row">
          <div className={`cfd-icon ${danger ? 'cfd-icon-danger' : ''}`}>
            {danger ? <AlertTriangle size={20} /> : <HelpCircle size={20} />}
          </div>
          {title && <div className="cfd-title">{title}</div>}
        </div>
        <p className="cfd-message">{message}</p>
        <div className="cfd-actions">
          {!hideCancel && (
            <button type="button" className="cfd-btn-cancel" onClick={onCancel}>{cancelLabel}</button>
          )}
          <button
            ref={confirmBtnRef}
            type="button"
            className={`cfd-btn-confirm ${danger ? 'cfd-btn-confirm-danger' : ''}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}