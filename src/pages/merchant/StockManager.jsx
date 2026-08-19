// src/pages/merchant/StockManager.jsx
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { ScanBarcode, Camera, X, Trash2, Info } from 'lucide-react';
import { apiFetch } from '../../utils/api';
import { formatDateTime, formatRelativeTime } from '../../utils/dateFormat';
import { useNavigate, useLocation } from 'react-router-dom';
import { useConfirm } from '../../context/ConfirmContext';

import '../../styles/StockManager.css';

const PAGE_SIZE = 10;
const RECENT_DAYS = 3;
const MAX_RANGE_SIZE = 500;



const ADJUSTMENT_TYPES = [
  { key: 'STOCK_IN', label: 'Stock In', hint: 'Receiving', icon: '+', txType: 'RECEIVE', enabled: true },
  { key: 'STOCK_OUT', label: 'Stock Out', hint: 'Sold', icon: '−', txType: 'CHECKOUT', enabled: true },
  { key: 'TRANSFER', label: 'Transfer', hint: 'Between stores', icon: '⇄', txType: 'TRANSFER', enabled: true },
  { key: 'DAMAGE', label: 'Damage', hint: 'Write-off', icon: '−', txType: 'DAMAGE', enabled: true },
  { key: 'CYCLE_COUNT', label: 'Cycle Count', hint: 'Recount', icon: '=', txType: 'CYCLE_COUNT', enabled: true },
];

const SOURCE_STORE_TYPES = ['STOCK_OUT', 'DAMAGE', 'CYCLE_COUNT'];

const REFERENCE_DOC_OPTIONS = [
  { value: '', label: '— None —' },
  { value: 'PO', label: 'Purchase order' },
  { value: 'DO', label: 'Delivery order' },
  { value: 'RT', label: 'Return note' },
  { value: 'OTHER', label: 'Other' },
];

function qtySign(typeKey) {
  if (typeKey === 'STOCK_OUT' || typeKey === 'DAMAGE') return { text: '-1', className: 'sa-qty-negative' };
  if (typeKey === 'CYCLE_COUNT') return { text: '=', className: 'sa-qty-neutral' };
  return { text: '+1', className: 'sa-qty-positive' }; // STOCK_IN, TRANSFER
}

function txTypeLabel(type) {
  switch (type) {
    case 'RECEIVE': return 'Stock In';
    case 'CHECKOUT': return 'Stock Out';
    case 'TRANSFER': return 'Transfer';
    case 'DAMAGE': return 'Damage';
    case 'CYCLE_COUNT': return 'Cycle Count';
    default: return type;
  }
}

export default function StockManager() {
  const [stores, setStores] = useState([]);
  const navigate = useNavigate();

  const storedUser = localStorage.getItem('authUser');
  const currentUser = storedUser ? JSON.parse(storedUser) : null;
  const isFullAccess = currentUser?.role === 'admin' || currentUser?.role === 'super_admin';
  const canCreateAdjustments = isFullAccess || (currentUser?.permissions?.['Stock Adjustment'] || []).includes('create');
  const canEditAdjustments = isFullAccess || (currentUser?.permissions?.['Stock Adjustment'] || []).includes('edit');
  useEffect(() => {
    apiFetch('/api/stores')
      .then((res) => res.json())
      // Closed (Inactive) stores can't receive or issue new stock —
      // exclude them from every adjustment-type store dropdown.
      .then((data) => setStores(data.filter((s) => s.status === 'Active')))
      .catch((err) => console.error('Failed to load stores:', err));
  }, []);

  // --- Adjustment type + stores + reference doc --------------------------
  const [selectedTypeKey, setSelectedTypeKey] = useState('');
  const [sourceStore, setSourceStore] = useState('');   // STOCK_IN / STOCK_OUT
  const [fromStore, setFromStore] = useState('');        // TRANSFER
  const [toStore, setToStore] = useState('');            // TRANSFER
  const [referenceDoc, setReferenceDoc] = useState('');
  const [comingSoonMessage, setComingSoonMessage] = useState('');
  const [configError, setConfigError] = useState('');
  const REVIEW_PAGE_SIZE = 10;
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [reviewRows, setReviewRows] = useState([]);
  const [reviewPage, setReviewPage] = useState(1);

  const selectedType = ADJUSTMENT_TYPES.find((t) => t.key === selectedTypeKey) || null;
  const isTransfer = selectedTypeKey === 'TRANSFER';

  const isConfigValid = selectedType?.enabled
    ? (isTransfer ? Boolean(fromStore && toStore && fromStore !== toStore) : Boolean(sourceStore))
    : false;

  // --- Scan cart -----------------------------------------------------------
  const [scanCart, setScanCart] = useState([]);
  const [scanInput, setScanInput] = useState('');
  const scanCartRef = useRef([]);

  const [rangePrefix, setRangePrefix] = useState('');
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [isAddingRange, setIsAddingRange] = useState(false);
  
  const [page, setPage] = useState(1);
  const scanInputRef = useRef(null);

  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [scanSuccessMessage, setScanSuccessMessage] = useState('');
  const html5QrRef = useRef(null);
  const lastScannedRef = useRef('');
  const isScannerRunningRef = useRef(false);

  const [remark, setRemark] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState('');
  const RECENT_PAGE_SIZE = 5;
  // --- Recent adjustments --------------------------------------------------
  const [recentTx, setRecentTx] = useState([]);
  const [recentPage, setRecentPage] = useState(1);
  const [isLoadingRecent, setIsLoadingRecent] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedTx, setSelectedTx] = useState(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailStatusMessage, setDetailStatusMessage] = useState('');
  const [isProcessingDetail, setIsProcessingDetail] = useState(false);

  const loadRecent = () => {
    setIsLoadingRecent(true);
    apiFetch('/api/transactions')
      .then((res) => res.json())
      .then((data) => { setRecentTx(data); setRecentPage(1); })
      .catch((err) => console.error('Failed to load recent adjustments:', err))
      .finally(() => setIsLoadingRecent(false));
  };

  useEffect(() => { loadRecent(); }, []);

  useEffect(() => {
  scanCartRef.current = scanCart;
  }, [scanCart]);

  const openDetail = (t) => {
  setIsDetailOpen(true);
  setSelectedTx(t);
  setDetailError('');
  setDetailStatusMessage('');
  setIsLoadingDetail(true);
  apiFetch(`/api/transactions/${t.transaction_id}`)
    .then((res) => res.json())
    .then((data) => setSelectedTx(data))
    .catch((err) => {
      setDetailError('Could not reach server. Check it is running.');
      console.error(err);
    })
    .finally(() => setIsLoadingDetail(false));
};

