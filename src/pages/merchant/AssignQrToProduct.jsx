// src/pages/merchant/AssignQrToProduct.jsx
import React, { useState, useRef, useEffect } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { QrCode as QrCodeIcon, Trash2, X } from 'lucide-react';
import { apiFetch } from '../../utils/api';
import '../../styles/AssignQrToProduct.css';

export default function AssignQrToProduct() {
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState('');
  const [variantId, setVariantId] = useState('');

  const [scanCart, setScanCart] = useState([]);
  const [qrUrlInput, setQrUrlInput] = useState('');
  const [scanError, setScanError] = useState('');

  const [batchNumber, setBatchNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');

  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const html5QrRef = useRef(null);
  const lastScannedRef = useRef('');
  const qrUrlInputRef = useRef(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState('');

  useEffect(() => {
    apiFetch('/api/products')
      .then((res) => res.json())
      .then((data) => setProducts(data))
      .catch((err) => console.error('Failed to load products:', err));
  }, []);

  useEffect(() => {
    return () => {
      if (html5QrRef.current) html5QrRef.current.stop().catch(() => {});
    };
  }, []);

  const selectedProduct = products.find((p) => p.product_id === productId);
  const variantOptions = selectedProduct ? selectedProduct.variants : [];

  const handleProductChange = (e) => {
    setProductId(e.target.value);
    setVariantId('');
  };

  // Backend checks the value against BOTH serial_number and qr_value,
  // so a single field/param can accept either — no need to distinguish.
  const addToCart = async (value) => {
    setScanError('');

    const alreadyScanned = scanCart.some(
      (item) => item.serial_number === value || item.qr_value === value
    );
    if (alreadyScanned) {
      setScanError('This code has already been scanned in this batch.');
      return;
    }

    try {
      const res = await apiFetch(`/api/qrcode/scan-lookup?serial_number=${encodeURIComponent(value)}`);
      const result = await res.json();

      if (!res.ok) {
        setScanError(result.message || 'Could not recognize this code.');
        return;
      }

      setScanCart((prev) => [...prev, result]);
    } catch (err) {
      setScanError('Could not reach server. Check it is running.');
      console.error(err);
    }
  };

  const handleQrUrlSubmit = (e) => {
    e.preventDefault();
    if (!qrUrlInput.trim()) return;
    addToCart(qrUrlInput.trim());
    setQrUrlInput('');
  };

  const removeFromCart = (qrId) => {
    setScanCart((prev) => prev.filter((item) => item.qr_id !== qrId));
  };

  const clearCart = () => {
    setScanCart([]);
    setScanError('');
    setSubmitMessage('');
  };

  const toggleCamera = async () => {
    if (isCameraOpen) {
      if (html5QrRef.current) {
        await html5QrRef.current.stop().then(() => html5QrRef.current.clear()).catch(() => {});
      }
      setIsCameraOpen(false);
      return;
    }

    setScanError('');
    lastScannedRef.current = '';
    setIsCameraOpen(true);

    setTimeout(async () => {
      try {
        const html5Qr = new Html5Qrcode('assign-qr-reader');
        html5QrRef.current = html5Qr;

        await html5Qr.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (decodedText) => {
            const trimmed = decodedText.trim();
            if (trimmed === lastScannedRef.current) return;
            lastScannedRef.current = trimmed;
            addToCart(trimmed);
          },
          () => {}
        );
      } catch (err) {
        setScanError('Could not access camera. Check permissions and try again.');
        setIsCameraOpen(false);
      }
    }, 0);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitMessage('');

    if (scanCart.length === 0) {
      setSubmitMessage('Scan at least one QR code first.');
      return;
    }
    if (!variantId) {
      setSubmitMessage('Select a product and variant.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiFetch('/api/qrcode/assign-scan', {
        method: 'POST',
        body: JSON.stringify({
          qr_ids: scanCart.map((item) => item.qr_id),
          variant_id: variantId,
          remarks: batchNumber.trim() || null,
          expiry_date: expiryDate || null,
        }),
      });
      const result = await res.json();

      if (!res.ok) {
        setSubmitMessage(result.message || 'Could not assign codes.');
        return;
      }

      setSubmitMessage(`${result.assigned_count} code(s) assigned to product.`);
      setScanCart([]);
      setBatchNumber('');
      setExpiryDate('');
      setProductId('');
      setVariantId('');
      qrUrlInputRef.current?.focus();
    } catch (err) {
      setSubmitMessage('Could not reach server. Check it is running.');
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const lastScannedSerial = scanCart.length > 0 ? scanCart[scanCart.length - 1].serial_number : '';
  const isValid = scanCart.length > 0 && Boolean(variantId);

  return (
    <div className="listing-page">
      <div className="listing-page-header">
        <h2>Scan QR Code</h2>
        <p className="listing-breadcrumb">Product InfoCenter / Assign QR to Product</p>
      </div>

      <div className="listing-card">
        <form onSubmit={handleSubmit} className="assign-qr-form">
          <div className="assign-qr-grid">
            <div className="form-group">
              <label>
                Serial / Label Number(s) Quantity scanned:{' '}
                <span className="assign-qr-count">{scanCart.length}</span>
                <span className="required-asterisk">*</span>
              </label>
              <input
                type="text"
                className="assign-qr-serial-display"
                value={lastScannedSerial}
                placeholder="Scanned serial number will appear here"
                readOnly
                disabled
              />
            </div>

            <div className="form-group form-group-wide">
              <label>QR Code</label>
              <div className="assign-qr-input-with-icon">
                <input
                  ref={qrUrlInputRef}
                  type="text"
                  value={qrUrlInput}
                  onChange={(e) => setQrUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleQrUrlSubmit(e);
                  }}
                  placeholder="Point scanner here, or paste/type a serial number or QR value..."
                  autoFocus
                />
                <button
                  type="button"
                  className="assign-qr-icon-btn"
                  onClick={toggleCamera}
                  aria-label="Scan with camera"
                >
                  <QrCodeIcon size={18} />
                </button>
              </div>
              <p className="assign-qr-hint">You can either enter the QR code url or scan the QR code.</p>

              {isCameraOpen && (
                <div className="assign-qr-camera-block">
                  <div id="assign-qr-reader" className="assign-qr-reader-box" />
                  <button type="button" className="btn-secondary" onClick={toggleCamera}>
                    Stop Camera
                  </button>
                </div>
              )}
            </div>

            <div className="form-group">
              <label>Remark / Batch Number</label>
              <input
                type="text"
                value={batchNumber}
                onChange={(e) => setBatchNumber(e.target.value.slice(0, 255))}
                maxLength={255}
              />
              <span className="assign-qr-char-count">{batchNumber.length} / 255</span>
            </div>

            <div className="form-group">
              <label>Expiry Date</label>
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>Product <span className="required-asterisk">*</span></label>
              <select value={productId} onChange={handleProductChange}>
                <option value="">-- Select Product --</option>
                {products.map((p) => (
                  <option key={p.product_id} value={p.product_id}>{p.product_name}</option>
                ))}
              </select>
            </div>

            {productId && (
              <div className="form-group">
                <label>Variant <span className="required-asterisk">*</span></label>
                <select value={variantId} onChange={(e) => setVariantId(e.target.value)}>
                  <option value="">-- Select Variant --</option>
                  {variantOptions.map((v) => (
                    <option key={v.variant_id} value={v.variant_id}>{v.sku}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {scanCart.length > 0 && (
            <div className="assign-qr-scanned-list">
              <div className="assign-qr-scanned-header">
                <span>Scanned Codes ({scanCart.length})</span>
                <button type="button" className="btn-clear-all" onClick={clearCart}>
                  <Trash2 size={14} /> Clear
                </button>
              </div>
              <ul>
                {scanCart.map((item) => (
                  <li key={item.qr_id}>
                    <span className="assign-qr-serial">{item.serial_number}</span>
                    <button
                      type="button"
                      className="assign-qr-remove"
                      onClick={() => removeFromCart(item.qr_id)}
                      aria-label="Remove"
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {scanError && <p className="error-text">{scanError}</p>}
          {submitMessage && <p className="status-text">{submitMessage}</p>}

          <div className="assign-qr-actions">
            <button type="submit" className="btn-primary" disabled={!isValid || isSubmitting}>
              {isSubmitting ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}