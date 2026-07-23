// src/components/StockManager.jsx
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import { ScanBarcode, Trash2, X, Info } from 'lucide-react';
import { apiFetch } from '../../utils/api';
import '../../styles/StockManager.css';

const ACTIONS = [
  { value: 'RECEIVE', label: 'Receive (into a store)' },
  { value: 'TRANSFER', label: 'Transfer (store to store)' },
  { value: 'CHECKOUT', label: 'Checkout (out of a store)' },
];

function attributesObjectToArray(attributesObject) {
  if (!attributesObject) return [];
  return Object.entries(attributesObject).map(([key, value]) => ({ key, value }));
}



export default function StockManager() {
  const navigate = useNavigate();
  const [stores, setStores] = useState([]);

  useEffect(() => {
    apiFetch('/api/stores')
      .then((res) => res.json())
      .then((data) => setStores(data))
      .catch((err) => console.error('Failed to load stores:', err));
  }, []);

  // --- Adjustment Details (required before any scanning) -----------------
  const [action, setAction] = useState('');
  const [targetStore, setTargetStore] = useState(''); // used for RECEIVE / CHECKOUT
  const [fromStore, setFromStore] = useState('');      // used for TRANSFER
  const [toStore, setToStore] = useState('');          // used for TRANSFER
  const [configError, setConfigError] = useState('');

  const isTransfer = action === 'TRANSFER';
  const isConfigValid = isTransfer
    ? Boolean(fromStore && toStore && fromStore !== toStore)
    : Boolean(action && targetStore);

  const resetCartIfDirty = () => {
    if (scanCart.length > 0) {
      const confirmed = window.confirm(
        'Changing the action or store will clear your current scan batch. Continue?'
      );
      if (!confirmed) return false;
      setScanCart([]);
      setScanError('');
      setSubmitMessage('');
    }
    return true;
  };

  const handleActionChange = (e) => {
    if (!resetCartIfDirty()) return;
    setAction(e.target.value);
    setTargetStore('');
    setFromStore('');
    setToStore('');
    setConfigError('');
  };

  const handleTargetStoreChange = (e) => {
    if (!resetCartIfDirty()) return;
    setTargetStore(e.target.value);
    setConfigError('');
  };

  const handleFromStoreChange = (e) => {
    if (!resetCartIfDirty()) return;
    setFromStore(e.target.value);
    setConfigError('');
  };

  const handleToStoreChange = (e) => {
    if (!resetCartIfDirty()) return;
    setToStore(e.target.value);
    setConfigError('');
  };

  // --- Scan cart — each entry is one physical unit already validated
  // against the backend via serial_number. -------------------------------
  const [scanCart, setScanCart] = useState([]);
  const [scanError, setScanError] = useState('');
  const lastScannedRef = useRef('');
  const [isScanning, setIsScanning] = useState(false);
  const [scannerInput, setScannerInput] = useState('');
  const scannerInputRef = useRef(null);

  const [submitMessage, setSubmitMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const scannerRef = useRef(null);
  const html5QrRef = useRef(null);

  const [qrValueInput, setQrValueInput] = useState('');
const qrValueInputRef = useRef(null);

  const addToCart = async (value, lookupType = 'serial_number') => {
  if (!isConfigValid) {
    setConfigError('Please select an action and target store before scanning.');
    return;
  }
  setScanError('');

  const alreadyScanned = scanCart.some(
    (item) => item.serial_number === value || item.qr_value === value
  );
  if (alreadyScanned) {
    setScanError('This code has already been scanned in this batch.');
    return;
  }

  try {
    const queryParam =
      lookupType === 'qr_value'
        ? `qr_value=${encodeURIComponent(value)}`
        : `serial_number=${encodeURIComponent(value)}`;

    const res = await apiFetch(`/api/transactions/scan-lookup?${queryParam}`);
    const result = await res.json();

    if (!res.ok) {
      setScanError(result.message || 'Could not recognize this code.');
      return;
    }

    if (scanCart.length > 0 && scanCart[0].variant_id !== result.variant_id) {
      setScanError('All scanned units in one batch must be the same product variant.');
      return;
    }

    setScanCart((prev) => [...prev, result]);
  } catch (err) {
    setScanError('Could not reach server. Check it is running.');
    console.error(err);
  }
};

  const removeFromCart = (qrId) => {
    setScanCart((prev) => prev.filter((item) => item.qr_id !== qrId));
  };

  const clearCart = () => {
    setScanCart([]);
    setScanError('');
    setSubmitMessage('');
  };

const handleScannerInputSubmit = (e) => {
  e.preventDefault();
  if (!scannerInput.trim()) return;
  addToCart(scannerInput.trim(), 'serial_number');
  setScannerInput('');
};

const handleQrValueInputSubmit = (e) => {
  e.preventDefault();
  if (!qrValueInput.trim()) return;
  addToCart(qrValueInput.trim(), 'qr_value');
  setQrValueInput('');
};

  const startScanner = async () => {
    if (!isConfigValid) {
      setConfigError('Please select an action and target store before scanning.');
      return;
    }
    setScanError('');
    lastScannedRef.current = '';
    setIsScanning(true);

    setTimeout(async () => {
      try {
        const html5Qr = new Html5Qrcode('qr-reader');
        html5QrRef.current = html5Qr;

        await html5Qr.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (decodedText) => {
  const trimmed = decodedText.trim();
  if (trimmed === lastScannedRef.current) return;
  lastScannedRef.current = trimmed;
  addToCart(trimmed, 'qr_value'); // camera reads the encoded qr_value
},
          () => {}
        );
      } catch (err) {
        setScanError('Could not access camera. Check permissions and try again.');
        setIsScanning(false);
      }
    }, 0);
  };

  const stopScanner = () => {
    if (html5QrRef.current) {
      html5QrRef.current
        .stop()
        .then(() => html5QrRef.current.clear())
        .catch(() => {});
    }
    setIsScanning(false);
  };

  useEffect(() => {
    return () => {
      if (html5QrRef.current) html5QrRef.current.stop().catch(() => {});
    };
  }, []);

  // --- Submit ---------------------------------------------------------------

  const handleTransactionSubmit = async (e) => {
    e.preventDefault();
    setSubmitMessage('');

    if (!isConfigValid) {
      setConfigError('Please select an action and target store before scanning.');
      return;
    }
    if (scanCart.length === 0) {
      setSubmitMessage('Scan at least one unit first.');
      return;
    }

    const from_store_id = action === 'CHECKOUT' ? targetStore : (isTransfer ? fromStore : null);
    const to_store_id = action === 'RECEIVE' ? targetStore : (isTransfer ? toStore : null);

    setIsSubmitting(true);
    try {
      const res = await apiFetch('/api/transactions/scan-move', {
        method: 'POST',
        body: JSON.stringify({
          qr_ids: scanCart.map((item) => item.qr_id),
          transaction_type: action,
          from_store_id,
          to_store_id,
        }),
      });
      const result = await res.json();

      if (!res.ok) {
        setSubmitMessage(result.message || 'Transaction failed.');
        return;
      }

      setSubmitMessage(`${result.count} units recorded.`);
      setScanCart([]);
    } catch (err) {
      setSubmitMessage('Could not reach server. Check it is running.');
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    if (scanCart.length > 0 && !window.confirm('Discard this scan batch?')) return;
    setScanCart([]);
    setAction('');
    setTargetStore('');
    setFromStore('');
    setToStore('');
    setScanError('');
    setSubmitMessage('');
    navigate('/dashboard');
  };

  const targetStoreName = stores.find((s) => s.store_id === targetStore)?.location;
  const fromStoreName = stores.find((s) => s.store_id === fromStore)?.location;
  const toStoreName = stores.find((s) => s.store_id === toStore)?.location;

  const configSummaryText = isConfigValid
    ? isTransfer
      ? `Ready to scan for Transfer — ${fromStoreName} → ${toStoreName}`
      : `Ready to scan for ${ACTIONS.find((a) => a.value === action)?.label} at ${targetStoreName}`
    : '';

  return (
    <div className="stock-manager-v2">
      {/* Adjustment Details — single compact card */}
      <section className="sm-card">
        <div className="sm-card-header">
          <ScanBarcode size={18} />
          <h2>Adjustment Details</h2>
        </div>

        <div className="sm-details-row">
          <div className="form-group">
            <label>Action <span className="required-asterisk">*</span></label>
            <select value={action} onChange={handleActionChange}>
              <option value="">-- Select Action --</option>
              {ACTIONS.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
          </div>

          {!isTransfer ? (
            <div className="form-group">
              <label>Target Store <span className="required-asterisk">*</span></label>
              <select value={targetStore} onChange={handleTargetStoreChange} disabled={!action}>
                <option value="">-- Select Store --</option>
                {stores.map((s) => (
                  <option key={s.store_id} value={s.store_id}>{s.location}</option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div className="form-group">
                <label>From Store <span className="required-asterisk">*</span></label>
                <select value={fromStore} onChange={handleFromStoreChange}>
                  <option value="">-- Select Store --</option>
                  {stores.map((s) => (
                    <option key={s.store_id} value={s.store_id}>{s.location}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>To Store <span className="required-asterisk">*</span></label>
                <select value={toStore} onChange={handleToStoreChange}>
                  <option value="">-- Select Store --</option>
                  {stores.map((s) => (
                    <option key={s.store_id} value={s.store_id}>{s.location}</option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>

        {configSummaryText && <p className="sm-status-banner">{configSummaryText}</p>}
        {configError && <p className="error-text">{configError}</p>}
      </section>

      {/* Scan section — compact bar, not a big empty panel */}
      <section className={`sm-card ${!isConfigValid ? 'sm-card-disabled' : ''}`}>
        <div className="sm-card-header">
          <ScanBarcode size={18} />
          <h2>Scan Units</h2>
        </div>

        <div className="sm-scan-row">
  {!isScanning ? (
    <>
      <form className="sm-scan-input-form" onSubmit={handleScannerInputSubmit}>
        <ScanBarcode size={18} className="sm-scan-input-icon" />
        <input
          ref={scannerInputRef}
          type="text"
          value={scannerInput}
          onChange={(e) => setScannerInput(e.target.value)}
          placeholder="Point scanner here or type serial number or qr value..."
          disabled={!isConfigValid}
          autoFocus
        />
        {scannerInput && (
          <button type="button" className="sm-input-clear" onClick={() => setScannerInput('')} aria-label="Clear input">
            <X size={14} />
          </button>
        )}
      </form>

      <button className="btn-secondary sm-camera-btn" onClick={startScanner} disabled={!isConfigValid}>
        Use Camera
      </button>
    </>
  ) : (
    <div className="sm-scanner-active">
      <div id="qr-reader" ref={scannerRef} className="qr-reader-box" />
      <button className="btn-secondary" onClick={stopScanner}>
        Stop Camera
      </button>
    </div>
  )}

  <button className="btn-clear-all" onClick={clearCart} disabled={scanCart.length === 0} type="button">
    <Trash2 size={16} />
    Clear Batch
  </button>
</div>

{/* NEW: second row for scanning/typing the QR value directly */}
{/*
<div className="sm-scan-row">
  <form className="sm-scan-input-form" onSubmit={handleQrValueInputSubmit}>
    <ScanBarcode size={18} className="sm-scan-input-icon" />
    <input
      ref={qrValueInputRef}
      type="text"
      value={qrValueInput}
      onChange={(e) => setQrValueInput(e.target.value)}
      placeholder="Point scanner here or Type QR value..."
      disabled={!isConfigValid}
    />
    {qrValueInput && (
      <button type="button" className="sm-input-clear" onClick={() => setQrValueInput('')} aria-label="Clear input">
        <X size={14} />
      </button>
    )}
  </form>
</div> */}

        <p className="sm-hint">
          <Info size={13} />
          Use a hardware barcode/QR scanner, laptop or mobile camera, or type the serial number manually. Each unit is looked up automatically.
        </p>

        {scanError && <p className="error-text">{scanError}</p>}
      </section>

      {/* Scanned units — compact table */}
      <section className="sm-card">
        <h2 className="sm-total-scanned">Total Units Scanned: {scanCart.length}</h2>

        <div className="sm-table-wrapper">
          <table className="sm-scan-table">
            <thead>
              <tr>
                <th>No.</th>
                <th>Serial Number</th>
                <th>SKU</th>
                <th>Product Name</th>
                <th>Qty</th>
                <th>Remove</th>
              </tr>
            </thead>
            <tbody>
              {scanCart.length === 0 ? (
                <tr>
                  <td colSpan={6} className="sm-empty-cell">
                    <ScanBarcode size={28} className="sm-empty-icon" />
                    <p>No items scanned yet. Scan units above.</p>
                  </td>
                </tr>
              ) : (
                scanCart.map((item, index) => (
                  <tr key={item.qr_id}>
                    <td data-label="No.">{index + 1}</td>
                    <td data-label="Serial Number" className="sm-serial-cell">{item.serial_number}</td>
                    <td data-label="SKU">{item.sku}</td>
                    <td data-label="Product Name">{item.product_name}</td>
                    <td data-label="Qty">1</td>
                    <td data-label="Remove">
                      <button className="btn-remove-small" onClick={() => removeFromCart(item.qr_id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {submitMessage && <p className="status-text sm-submit-message">{submitMessage}</p>}

      {/* Actions */}
      <div className="sm-actions-bar">
        <button
          className="btn-primary"
          onClick={handleTransactionSubmit}
          disabled={isSubmitting || scanCart.length === 0 || !isConfigValid}
        >
          {isSubmitting ? 'Submitting…' : `Submit ${scanCart.length} Unit${scanCart.length === 1 ? '' : 's'}`}
        </button>
        {/*<button className="btn-secondary" onClick={handleCancel} type="button">
          Cancel
        </button>*/}
      </div>
    </div>
  );
}