const closeDetail = () => {
  setIsDetailOpen(false);
  setSelectedTx(null);
  setDetailError('');
  setDetailStatusMessage('');
};

const handleApproveDetail = async () => {
  if (!selectedTx) return;
  setIsProcessingDetail(true);
  setDetailStatusMessage('');
  try {
    const res = await apiFetch(`/api/transactions/${selectedTx.transaction_id}/approve`, { method: 'POST' });
    const result = await res.json();
    if (!res.ok) {
      setDetailStatusMessage(result.message || 'Could not approve.');
      return;
    }
    setDetailStatusMessage('Approved.');
    loadRecent();
    setTimeout(closeDetail, 700);
  } catch (err) {
    setDetailStatusMessage('Could not reach server. Check it is running.');
    console.error(err);
  } finally {
    setIsProcessingDetail(false);
  }
};

const handleRejectDetail = async () => {
  if (!selectedTx) return;
  setIsProcessingDetail(true);
  setDetailStatusMessage('');
  try {
    const res = await apiFetch(`/api/transactions/${selectedTx.transaction_id}/reject`, { method: 'POST' });
    const result = await res.json();
    if (!res.ok) {
      setDetailStatusMessage(result.message || 'Could not reject.');
      return;
    }
    setDetailStatusMessage('Rejected.');
    loadRecent();
    setTimeout(closeDetail, 700);
  } catch (err) {
    setDetailStatusMessage('Could not reach server. Check it is running.');
    console.error(err);
  } finally {
    setIsProcessingDetail(false);
  }
};

  

  // --- Type / store selection handlers -------------------------------------

  const confirm = useConfirm();
  // Alert-style dialog (dismiss-only) for scan-station notifications that
  // were easy to miss when shown as inline text below sa-scan-hints.
  const notify = (message, options = {}) => {
    confirm(message, { confirmLabel: 'OK', hideCancel: true, ...options });
  };

  const resetCartIfDirty = async () => {
    if (scanCart.length > 0) {
      const ok = await confirm(
        'Changing the adjustment type or store will clear your current batch. Continue?',
        { title: 'Discard Changes', confirmLabel: 'Continue', danger: true }
      );
      if (!ok) return false;
      setScanCart([]); setScanError(''); setSubmitMessage(''); setPage(1);
    }
    return true;
  };

  const handleSelectType = async (type) => {
    if (!canCreateAdjustments) return;
    if (!type.enabled) {
      setComingSoonMessage(`${type.label} isn't available yet — coming soon.`);
      setTimeout(() => setComingSoonMessage(''), 3000);
      return;
    }
    if (!(await resetCartIfDirty())) return;
    setSelectedTypeKey(type.key);
    setSourceStore('');
    setFromStore('');
    setToStore('');
    setReferenceDoc('');
    setConfigError('');
  };

  const handleSourceStoreChange = async (e) => {
    const value = e.target.value;
    if (!(await resetCartIfDirty())) return;
    setSourceStore(value);
    setConfigError('');
  };

  const handleFromStoreChange = async (e) => {
    const value = e.target.value;
    if (!(await resetCartIfDirty())) return;
    setFromStore(value);
    setConfigError('');
  };

  const handleToStoreChange = async (e) => {
    const value = e.target.value;
    if (!(await resetCartIfDirty())) return;
    setToStore(value);
    setConfigError('');
  };

  // --- Scanning --------------------------------------------------------------

  const addToCart = async (value) => {
  if (!canCreateAdjustments) return;
  if (!isConfigValid) {
    notify('Please select an adjustment type and store before scanning.');
    return;
  }
  

  const existingItem = scanCartRef.current.find(
  (item) => item.label_id === value || item.qr_id === value
  );
  if (existingItem) {
    notify(`"${existingItem.label_id}" already scanned.`, { title: 'Duplicate scan', danger: true });
    return;
  }

  // Which store this adjustment is "from", if any — matches the same
  // logic used to build the transaction payload on submit.
  const fromStoreForType = SOURCE_STORE_TYPES.includes(selectedTypeKey)
    ? sourceStore
    : (isTransfer ? fromStore : '');

  const lookup = async (storeIdOverride) => {
    const params = new URLSearchParams({
      serial_number: value,
      transaction_type: selectedType.txType,
    });
    const storeId = storeIdOverride ?? fromStoreForType;
    if (storeId) params.set('from_store_id', storeId);
    const res = await apiFetch(`/api/transactions/scan-lookup?${params.toString()}`);
    const result = await res.json();
    return { res, result };
  };

  try {
    const { res, result } = await lookup();

    if (!res.ok) {
      // Scanned an in-stock unit against the wrong source store — offer
      // to fix the store selection instead of just rejecting the scan.
      if (result.wrong_store) {
        const storeName = result.current_store_name || 'the correct store';
        const currentStoreId = SOURCE_STORE_TYPES.includes(selectedTypeKey) ? sourceStore : (isTransfer ? fromStore : '');
        const currentStoreName = stores.find((s) => s.store_id === currentStoreId)?.location || 'the currently selected store';

        // Batch already has units scanned from the currently selected store —
        // switching stores would silently mix two stores in one batch, so make
        // the trade-off explicit instead of auto-switching underneath the user.
        if (scanCart.length > 0) {
          const switchAndClear = await confirm(
            `${result.message}\n\nYour current batch has ${scanCart.length} unit(s) from "${currentStoreName}". Switching to "${storeName}" will clear that batch and start fresh with this code.`,
            {
              title: 'Different store',
              confirmLabel: `Switch & clear batch`,
              cancelLabel: `Keep "${currentStoreName}" batch`,
              danger: true,
            }
          );
          if (!switchAndClear) return; // keep the existing batch, skip this code entirely

          if (isTransfer) {
            setFromStore(result.current_store_id);
          } else {
            setSourceStore(result.current_store_id);
          }

          const retry = await lookup(result.current_store_id);
          if (!retry.res.ok) {
            notify(`"${value}": ${retry.result.message || 'Could not recognize this code.'}`, { title: 'Scan issue', danger: true });
            return;
          }
          setScanCart([retry.result]); // start fresh — old batch is discarded
          setPage(1);
          return;
        }

        // Batch is empty — no conflict, just confirm the store switch as before.
        const confirmed = await confirm(
          `${result.message}\n\nSwitch the source store to "${storeName}" and add this code?`,
          { title: 'Wrong store', confirmLabel: 'Switch & add' }
        );
        if (!confirmed) return;

        if (isTransfer) {
          setFromStore(result.current_store_id);
        } else {
          setSourceStore(result.current_store_id);
        }

        const retry = await lookup(result.current_store_id);
        if (!retry.res.ok) {
          notify(`"${value}": ${retry.result.message || 'Could not recognize this code.'}`, { title: 'Scan issue', danger: true });
          return;
        }
        setScanCart((prev) => {
          const next = [...prev, retry.result];
          scanCartRef.current = next;
          setPage(Math.ceil(next.length / PAGE_SIZE));
          return next;
        });
        return;
      }

      notify(`"${result.label_id || value}": ${result.message || 'Could not recognize this code.'}`, { title: 'Scan issue', danger: true });
      return;
    }

    

    setScanCart((prev) => {
      const next = [...prev, result];
      scanCartRef.current = next;
      setPage(Math.ceil(next.length / PAGE_SIZE));
      return next;
    });

    if (navigator.vibrate) navigator.vibrate(80);
    setScanSuccessMessage(`✓ ${result.label_id} added.`);
    setTimeout(() => setScanSuccessMessage(''), 2000);
    } catch (err) {
    notify('Could not reach server. Check it is running.', { title: 'Network error', danger: true });
    console.error(err);
  }
};

  const handleScanSubmit = (e) => {
    e.preventDefault();
    if (!scanInput.trim()) return;
    addToCart(scanInput.trim());
    setScanInput('');
  };

  // Batched version of addToCart used for adding MANY codes at once (serial
  // ranges). Instead of popping one alert dialog per failed/duplicate code —
  // which is what happened before when scanning a range that included
  // already-used codes — every code is looked up first, failures are
  // grouped by reason, and a single dialog lists exactly which codes
  // (e.g. "TE-021631") hit which problem. Mirrors the addManyToCart pattern
  // used on the Assign QR to Product page.
  const addManyToCart = async (values) => {
    if (!canCreateAdjustments) return;
    if (!isConfigValid) {
      notify('Please select an adjustment type and store before scanning.');
      return;
    }

    const fromStoreForType = SOURCE_STORE_TYPES.includes(selectedTypeKey)
      ? sourceStore
      : (isTransfer ? fromStore : '');

    let current = [...scanCart];
    const failures = [];
    let successCount = 0;

    for (const raw of values) {
      const value = raw.trim();
      if (!value) continue;

      const alreadyScanned = current.some(
        (item) => item.label_id === value || item.qr_id === value
      );
      if (alreadyScanned) {
        failures.push({ value, message: 'already scanned' });
        continue;
      }

      try {
        const params = new URLSearchParams({
          serial_number: value,
          transaction_type: selectedType.txType,
        });
        if (fromStoreForType) params.set('from_store_id', fromStoreForType);

        const res = await apiFetch(`/api/transactions/scan-lookup?${params.toString()}`);
        const result = await res.json();

        if (!res.ok) {
        failures.push({ value: result.label_id || value, message: result.message || 'could not be recognized' });
        continue;
      }

        current = [...current, result];
        successCount++;
      } catch (err) {
        failures.push({ value, message: 'could not reach server' });
        console.error(err);
      }
    }

    setScanCart(current);
    setPage(Math.max(1, Math.ceil(current.length / PAGE_SIZE)));

    if (successCount > 0) {
      if (navigator.vibrate) navigator.vibrate(80);
      setScanSuccessMessage(`✓ ${successCount} code${successCount === 1 ? '' : 's'} added.`);
      setTimeout(() => setScanSuccessMessage(''), 2500);
    }

    if (failures.length > 0) {
      const grouped = {};
      failures.forEach(({ value, message }) => {
        (grouped[message] ||= []).push(value);
      });
      const text = Object.entries(grouped)
        .map(([message, codes]) => {
          const shown = codes.slice(0, 8).join(', ');
          const more = codes.length > 8 ? ` +${codes.length - 8} more` : '';
          return `${codes.length} code${codes.length === 1 ? '' : 's'} ${message}: ${shown}${more}`;
        })
        .join('\n');
      notify(text, { title: 'Scan issue', danger: true });
    }

    return { successCount, failures };
  };

  const handleAddRange = async (e) => {
  e.preventDefault();

  if (!isConfigValid) {
    notify('Please select an adjustment type and store before scanning.');
    return;
  }

  const fromStr = rangeFrom.trim();
  const toStr = rangeTo.trim();

  if (!/^\d+$/.test(fromStr) || !/^\d+$/.test(toStr)) {
    notify('"From" and "To" must be numbers only.', { title: 'Invalid range', danger: true });
    return;
  }

  const width = Math.max(fromStr.length, toStr.length);
  const fromNum = parseInt(fromStr, 10);
  const toNum = parseInt(toStr, 10);

  if (fromNum > toNum) {
    notify('"From" must be less than or equal to "To".', { title: 'Invalid range', danger: true });
    return;
  }
  if (toNum - fromNum + 1 > MAX_RANGE_SIZE) {
    notify(`Please scan ${MAX_RANGE_SIZE} codes or fewer at a time.`, { title: 'Range too large', danger: true });
    return;
  }

  const prefix = rangePrefix.trim();
  const serials = [];
  for (let n = fromNum; n <= toNum; n++) {
    const padded = String(n).padStart(width, '0');
    serials.push(prefix ? `${prefix}-${padded}` : padded);
  }

  setIsAddingRange(true);
  try {
    await addManyToCart(serials);
    setRangeFrom('');
    setRangeTo('');
  } finally {
    setIsAddingRange(false);
  }
};

  const removeFromCart = (qrBatch) => {
    setScanCart((prev) => {
      const next = prev.filter((item) => item.qr_batch !== qrBatch);
      scanCartRef.current = next;
      const totalPages = Math.max(1, Math.ceil(next.length / PAGE_SIZE));
      setPage((p) => Math.min(p, totalPages));
      return next;
    });
  };

  const clearCart = () => {
    setScanCart([]);
    setSubmitMessage('');
    scanCartRef.current = next;
    setPage(1);
  };

  const toggleCamera = async () => {
    if (!canCreateAdjustments) return;
    if (isCameraOpen) {
      if (html5QrRef.current && isScannerRunningRef.current) {
        try {
          await html5QrRef.current.stop();
          await html5QrRef.current.clear();
        } catch (e) {
          // ignore — scanner may already be stopped
        }
      }
      isScannerRunningRef.current = false;
      setIsCameraOpen(false);
      return;
    }

    if (!isConfigValid) {
      notify('Please select an adjustment type and store before scanning.');
      return;
    }

    lastScannedRef.current = '';
    setIsCameraOpen(true);

    setTimeout(async () => {
      try {
        const html5Qr = new Html5Qrcode('sa-qr-reader');
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
        isScannerRunningRef.current = true;
      } catch (err) {
        notify('Could not access camera. Check permissions and try again.', { title: 'Camera error', danger: true });
        setIsCameraOpen(false);
      }
    }, 0);
  };

  useEffect(() => {
    return () => {
      if (html5QrRef.current && isScannerRunningRef.current) {
        try {
          html5QrRef.current.stop().catch(() => {});
        } catch (e) {
          // ignore synchronous throw
        }
      }
      isScannerRunningRef.current = false;
    };
  }, []);

  // --- Pagination ------------------------------------------------------------

  const totalPages = Math.max(1, Math.ceil(scanCart.length / PAGE_SIZE));
  const pagedCart = scanCart.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const handlePageChange = (next) => {
    if (next < 1 || next > totalPages) return;
    setPage(next);
  };
  const recentTotalPages = Math.max(1, Math.ceil(recentTx.length / RECENT_PAGE_SIZE));
  const pagedRecentTx = recentTx.slice((recentPage - 1) * RECENT_PAGE_SIZE, recentPage * RECENT_PAGE_SIZE);
  const handleRecentPageChange = (next) => {
    if (next < 1 || next > recentTotalPages) return;
    setRecentPage(next);
  };

  // --- Review summary --------------------------------------------------------

  const distinctSkuCount = useMemo(
    () => new Set(scanCart.map((i) => i.variant_id)).size,
    [scanCart]
  );

  const sourceStoreName = stores.find((s) => s.store_id === sourceStore)?.location;
  const fromStoreName = stores.find((s) => s.store_id === fromStore)?.location;
  const toStoreName = stores.find((s) => s.store_id === toStore)?.location;

  const storeSummaryText = !selectedType
    ? 'Not set'
    : isTransfer
      ? `${fromStoreName || '—'} → ${toStoreName || '—'}`
      : sourceStoreName || 'Not set';

    const reviewFromStoreName = SOURCE_STORE_TYPES.includes(selectedTypeKey)
      ? sourceStoreName
      : (isTransfer ? fromStoreName : null);
    const reviewToStoreName = selectedTypeKey === 'STOCK_IN' ? sourceStoreName : (isTransfer ? toStoreName : null);

    const reviewTotalPages = Math.max(1, Math.ceil(reviewRows.length / REVIEW_PAGE_SIZE));
    const pagedReviewRows = reviewRows.slice(
      (reviewPage - 1) * REVIEW_PAGE_SIZE,
      reviewPage * REVIEW_PAGE_SIZE
    );

  const netChangeText = (() => {
    if (scanCart.length === 0) return '0 units';
    if (selectedTypeKey === 'STOCK_OUT' || selectedTypeKey === 'DAMAGE') return `-${scanCart.length} units`;
    if (selectedTypeKey === 'TRANSFER') return `+${scanCart.length} units`;
    return `+${scanCart.length} units`;
  })();

  const netChangeClass = (() => {
    if (scanCart.length === 0) return '';
    if (selectedTypeKey === 'STOCK_OUT' || selectedTypeKey === 'DAMAGE') return 'sa-net-negative';
    return 'sa-net-positive';
  })();

  // --- Submit ------------------------------------------------------------------

    const openReview = () => {
      if (!canCreateAdjustments) return;
      setSubmitMessage('');
      if (!isConfigValid) {
        notify('Please select an adjustment type and store before submitting.');
        return;
      }
      if (scanCart.length === 0) {
        notify('Scan at least one unit first.');
        return;
      }
      setReviewRows(scanCart.map((item) => ({ ...item })));
      setReviewPage(1);
      setIsReviewOpen(true);
    };

    const removeReviewRow = (qrBatch) => {
      setReviewRows((prev) => prev.filter((r) => r.qr_batch !== qrBatch));
    };

    const rejectReview = () => {
      setIsReviewOpen(false);
      setReviewRows([]);
      setScanCart([]);
      setPage(1);
      setSubmitMessage('Batch discarded.');
    };

    const confirmReview = async () => {
        if (reviewRows.length === 0) {
          setIsReviewOpen(false);
          return;
        }

        const from_store_id = SOURCE_STORE_TYPES.includes(selectedTypeKey)
          ? sourceStore
          : (isTransfer ? fromStore : null);
        const to_store_id = selectedTypeKey === 'STOCK_IN'
          ? sourceStore
          : (isTransfer ? toStore : null);

        setIsSubmitting(true);
        setSubmitMessage('');

        // The backend records one transaction per variant, so a mixed-product
        // batch is split into one scan-move call per variant here — still a
        // single Submit action from the user's point of view.
        const groups = {};
        reviewRows.forEach((item) => {
          (groups[item.variant_id] ||= []).push(item.qr_batch);
        });

        try {
          const results = await Promise.all(
            Object.values(groups).map((qrIds) =>
              apiFetch('/api/transactions/scan-move', {
                method: 'POST',
                body: JSON.stringify({
                  qr_ids: qrIds,
                  transaction_type: selectedType.txType,
                  from_store_id,
                  to_store_id,
                  reference_doc: !isTransfer ? (referenceDoc || null) : null,
                }),
              }).then(async (res) => ({ res, result: await res.json() }))
            )
          );

          const failed = results.find(({ res }) => !res.ok);
          if (failed) {
            notify(failed.result.message || 'Adjustment failed for one of the scanned products.', {
              title: 'Adjustment failed',
              danger: true,
            });
            return;
          }

          const totalCount = results.reduce((sum, { result }) => sum + (result.count || 0), 0);
          const needsApproval = ['DAMAGE', 'CYCLE_COUNT'].includes(selectedType.txType);

          setSubmitMessage(
            needsApproval
              ? `${totalCount} unit(s) submitted — awaiting approval.`
              : `${totalCount} unit(s) recorded.`
          );

          setScanCart([]);
          setPage(1);
          setIsReviewOpen(false);
          setReviewRows([]);
          loadRecent();
        } catch (err) {
          notify('Could not reach server. Check it is running.', { title: 'Network error', danger: true });
          console.error(err);
        } finally {
          setIsSubmitting(false);
        }
      };

  const handleDiscard = async () => {
    if (scanCart.length > 0) {
      const ok = await confirm('Discard this batch and reset the form?', {
        title: 'Discard Changes', 
        confirmLabel: 'Discard',
        danger: true,
      });
      if (!ok) return;
    }
    setScanCart([]);
    setSelectedTypeKey('');
    setSourceStore('');
    setFromStore('');
    setToStore('');
    setReferenceDoc('');
    setRemark('');
    setScanError('');
    setSubmitMessage('');
    setConfigError('');
    setPage(1);
  };

  // --- Recent adjustments row shaping -----------------------------------------

    function recentRowInfo(t) {
      const qty = Number(t.qty);
      const label =
        t.transaction_type === 'RECEIVE' ? `Stock In · ${t.to_store_name || '—'}`
        : t.transaction_type === 'CHECKOUT' ? `Stock Out · ${t.from_store_name || '—'}`
        : t.transaction_type === 'DAMAGE' ? `Damage · ${t.from_store_name || '—'}`
        : t.transaction_type === 'CYCLE_COUNT' ? `Cycle Count · ${t.from_store_name || '—'}`
        : `Transfer · ${t.from_store_name || '—'} → ${t.to_store_name || '—'}`;

      const negative = ['CHECKOUT', 'DAMAGE', 'CYCLE_COUNT'].includes(t.transaction_type);
      const delta = `${negative ? '-' : '+'}${qty}`;
      const deltaClass = negative ? 'sa-net-negative' : 'sa-net-positive';

      const approval = t.approval_status || 'approved';
      const statusLabel = approval === 'pending' ? 'Pending' : approval === 'rejected' ? 'Rejected' : 'Approved';
      const statusClass =
        approval === 'pending' ? 'sa-status-pending'
        : approval === 'rejected' ? 'sa-status-rejected'
        : 'sa-status-approved';

      return { label, delta, className: deltaClass, statusLabel, statusClass };
    }

  return (
    <div className="sa-page">
      {/* ============================ LEFT COLUMN ============================ */}
      <div className="sa-left">
        {/* --- Adjustment type + stores --- */}
        <section className="sa-card">
          <h2 className="sa-card-title">
            Adjustment type <span className="sa-required">*</span>
          </h2>

          <div className="sa-type-grid">
            {ADJUSTMENT_TYPES.map((type) => (
              <button
                  key={type.key}
                  type="button"
                  className={`sa-type-card ${selectedTypeKey === type.key ? 'sa-type-card-active' : ''} ${!type.enabled || !canCreateAdjustments ? 'sa-type-card-disabled' : ''}`}
                  onClick={() => handleSelectType(type)}
                  disabled={!canCreateAdjustments}
                >
                <span className="sa-type-icon">{type.icon}</span>
                <span className="sa-type-title">{type.label}</span>
                <span className="sa-type-hint">{type.hint}</span>
              </button>
            ))}
          </div>

          {comingSoonMessage && <p className="sa-coming-soon">{comingSoonMessage}</p>}

          <div className="sa-fields-row">
            {isTransfer ? (
              <>
                <div className="sa-field">
                  <label>From Store</label>
                  <select value={fromStore} onChange={handleFromStoreChange} disabled={!canCreateAdjustments}>
                    <option value="">— Select store —</option>
                    {stores.map((s) => (
                      <option key={s.store_id} value={s.store_id}>{s.location}</option>
                    ))}
                  </select>
                </div>
                <div className="sa-field">
                  <label>To Store</label>
                  <select value={toStore} onChange={handleToStoreChange} disabled={!canCreateAdjustments}>
                    <option value="">— Select store —</option>
                    {stores.map((s) => (
                      <option key={s.store_id} value={s.store_id}>{s.location}</option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <>
                <div className="sa-field">
                  <label>Source Store</label>
                  <select value={sourceStore} onChange={handleSourceStoreChange} disabled={!selectedType?.enabled || !canCreateAdjustments}>
                    <option value="">— Select store —</option>
                    {stores.map((s) => (
                      <option key={s.store_id} value={s.store_id}>{s.location}</option>
                    ))}
                  </select>
                </div>
                <div className="sa-field">
                  <label>Reference Document</label>
                  <select value={referenceDoc} onChange={(e) => setReferenceDoc(e.target.value)} disabled={!selectedType?.enabled || !canCreateAdjustments}>
                    {REFERENCE_DOC_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>

          {configError && <p className="sa-error-text">{configError}</p>}
        </section>

        {/* --- Scan station --- */}
        <section className="sa-scan-station">
          <div className="sa-scan-station-header">
            <span className="sa-scan-station-title">Scan units</span>
            <span className="sa-scanner-status">
              <span className="sa-scanner-dot" />
              Scanner ready
            </span>
          </div>

          {!isCameraOpen ? (
            <form className="sa-scan-row" onSubmit={handleScanSubmit}>
              <div className="sa-scan-input-wrap">
                <ScanBarcode size={18} className="sa-scan-icon" />
                <input
                  ref={scanInputRef}
                  type="text"
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  placeholder="Point scanner here or type a serial number"
                  disabled={!isConfigValid || !canCreateAdjustments}
                />
              </div>
              <button type="submit" className="sa-btn-add" disabled={!isConfigValid || !canCreateAdjustments}>Add</button>
              <button type="button" className="sa-btn-camera" onClick={toggleCamera} disabled={!isConfigValid || !canCreateAdjustments}>
                <Camera size={18} />
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="sa-btn-camera sa-btn-camera-active sa-btn-camera-full"
              onClick={toggleCamera}
            >
              <Camera size={18} /> Stop scanning
            </button>
          )}



          {isCameraOpen && (
            <div className="sa-camera-block">
              <div id="sa-qr-reader" className="sa-camera-reader-box" />
              {/*<button type="button" className="sa-btn-stop-camera" onClick={toggleCamera}>
                Stop Camera
              </button>*/}
            </div>
          )}

          <div className="sa-camera-block">
              <div id="sa-qr-reader" className="sa-camera-reader-box" />
              {scanSuccessMessage && (
                <div className="sa-camera-scan-flash">{scanSuccessMessage}</div>
              )}
            </div>

          <div className="sa-scan-hints">
            <span>ENTER to add · each unit is looked up automatically</span>
            <span>No duplicates</span>
          </div>

          <div className="sa-divider" />

            <p className="sa-range-label">Or key in a serial range</p>

            <form className="sa-range-row" onSubmit={handleAddRange}>
              <input
                type="text"
                className="sa-range-prefix"
                value={rangePrefix}
                onChange={(e) => setRangePrefix(e.target.value)}
                placeholder="eg: EW"
                disabled={!isConfigValid || !canCreateAdjustments}
              />
              <div className="sa-range-field">
                <input
                  type="text"
                  inputMode="numeric"
                  value={rangeFrom}
                  onChange={(e) => setRangeFrom(e.target.value)}
                  placeholder="From"
                  disabled={!isConfigValid || !canCreateAdjustments}
                />
              </div>
              <span className="sa-range-arrow">→</span>
              <div className="sa-range-field">
                <input
                  type="text"
                  inputMode="numeric"
                  value={rangeTo}
                  onChange={(e) => setRangeTo(e.target.value)}
                  placeholder="To"
                  disabled={!isConfigValid || !canCreateAdjustments}
                />
              </div>
              <button
                type="submit"
                className="sa-btn-add-range"
                disabled={isAddingRange || !rangeFrom || !rangeTo || !isConfigValid || !canCreateAdjustments}
              >
                {isAddingRange ? 'Adding…' : 'Add range'}
              </button>
            </form>

            <p className="sa-range-hint">Numbers only · prefix is optional · leading zeros kept</p>
        </section>

        {/* --- Batch table --- */}
        <section className="sa-card">
          <div className="sa-batch-header">
            <span className="sa-batch-title">Batch</span>
            <span className="sa-batch-count-badge">{scanCart.length} UNIT{scanCart.length === 1 ? '' : 'S'}</span>
            <div className="sa-batch-header-spacer" />
            <button type="button" className="sa-btn-clear-batch" onClick={clearCart} disabled={scanCart.length === 0}>
              Clear batch
            </button>
          </div>

          {scanCart.length === 0 ? (
            <div className="sa-empty-batch">
              <ScanBarcode size={28} className="sa-empty-batch-icon" />
              <p className="sa-empty-batch-title">Nothing scanned yet</p>
              <p className="sa-empty-batch-subtitle">Units appear here with their product resolved automatically.</p>
            </div>
          ) : (
            <>
              <div className="sa-table-wrapper">
                <table className="sa-batch-table">
                  <thead>
                    <tr>
                      <th className="sa-col-no">No.</th>
                      <th>Serial</th>
                      <th>SKU</th>
                      <th>Product</th>
                      <th className="sa-col-qty">Qty</th>
                      <th className="sa-col-remove"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedCart.map((item, index) => {
                      const rowNumber = (page - 1) * PAGE_SIZE + index + 1;
                      const sign = qtySign(selectedTypeKey);
                      return (
                        <tr key={item.qr_batch}>
                          <td className="sa-col-no">{String(rowNumber).padStart(2, '0')}</td>
                          <td className="sa-serial-cell">{item.label_id}</td>
                          <td className="sa-sku-cell">{item.sku}</td>
                          <td>{item.product_name}</td>
                          <td className={`sa-col-qty ${sign.className}`}>{sign.text}</td>
                          <td className="sa-col-remove">
                            <button type="button" className="sa-remove-btn" onClick={() => removeFromCart(item.qr_batch)} aria-label="Remove">
                              <X size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="sa-pagination-bar">
                  <button className="sa-btn-secondary" onClick={() => handlePageChange(page - 1)} disabled={page <= 1}>
                    Previous
                  </button>
                  <span className="sa-pagination-status">Page {page} of {totalPages}</span>
                  <button className="sa-btn-secondary" onClick={() => handlePageChange(page + 1)} disabled={page >= totalPages}>
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* ============================ RIGHT COLUMN ============================ */}
      <div className="sa-right">
        <section className="sa-card sa-review-card">
          <h2 className="sa-card-title">Review</h2>

          <div className="sa-review-row">
            <span className="sa-review-label">Action</span>
            <span className="sa-review-value">{selectedType ? selectedType.label : 'Not set'}</span>
          </div>
          <div className="sa-review-row">
            <span className="sa-review-label">Store</span>
            <span className="sa-review-value">{storeSummaryText}</span>
          </div>
          <div className="sa-review-row">
            <span className="sa-review-label">Units Scanned</span>
            <span className="sa-review-value">{scanCart.length}</span>
          </div>
          <div className="sa-review-row">
            <span className="sa-review-label">Distinct SKUs</span>
            <span className="sa-review-value">{distinctSkuCount}</span>
          </div>

          <div className="sa-review-divider" />

          <div className="sa-review-row sa-net-change-row">
            <span className="sa-net-change-label">Net change</span>
            <span className={`sa-net-change-value ${netChangeClass}`}>{netChangeText}</span>
          </div>

          <div className="sa-field">
            <label>Reason / Remark</label>
            <input type="text" value={remark} onChange={(e) => setRemark(e.target.value)} disabled={!canCreateAdjustments} placeholder='Enter a reason or remark...' />
          </div>

          {!isConfigValid && (
            <p className="sa-warning-note">
              <Info size={14} />
              Select the adjustment type and store this affects.
            </p>
          )}

          {submitMessage && <p className="sa-status-text">{submitMessage}</p>}

          <div className="sa-review-actions">
            <button type="button" className="sa-btn-secondary" onClick={handleDiscard}>
              Discard
            </button>
            <button type="button" className="sa-btn-primary" onClick={openReview} disabled={!isConfigValid || scanCart.length === 0 || isSubmitting || !canCreateAdjustments}>
            {isSubmitting ? 'Submitting…' : `Submit ${scanCart.length} unit${scanCart.length === 1 ? '' : 's'}`}
          </button>
          </div>
        </section>

        <section className="sa-card sa-recent-card">
            <div className="sa-recent-header">
              <h2 className="sa-card-title sa-recent-title">Recent adjustments</h2>
              <button
                type="button"
                className="sa-ledger-link"
                onClick={() => navigate('/ledger')}
              >
                Ledger →
              </button>
            </div>

            {isLoadingRecent ? (
              <p className="sa-empty-recent">Loading…</p>
            ) : recentTx.length === 0 ? (
              <p className="sa-empty-recent">No adjustments yet.</p>
            ) : (
              <>
                <div className="sa-recent-list">
                  {pagedRecentTx.map((t) => {
                    const info = recentRowInfo(t);
                    return (
                      <div
                          key={t.transaction_id}
                          className="sa-recent-row sa-recent-row-clickable"
                          onClick={() => openDetail(t)}
                        >
                        <div className="sa-recent-row-meta">
                          <span className="sa-recent-row-title">{t.product_name} · {t.sku}</span>
                          <span className="sa-recent-row-sub">
                            {info.label} · {formatRelativeTime(t.created_at)}
                          </span>
                        </div>
                        <span className={`sa-recent-row-delta ${info.className}`}>{info.delta}</span>
                        <span className={`sa-status-pill ${info.statusClass}`}>{info.statusLabel}</span>
                      </div>
                    );
                  })}
                </div>

                {recentTotalPages > 1 && (
                  <div className="sa-pagination-bar">
                    <button className="sa-btn-secondary" onClick={() => handleRecentPageChange(recentPage - 1)} disabled={recentPage <= 1}>
                      Previous
                    </button>
                    <span className="sa-pagination-status">Page {recentPage} of {recentTotalPages}</span>
                    <button className="sa-btn-secondary" onClick={() => handleRecentPageChange(recentPage + 1)} disabled={recentPage >= recentTotalPages}>
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
      </div>
                {isReviewOpen && (
            <div className="sa-modal-overlay">
              <div className="sa-modal-panel">
                <div className="sa-modal-header">
                  <div className="sa-modal-header-left">
                    <h3>Summary: {selectedType?.label}</h3>
                    <span className="sa-pending-badge">{reviewRows.length} pending</span>
                  </div>
                  <button type="button" className="sa-modal-close" onClick={rejectReview} aria-label="Close">
                    <X size={16} />
                  </button>
                </div>

                <div className="sa-modal-body">
                  {reviewRows.length === 0 ? (
                    <p className="sa-empty-batch-subtitle">No units left in this batch.</p>
                  ) : (
                    <>
                      <div className="sa-table-wrapper">
                        <table className="sa-batch-table">
                          <thead>
                            <tr>
                              <th>No.</th>
                              <th>Serial Number</th>
                              <th>Transaction Type</th>
                              <th>From Store</th>
                              <th>To Store</th>
                              <th>Qty</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {pagedReviewRows.map((item, i) => (
                              <tr key={item.qr_batch}>
                                <td>{(reviewPage - 1) * REVIEW_PAGE_SIZE + i + 1}</td>
                                <td className="sa-serial-cell">{item.label_id}</td>
                                <td>{selectedType?.label}</td>
                                <td>{reviewFromStoreName || '—'}</td>
                                <td>{reviewToStoreName || '—'}</td>
                                <td>1</td>
                                <td>
                                  <button type="button" className="sa-remove-btn" onClick={() => removeReviewRow(item.qr_batch)} aria-label="Remove">
                                    <X size={14} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {reviewTotalPages > 1 && (
                        <div className="sa-pagination-bar">
                          <button
                            className="sa-btn-secondary"
                            onClick={() => setReviewPage((p) => Math.max(1, p - 1))}
                            disabled={reviewPage <= 1}
                          >
                            Previous
                          </button>
                          <span className="sa-pagination-status">Page {reviewPage} of {reviewTotalPages}</span>
                          <button
                            className="sa-btn-secondary"
                            onClick={() => setReviewPage((p) => Math.min(reviewTotalPages, p + 1))}
                            disabled={reviewPage >= reviewTotalPages}
                          >
                            Next
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="sa-modal-footer">
                  <button type="button" className="sa-btn-reject" onClick={rejectReview}>
                    Reject Selected ({reviewRows.length})
                  </button>
                  <button
                    type="button"
                    className="sa-btn-primary"
                    onClick={confirmReview}
                    disabled={isSubmitting || reviewRows.length === 0}
                  >
                    {isSubmitting ? 'Submitting…' : `Confirm & Submit (${reviewRows.length})`}
                  </button>
                </div>
              </div>
            </div>
            
          )}
          {isDetailOpen && (
  <div className="sa-modal-overlay" onClick={closeDetail}>
    <div className="sa-modal-panel sa-detail-panel" onClick={(e) => e.stopPropagation()}>
      <div className="sa-modal-header">
        <div className="sa-modal-header-left">
          <h3>Transaction Detail</h3>
          {selectedTx && (
            <span
              className={`sa-status-pill ${
                selectedTx.approval_status === 'pending'
                  ? 'sa-status-pending'
                  : selectedTx.approval_status === 'rejected'
                  ? 'sa-status-rejected'
                  : 'sa-status-approved'
              }`}
            >
              {selectedTx.approval_status === 'pending'
                ? 'Pending'
                : selectedTx.approval_status === 'rejected'
                ? 'Rejected'
                : 'Approved'}
            </span>
          )}
        </div>
        <button type="button" className="sa-modal-close" onClick={closeDetail} aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <div className="sa-modal-body">
        {isLoadingDetail ? (
          <p className="sa-empty-batch-subtitle">Loading…</p>
        ) : detailError ? (
          <p className="sa-error-text">{detailError}</p>
        ) : selectedTx ? (
          <>
            <div className="sa-review-row">
              <span className="sa-review-label">Product</span>
              <span className="sa-review-value">{selectedTx.product_name} · {selectedTx.sku}</span>
            </div>
            <div className="sa-review-row">
              <span className="sa-review-label">Date / Time</span>
              <span className="sa-review-value">{formatDateTime(selectedTx.created_at)}</span>
            </div>
            <div className="sa-review-row">
              <span className="sa-review-label">Transaction Type</span>
              <span className="sa-review-value">{txTypeLabel(selectedTx.transaction_type)}</span>
            </div>
            <div className="sa-review-row">
              <span className="sa-review-label">From Store</span>
              <span className="sa-review-value">{selectedTx.from_store_name || '—'}</span>
            </div>
            <div className="sa-review-row">
              <span className="sa-review-label">To Store</span>
              <span className="sa-review-value">{selectedTx.to_store_name || '—'}</span>
            </div>

            <div className="sa-review-divider" />

            <div className="sa-field">
              <label>Serial Number{(selectedTx.serial_numbers || []).length === 1 ? '' : 's'} ({(selectedTx.serial_numbers || []).length})</label>
              {(selectedTx.serial_numbers || []).length === 0 ? (
                <p className="sa-empty-batch-subtitle">No serial numbers recorded.</p>
              ) : (
                <div className="sa-table-wrapper">
                    <table className="sa-batch-table">
                      <thead>
                        <tr><th className="sa-col-no">No.</th><th>Serial Number</th></tr>
                      </thead>
                      <tbody>
                        {selectedTx.serial_numbers.map((sn, i) => (
                          <tr key={sn}>
                            <td className="sa-col-no">{String(i + 1).padStart(2, '0')}</td>
                            <td className="sa-serial-cell">{sn}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                </div>
              )}
            </div>

            {detailStatusMessage && <p className="sa-status-text">{detailStatusMessage}</p>}
          </>
        ) : null}
      </div>

            {selectedTx?.approval_status === 'pending' && canEditAdjustments && (
        <div className="sa-modal-footer">
          <button
            type="button"
            className="sa-btn-reject"
            onClick={handleRejectDetail}
            disabled={isProcessingDetail}
          >
            Reject
          </button>
          <button
            type="button"
            className="sa-btn-primary"
            onClick={handleApproveDetail}
            disabled={isProcessingDetail}
          >
            {isProcessingDetail ? 'Processing…' : 'Approve'}
          </button>
        </div>
      )}
    </div>
  </div>
)}
    </div>
  );
}