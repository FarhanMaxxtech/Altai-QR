// src/pages/merchant/AssignQrToProduct.jsx
import React, { useMemo, useState, useRef } from 'react';
import { ScanBarcode, Camera, X, Search } from 'lucide-react';
import { apiFetch, apiFetchScanLookupBatch } from '../../utils/api';
import { useEffect } from 'react';
import '../../styles/AssignQrToProduct.css';
import { useLocation } from 'react-router-dom';
import { useConfirm } from '../../context/ConfirmContext';
import MultiQrScanner from '../../components/MultiQrScanner';
import SnapAndScanButton from '../../components/SnapAndScanButton';

const MAX_RANGE_SIZE = 500;
const SUMMARY_PAGE_SIZE = 50;
const SCAN_CART_PAGE_SIZE = 10;

function normalizeSerialSearch(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\d+/g, (digits) => digits.replace(/^0+(?=\d)/, ''));
}

function findSequenceGaps(values, maxMissing) {
  const groups = new Map();
  values.forEach((value) => {
    const match = String(value).match(/^(.*?)(\d+)$/);
    if (!match) return;
    const [, prefix, digits] = match;
    const key = `${prefix}\u0000${digits.length}`;
    const group = groups.get(key) || { prefix, width: digits.length, numbers: new Set() };
    group.numbers.add(Number(digits));
    groups.set(key, group);
  });

  const sequences = [...groups.values()].map(({ prefix, width, numbers }) => ({
    prefix,
    width,
    sorted: [...numbers].sort((a, b) => a - b),
  }));
  let totalGaps = 0;
  sequences.forEach(({ sorted }) => {
    for (let index = 1; index < sorted.length; index += 1) {
      totalGaps += Math.max(0, sorted[index] - sorted[index - 1] - 1);
    }
  });
  if (totalGaps > 30 || totalGaps > maxMissing) return [];

  const gaps = [];
  sequences.forEach(({ prefix, width, sorted }) => {
    for (let index = 1; index < sorted.length; index += 1) {
      for (let number = sorted[index - 1] + 1; number < sorted[index]; number += 1) {
        gaps.push(`${prefix}${String(number).padStart(width, '0')}`);
      }
    }
  });
  return gaps;
}

function displayName(sku, productName) {
  if (!sku && !productName) return '—';
  return `${productName} (${sku})`;
}

function badgeInfo(item) {
  if (item.scanState === 'checking') {
    return { label: 'Checking…', className: 'aq-badge aq-badge-checking' };
  }
  // A code that was previously checked out is being reused on a new label —
  // everything else (unassigned / pending / first-time) counts as "New".
  return item.status === 'checked_out'
    ? { label: 'Used', className: 'aq-badge aq-badge-used' }
    : { label: 'New', className: 'aq-badge aq-badge-new' };
}

export default function AssignQrToProduct() {

  const confirm = useConfirm();

  // Alert-style dialog (dismiss-only) for scan-station notifications that
  // were easy to miss when shown as inline text below aq-range-hint.
  const notify = (message, options = {}) => {
    confirm(message, { confirmLabel: 'OK', hideCancel: true, ...options });
  };
  const location = useLocation();
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState('');
  const [variantId, setVariantId] = useState('');

  // --- Scan station ---------------------------------------------------------
  const [scanCart, setScanCart] = useState([]);
  const [scanInput, setScanInput] = useState('');
  const [scanCartPage, setScanCartPage] = useState(1);
  const [sortMode, setSortMode] = useState('newest');
  const [scanSearchTerm, setScanSearchTerm] = useState('');
  const [debouncedScanSearchTerm, setDebouncedScanSearchTerm] = useState('');
  const [snapReport, setSnapReport] = useState(null);
  const [lastSnapExpectedCount, setLastSnapExpectedCount] = useState(0);

  const [scanSuccessMessage, setScanSuccessMessage] = useState('');
  const scanInputRef = useRef(null);
  const snapValuesRef = useRef(new Set());
  const snapFailuresRef = useRef(new Map());
  const snapExpectedRef = useRef(0);
  const snapCompleteRef = useRef(false);
  const snapMissingCellHintRef = useRef(0);
  const snapReportTimerRef = useRef(null);

  const scanCartRef = useRef([]);
  const commitCart = (next) => {
    scanCartRef.current = next;
    setScanCart(next);
  };
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isPhotoScanning, setIsPhotoScanning] = useState(false);
  const pendingPhotoSortRef = useRef(false);
  const scanQueueRef = useRef([]);
  const isProcessingQueueRef = useRef(false);
  const scanSessionRef = useRef(0);
  const scannerRef = useRef(null);
  const cameraPendingValuesRef = useRef(new Map());
  const cameraBatchTimerRef = useRef(null);
  const cameraBatchRequestRef = useRef(null);
  const flushCameraBatchRef = useRef(null);
  const isPhotoScanningRef = useRef(false);
  const recentFailuresRef = useRef(new Map());
  const scannedListRef = useRef(null);
  const [cameraToast, setCameraToast] = useState('');

  useEffect(() => {
    if (isPhotoScanning) {
      pendingPhotoSortRef.current = true;
      return;
    }
    if (
      pendingPhotoSortRef.current
      && !scanCart.some((item) => item.scanState === 'checking')
    ) {
      pendingPhotoSortRef.current = false;
      setSortMode('serial');
      setScanCartPage(1);
    }
  }, [isPhotoScanning, scanCart]);

  const scheduleCameraBatch = (delay = 150) => {
    if (cameraBatchTimerRef.current !== null) {
      window.clearTimeout(cameraBatchTimerRef.current);
    }
    cameraBatchTimerRef.current = window.setTimeout(() => {
      cameraBatchTimerRef.current = null;
      flushCameraBatchRef.current?.();
    }, delay);
  };

  const handlePhotoScanningChange = (isScanning) => {
    isPhotoScanningRef.current = isScanning;
    if (isScanning) pendingPhotoSortRef.current = true;
    setIsPhotoScanning(isScanning);
    if (!isScanning && cameraPendingValuesRef.current.size > 0) {
      scheduleCameraBatch(0);
    }
  };

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setDebouncedScanSearchTerm(scanSearchTerm);
      setScanCartPage(1);
    }, 150);
    return () => window.clearTimeout(timerId);
  }, [scanSearchTerm]);

  const [rangePrefix, setRangePrefix] = useState('');
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [rangeError, setRangeError] = useState('');
  const [isAddingRange, setIsAddingRange] = useState(false);

  // --- Assignment details -----------------------------------------------
  const [batchNumber, setBatchNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState('');

  // --- Summary Assign modal -----------------------------------------------
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [summaryVariantId, setSummaryVariantId] = useState(null);
  const [summaryLabel, setSummaryLabel] = useState('');
  const [summaryRows, setSummaryRows] = useState([]);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [summaryStatusMessage, setSummaryStatusMessage] = useState('');
  const [isProcessingSummary, setIsProcessingSummary] = useState(false);
  const [summaryPage, setSummaryPage] = useState(1);

  useEffect(() => {
    apiFetch('/api/products')
      .then((res) => res.json())
      .then((data) => setProducts(data))
      .catch((err) => console.error('Failed to load products:', err));
  }, []);

  useEffect(() => {
  if (products.length === 0 || !location.state) return;
  const { presetProductId, presetVariantId } = location.state;
  if (presetProductId) setProductId(presetProductId);
  if (presetVariantId) setVariantId(presetVariantId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [products]);

  const selectedProduct = products.find((p) => p.product_id === productId);
  const variantOptions = selectedProduct ? selectedProduct.variants : [];
  const selectedVariant = variantOptions.find((v) => v.variant_id === variantId);

  const resetScanSession = () => {
    scanSessionRef.current += 1;
    scanQueueRef.current = [];
    scannerRef.current?.resetSession();
    recentFailuresRef.current.clear();
    if (cameraBatchTimerRef.current !== null) {
      window.clearTimeout(cameraBatchTimerRef.current);
      cameraBatchTimerRef.current = null;
    }
    cameraPendingValuesRef.current.clear();
    cameraBatchRequestRef.current?.controller.abort();
    cameraBatchRequestRef.current = null;
  };

  useEffect(() => () => {
    scanSessionRef.current += 1;
    if (cameraBatchTimerRef.current !== null) window.clearTimeout(cameraBatchTimerRef.current);
    cameraBatchRequestRef.current?.controller.abort();
  }, []);

  const showCameraFailures = (failures, allowImmediateRetry = false) => {
    const now = Date.now();
    const grouped = {};
    failures.forEach(({ value, message }) => {
      const lastFailure = recentFailuresRef.current.get(value);
      if (!allowImmediateRetry && lastFailure && now - lastFailure < 5000) return;
      if (allowImmediateRetry) recentFailuresRef.current.delete(value);
      else recentFailuresRef.current.set(value, now);
      (grouped[message] ||= []).push(value);
    });
    const text = Object.entries(grouped)
      .map(([message, values]) => {
        const serials = values.slice(0, 3).join(', ');
        const more = values.length > 3 ? ` +${values.length - 3} more` : '';
        return `${values.length} code${values.length === 1 ? '' : 's'}: ${message} (${serials}${more})`;
      })
      .join(' · ');
    if (text) setCameraToast(text);
  };

  useEffect(() => {
    const recoverStaleLookups = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      const stalePending = scanCartRef.current.some((row) => (
        row.scanState === 'checking'
        && now - (row.checkingSince || now) > (row.scanSource === 'snap' ? 30000 : 10000)
        && cameraPendingValuesRef.current.has(row.scanValue)
      ));
      if (stalePending && !cameraBatchRequestRef.current) {
        if (cameraBatchTimerRef.current !== null) {
          window.clearTimeout(cameraBatchTimerRef.current);
          cameraBatchTimerRef.current = null;
        }
        flushCameraBatchRef.current?.();
      }
      const timedOutRows = scanCartRef.current.filter((row) => {
        const staleThreshold = row.scanSource === 'snap' ? 30000 : 10000;
        if (row.scanState !== 'checking' || now - (row.checkingSince || now) <= staleThreshold) return false;
        const value = row.scanValue;
        const pending = cameraPendingValuesRef.current.has(value);
        const inFlight = cameraBatchRequestRef.current?.rowKeys.get(value) === row.scanKey;
        return !pending && !inFlight;
      });
      if (timedOutRows.length === 0) return;

      const timedOutKeys = new Set(timedOutRows.map((row) => row.scanKey));
      timedOutRows.forEach((row) => recentFailuresRef.current.delete(row.scanValue));
      commitCart(scanCartRef.current.filter((row) => !timedOutKeys.has(row.scanKey)));
      timedOutRows.forEach((row) => recordSnapFailure(row.scanValue, 'Lookup timed out, scan again'));
      showCameraFailures(timedOutRows.map((row) => ({
        value: row.scanValue,
        message: 'Lookup timed out, scan again',
      })), true);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') recoverStaleLookups();
    };
    const intervalId = window.setInterval(recoverStaleLookups, 2000);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!cameraToast) return undefined;
    const timeoutId = window.setTimeout(() => setCameraToast(''), 3000);
    return () => window.clearTimeout(timeoutId);
  }, [cameraToast]);

  useEffect(() => {
    if (!snapReport?.allAdded) return undefined;
    snapReportTimerRef.current = window.setTimeout(() => {
      setSnapReport(null);
      snapReportTimerRef.current = null;
    }, 4000);
    return () => {
      if (snapReportTimerRef.current !== null) {
        window.clearTimeout(snapReportTimerRef.current);
        snapReportTimerRef.current = null;
      }
    };
  }, [snapReport]);

  const recordSnapFailure = (value, reason) => {
    if (snapValuesRef.current.has(value)) snapFailuresRef.current.set(value, reason);
  };

  const recordSnapFailures = (failures) => {
    failures.forEach(({ value, message }) => recordSnapFailure(value, message));
  };

  const handleSnapStart = ({ expected }) => {
    snapValuesRef.current = new Set();
    snapFailuresRef.current.clear();
    snapExpectedRef.current = expected;
    snapCompleteRef.current = false;
    snapMissingCellHintRef.current = 0;
    setSnapReport(null);
    if (snapReportTimerRef.current !== null) {
      window.clearTimeout(snapReportTimerRef.current);
      snapReportTimerRef.current = null;
    }
  };

  const handleSnapDetected = (values, metadata) => {
    if (metadata?.source === 'snap') {
      if (metadata.expected > 0) snapExpectedRef.current = metadata.expected;
      values.forEach((value) => snapValuesRef.current.add(value));
    }
    scanCameraBatch(values, metadata);
  };

  const maybeBuildSnapReport = () => {
    if (
      !snapCompleteRef.current
      || cameraPendingValuesRef.current.size > 0
      || cameraBatchRequestRef.current
    ) return;

    const values = [...snapValuesRef.current];
    const expected = snapExpectedRef.current;
    const addedValues = new Set(
      scanCartRef.current
        .filter((row) => row.scanState === 'ok')
        .map((row) => row.scanValue || row.label_id)
        .filter((value) => snapValuesRef.current.has(value))
    );
    const failures = [...snapFailuresRef.current.entries()]
      .filter(([serial]) => !addedValues.has(serial))
      .map(([serial, reason]) => ({ serial, reason }));
    const notDetected = Math.max(0, expected - values.length);
    const showMissingHints = expected === 0 || values.length < expected;
    const sequenceGaps = showMissingHints
      ? findSequenceGaps(values, Math.max(0, expected - addedValues.size) + 5)
      : [];
    const allAdded = values.length > 0
      && addedValues.size === values.length
      && failures.length === 0
      && sequenceGaps.length === 0
      && notDetected === 0;
    const failureGroups = [...new Map(
      failures.map(({ reason }) => [reason, { reason, serials: [] }])
    ).values()];
    failureGroups.forEach((group) => {
      group.serials = failures
        .filter((failure) => failure.reason === group.reason)
        .map((failure) => failure.serial);
    });

    snapCompleteRef.current = false;
    setSnapReport({
      read: values.length,
      added: addedValues.size,
      expected,
      notDetected,
      failures,
      failureGroups,
      sequenceGaps,
      retrySerials: [...new Set([...sequenceGaps, ...failures.map(({ serial }) => serial)])],
      missingCellHint: snapMissingCellHintRef.current,
      allAdded,
    });
  };

  const handleSnapComplete = ({ values, expected, missingCells }) => {
    snapValuesRef.current = new Set(values);
    snapExpectedRef.current = expected || 0;
    snapMissingCellHintRef.current = missingCells?.count || 0;
    snapCompleteRef.current = true;
    maybeBuildSnapReport();
  };

  const focusScanInput = (serial) => {
    if (serial) setScanInput(serial);
    if (isCameraOpen) {
      toggleCamera();
      window.setTimeout(() => scanInputRef.current?.focus(), 0);
      return;
    }
    scanInputRef.current?.focus();
  };

  const handleProductChange = (e) => {
    setProductId(e.target.value);
    setVariantId('');
  };

  // --- Scanning helpers -------------------------------------------------

  const addManyToCart = async (values) => {
    const sessionId = scanSessionRef.current;
    setScanSuccessMessage('');
    let current = [...scanCartRef.current];
    const failures = [];
    let successCount = 0;

    for (let offset = 0; offset < values.length; offset += 100) {
      const chunk = values.slice(offset, offset + 100).map((value) => value.trim()).filter(Boolean);
      const candidates = [];
      chunk.forEach((value) => {
        if (current.some((item) => item.label_id === value || item.qr_id === value)
          || candidates.includes(value)) {
          failures.push({ value, message: 'Already scanned in this batch.' });
        } else {
          candidates.push(value);
        }
      });
      if (candidates.length === 0) continue;

      try {
        const results = await apiFetchScanLookupBatch(
          '/api/qrcode/scan-lookup-batch',
          candidates,
          {},
          (value) => `/api/qrcode/scan-lookup?serial_number=${encodeURIComponent(value)}`
        );
        if (sessionId !== scanSessionRef.current) return;
        current = [...scanCartRef.current];
        results.forEach((result) => {
          if (!result.ok) {
            failures.push({ value: result.label_id || result.value, message: result.message || 'Could not recognize this code.' });
            return;
          }
          if (current.some((item) => item.qr_batch === result.data.qr_batch || item.label_id === result.data.label_id)) return;
          current = [...current, result.data];
          successCount++;
        });
        commitCart(current);
        if (sortMode === 'newest' && !pendingPhotoSortRef.current) setScanCartPage(1);
      } catch (err) {
        if (sessionId !== scanSessionRef.current) return;
        candidates.forEach((value) => failures.push({ value, message: 'Could not reach server. Check it is running.' }));
        console.error(err);
      }
    }

    if (sessionId !== scanSessionRef.current) return;

    if (failures.length > 0) {
      const grouped = {};
      failures.forEach(({ value, message }) => {
        (grouped[message] ||= []).push(value);
      });
      const text = Object.entries(grouped)
        .map(([message, values]) => {
          const shown = values.slice(0, 6).join(', ');
          const more = values.length > 6 ? ` +${values.length - 6} more` : '';
          return `${values.length} code${values.length === 1 ? '' : 's'} — ${message} (${shown}${more})`;
        })
        .join('\n');
      if (isCameraOpen) {
        showCameraFailures(failures);
      } else {
        notify(text, { title: 'Scan issue', danger: true });
      }
    }

    if (successCount > 0) {
    if (navigator.vibrate) navigator.vibrate(80);
    const lastAdded = current[current.length - 1]; // the most recently added item
    setScanSuccessMessage(
      successCount === 1
        ? `✓ ${lastAdded.label_id} added.`
        : `✓ ${successCount} codes added.`
    );
    setTimeout(() => setScanSuccessMessage(''), 2500);
  }
  };

  const flushCameraBatch = async () => {
    if (cameraBatchRequestRef.current || cameraPendingValuesRef.current.size === 0) return;
    const hasPendingSnap = [...cameraPendingValuesRef.current.entries()].some(([value, scanKey]) => (
      scanCartRef.current.some((row) => (
        row.scanKey === scanKey && row.scanValue === value && row.scanSource === 'snap'
      ))
    ));
    if (hasPendingSnap && isPhotoScanningRef.current) return;

    const sessionId = scanSessionRef.current;
    const coordinator = {
      requests: new Set(),
      rowKeys: new Map(),
      controller: {
        abort() {
          coordinator.requests.forEach((request) => request.controller?.abort());
        },
      },
    };
    cameraBatchRequestRef.current = coordinator;

    const processChunk = async (pending) => {
      const values = pending.map(([value]) => value);
      const rowKeys = new Map(pending);
      const request = { controller: null, rowKeys };
      coordinator.requests.add(request);
      rowKeys.forEach((scanKey, value) => coordinator.rowKeys.set(value, scanKey));

      try {
        let results;
        let requestError = null;
        let timedOut = false;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (sessionId !== scanSessionRef.current) return;
          const controller = new AbortController();
          request.controller = controller;
          let attemptTimedOut = false;
          let timeoutId;
          try {
            const lookup = apiFetchScanLookupBatch(
              '/api/qrcode/scan-lookup-batch',
              values,
              {},
              (value) => `/api/qrcode/scan-lookup?serial_number=${encodeURIComponent(value)}`,
              controller.signal
            );
            timeoutId = window.setTimeout(() => {
              attemptTimedOut = true;
              controller.abort();
            }, 15000 + values.length * 100);
            results = await lookup;
            if (results.some((result) => (
              !result.ok && result.message === 'Could not reach server.'
            ))) {
              throw new Error('Could not reach server.');
            }
            requestError = null;
            timedOut = false;
            break;
          } catch (error) {
            if (timeoutId !== undefined) {
              window.clearTimeout(timeoutId);
              timeoutId = undefined;
            }
            requestError = error;
            timedOut = attemptTimedOut;
            const retryable = attemptTimedOut
              || error?.message === 'Could not reach server.'
              || error?.name === 'TypeError'
              || error?.name === 'NetworkError';
            if (attempt === 0 && retryable && sessionId === scanSessionRef.current) {
              await new Promise((resolve) => window.setTimeout(resolve, 1000));
            } else {
              break;
            }
          } finally {
            if (timeoutId !== undefined) window.clearTimeout(timeoutId);
          }
        }
        if (sessionId !== scanSessionRef.current) return;

        if (requestError) {
          const message = timedOut ? 'Lookup timed out, scan again' : 'Could not reach server.';
          const failedRows = scanCartRef.current.filter((row) => (
            rowKeys.get(row.scanValue) === row.scanKey && row.scanState === 'checking'
          ));
          const failedKeys = new Set(failedRows.map((row) => row.scanKey));
          commitCart(scanCartRef.current.filter((row) => !failedKeys.has(row.scanKey)));
          values.forEach((value) => recordSnapFailure(value, message));
          showCameraFailures(values.map((value) => ({ value, message })), timedOut);
          if (!timedOut) console.error(requestError);
          return;
        }

        const successfulRows = new Map();
        const failures = [];
        const receivedValues = new Set();
        let successCount = 0;
        results.forEach((result) => {
          receivedValues.add(result.value);
          const scanKey = rowKeys.get(result.value);
          if (result.ok) {
            successfulRows.set(scanKey, {
              ...result.data,
              scanKey,
              scanValue: result.value,
              scanState: 'ok',
              checkingSince: undefined,
            });
            successCount++;
          } else {
            const message = result.message || 'Could not recognize this code.';
            failures.push({ value: result.label_id || result.value, message });
            recordSnapFailure(result.value, message);
          }
        });
        values.filter((value) => !receivedValues.has(value))
          .forEach((value) => {
            const message = 'Could not recognize this code.';
            failures.push({ value, message });
            recordSnapFailure(value, message);
          });

        const resolvedCart = scanCartRef.current.flatMap((row) => {
          if (!rowKeys.has(row.scanValue)) return [row];
          const success = successfulRows.get(row.scanKey);
          return success ? [success] : [];
        });
        commitCart(resolvedCart);
        if (successCount > 0) {
          setScanSuccessMessage(`✓ ${successCount} code${successCount === 1 ? '' : 's'} added.`);
          setTimeout(() => setScanSuccessMessage(''), 2500);
        }
        recordSnapFailures(failures);
        showCameraFailures(failures);
      } finally {
        coordinator.requests.delete(request);
        rowKeys.forEach((scanKey, value) => {
          if (coordinator.rowKeys.get(value) === scanKey) coordinator.rowKeys.delete(value);
        });
      }
    };

    const takeChunk = () => {
      const pending = [...cameraPendingValuesRef.current.entries()].slice(0, 25);
      pending.forEach(([value]) => cameraPendingValuesRef.current.delete(value));
      return pending;
    };
    const runWorker = async () => {
      while (sessionId === scanSessionRef.current) {
        const pending = takeChunk();
        if (pending.length === 0) break;
        await processChunk(pending);
      }
    };

    try {
      await Promise.all([
        runWorker().catch((error) => console.error('QR lookup chunk processing failed:', error)),
        runWorker().catch((error) => console.error('QR lookup chunk processing failed:', error)),
      ]);
    } finally {
      if (cameraBatchRequestRef.current === coordinator) {
        cameraBatchRequestRef.current = null;
        if (cameraPendingValuesRef.current.size > 0) scheduleCameraBatch(0);
      }
      maybeBuildSnapReport();
    }
  };
  flushCameraBatchRef.current = flushCameraBatch;

  const scanCameraBatch = (values, metadata = null) => {
    const sessionId = scanSessionRef.current;
    const now = Date.now();
    const current = [...scanCartRef.current];
    const duplicates = [];
    const pendingValues = new Map();
    recentFailuresRef.current.forEach((lastFailure, value) => {
      if (now - lastFailure >= 5000) recentFailuresRef.current.delete(value);
    });

    values.forEach((rawValue) => {
      const value = rawValue.trim();
      if (!value) return;
      const existing = current.find((item) => (item.scanValue || item.label_id) === value);
      const existingIsInFlight = existing
        && (cameraPendingValuesRef.current.has(value)
          || cameraBatchRequestRef.current?.rowKeys.get(value) === existing.scanKey);
      if ((existing && (existing.scanState !== 'checking' || existingIsInFlight))
        || cameraPendingValuesRef.current.has(value)
        || pendingValues.has(value)) {
        duplicates.push({ value, message: 'already in batch' });
        return;
      }
      const lastFailure = recentFailuresRef.current.get(value);
      if (lastFailure && now - lastFailure < 5000) {
        if (metadata?.source === 'snap') {
          duplicates.push({ value, message: 'previous lookup failed recently' });
        }
        return;
      }

      const scanKey = `camera-${sessionId}-${now}-${pendingValues.size}`;
      pendingValues.set(value, scanKey);
    });

    if (pendingValues.size > 0) {
      const next = [
        ...current,
        ...[...pendingValues.entries()].map(([value, scanKey]) => ({
          scanKey,
          scanValue: value,
          qr_batch: scanKey,
          label_id: value,
          scanState: 'checking',
          checkingSince: now,
          scanSource: metadata?.source === 'snap' ? 'snap' : 'camera',
        })),
      ];
      const rescanValues = new Set(pendingValues.keys());
      const filtered = current.filter((row) => (
        !rescanValues.has(row.scanValue || row.label_id)
        || row.scanState !== 'checking'
        || cameraPendingValuesRef.current.has(row.scanValue)
        || cameraBatchRequestRef.current?.rowKeys.get(row.scanValue) === row.scanKey
      ));
      const nextCart = [
        ...filtered,
        ...next.slice(current.length),
      ];
      pendingValues.forEach((scanKey, value) => cameraPendingValuesRef.current.set(value, scanKey));
      commitCart(nextCart);
      if (sortMode === 'newest' && !pendingPhotoSortRef.current) setScanCartPage(1);
      scheduleCameraBatch();
    }
    if (duplicates.length > 0) {
      recordSnapFailures(duplicates);
      showCameraFailures(duplicates);
    }
  };

    // Ensures scans are processed one at a time, in order — a fast USB
  // scanner fires Enter (and thus handleScanSubmit) far quicker than
  // addManyToCart's network round-trip, so without a queue, concurrent
  // calls race on scanCartRef.current and silently drop scans.
  const enqueueScanBatch = (values) => {
    const batch = values.map((value) => value.trim()).filter(Boolean);
    if (batch.length === 0) return;
    scanQueueRef.current.push(batch);
    processScanQueue();
  };

  const enqueueScan = (value) => enqueueScanBatch([value]);

  const processScanQueue = async () => {
    if (isProcessingQueueRef.current) return;
    isProcessingQueueRef.current = true;
    while (scanQueueRef.current.length > 0) {
      const values = scanQueueRef.current.shift();
      await addManyToCart(values);
    }
    isProcessingQueueRef.current = false;
  };

    const handleScanSubmit = (e) => {
    e.preventDefault();
    if (!scanInput.trim()) return;
    enqueueScan(scanInput.trim());
    setScanInput('');
  };

  // removeFromCart
  const removeFromCart = (qrBatch) => {
  const next = scanCartRef.current.filter((item) => item.qr_batch !== qrBatch);
  commitCart(next);
  const totalPages = Math.max(1, Math.ceil(next.length / SCAN_CART_PAGE_SIZE));
  setScanCartPage((p) => Math.min(p, totalPages));
  };

  const clearCart = () => {
   resetScanSession();
   commitCart([]);
   setSubmitMessage('');
   setScanCartPage(1);
   setSortMode('newest');
   pendingPhotoSortRef.current = false;
   snapCompleteRef.current = false;
   snapValuesRef.current.clear();
   snapFailuresRef.current.clear();
   setSnapReport(null);
  };

  const toggleCamera = () => {
    if (isCameraOpen && cameraPendingValuesRef.current.size > 0) {
      if (cameraBatchTimerRef.current !== null) {
        window.clearTimeout(cameraBatchTimerRef.current);
        cameraBatchTimerRef.current = null;
      }
      flushCameraBatch();
    }
    setIsCameraOpen((open) => !open);
  };

  // --- Serial range ----------------------------------------------------

  const handleAddRange = async (e) => {
    e.preventDefault();
    setRangeError('');

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

  // --- Assignment submit -------------------------------------------------

  const readyCart = scanCart.filter((item) => item.scanState !== 'checking');
  const codesQueued = readyCart.length;
  const checkingCount = scanCart.filter((item) => item.scanState === 'checking').length;
  const targetLabel = selectedVariant ? displayName(selectedVariant.sku, selectedProduct.product_name) : null;
  const isReady = codesQueued > 0 && checkingCount === 0 && Boolean(variantId);

  const handleCancel = () => {
    resetScanSession();
    commitCart([]);
    setProductId('');
    setVariantId('');
    setBatchNumber('');
    setExpiryDate('');
    setSubmitMessage('');
  };

  const loadSummary = (varId, fallbackLabel) => {
    setSummaryVariantId(varId);
    setSummaryLabel(fallbackLabel);
    setSummaryPage(1);
    setIsLoadingSummary(true);
    setSummaryError('');
    setSummaryStatusMessage('');
    setIsSummaryOpen(true);

    apiFetch(`/api/qrcode/pending-approvals/${varId}`)
      .then((res) => (res.status === 404 ? [] : res.json()))
      .then((data) => {
        setSummaryRows(data);
        if (data.length > 0) {
          setSummaryLabel(displayName(data[0].target_sku, data[0].target_product_name));
        }
      })
      .catch((err) => {
        setSummaryError('Could not reach server. Check it is running.');
        console.error(err);
      })
      .finally(() => setIsLoadingSummary(false));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitMessage('');

    const currentCart = scanCartRef.current;
    const readyCart = currentCart.filter((item) => item.scanState !== 'checking');
    if (currentCart.some((item) => item.scanState === 'checking')) {
      setSubmitMessage('Wait for all QR lookups to finish.');
      return;
    }
    if (readyCart.length === 0) {
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
          qr_ids: readyCart.map((item) => item.qr_batch),
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

      const label = targetLabel;
      const varId = variantId;

      resetScanSession();
      commitCart([]);
      setBatchNumber('');
      setExpiryDate('');
      setProductId('');
      setVariantId('');
      setSubmitMessage('');
      scanInputRef.current?.focus();

      loadSummary(varId, label);
    } catch (err) {
      setSubmitMessage('Could not reach server. Check it is running.');
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- Summary modal actions ----------------------------------------------

  const removeSummaryRow = async (qrBatch) => {
    const confirmed = await confirm(
      'Remove this code from the assignment? It will keep its previous product assignment.',
      {
        title: 'Remove Assignment',
        confirmLabel: 'Remove',
        cancelLabel: 'Cancel',
        danger: true,
      }
    );
    if (!confirmed) return;

    try {
      const res = await apiFetch(`/api/qrcode/pending-approvals/${summaryVariantId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ qr_ids: [qrBatch] }),
      });
      const result = await res.json();

      if (!res.ok) {
        setSummaryStatusMessage(result.message || 'Could not remove this code.');
        return;
      }

      setSummaryRows((prev) => {
        const next = prev.filter((r) => r.qr_batch !== qrBatch);
        const nextTotalPages = Math.max(1, Math.ceil(next.length / SUMMARY_PAGE_SIZE));
        setSummaryPage((p) => Math.min(p, nextTotalPages));
        return next;
      });
    } catch (err) {
      setSummaryStatusMessage('Could not reach server. Check it is running.');
      console.error(err);
    }
  };

  const closeSummary = () => {
    setIsSummaryOpen(false);
    setSummaryRows([]);
    setSummaryVariantId(null);
  };

  const confirmSummaryAssign = async () => {
    const qrIds = summaryRows.map((r) => r.qr_batch);
    if (qrIds.length === 0) return;

    const confirmed = await confirm(
      `Confirm and submit ${qrIds.length} unit(s) for ${summaryLabel}?`,
      {
        title: 'Confirm Assignment',
        confirmLabel: 'Confirm & Submit',
        cancelLabel: 'Cancel',
      }
    );
    if (!confirmed) return;

    setIsProcessingSummary(true);
    setSummaryStatusMessage('');
    try {
      const res = await apiFetch(`/api/qrcode/pending-approvals/${summaryVariantId}/approve`, {
        method: 'POST',
        body: JSON.stringify({ qr_ids: qrIds }),
      });
      const result = await res.json();

      if (!res.ok) {
        setSummaryStatusMessage(result.message || 'Could not confirm the selected units.');
        return;
      }

      setSummaryStatusMessage(`${result.approved_count} unit(s) confirmed.`);
      setSummaryRows([]);
      setTimeout(() => closeSummary(), 900);
    } catch (err) {
      setSummaryStatusMessage('Could not reach server. Check it is running.');
      console.error(err);
    } finally {
      setIsProcessingSummary(false);
    }
  };

  const orderedScanCart = useMemo(() => (
    sortMode === 'serial'
      ? [...scanCart].sort((a, b) => (
        String(a.label_id ?? '').localeCompare(
          String(b.label_id ?? ''),
          undefined,
          { numeric: true, sensitivity: 'base' }
        )
      ))
      : [...scanCart].reverse()
  ), [scanCart, sortMode]);
  const normalizedScanSearch = normalizeSerialSearch(debouncedScanSearchTerm.trim());
  const filteredScanCart = useMemo(() => (
    normalizedScanSearch
      ? orderedScanCart.filter((item) => normalizeSerialSearch(item.label_id).includes(normalizedScanSearch))
      : orderedScanCart
  ), [orderedScanCart, normalizedScanSearch]);
  const scanCartTotalPages = Math.max(1, Math.ceil(filteredScanCart.length / SCAN_CART_PAGE_SIZE));
  const pagedScanCart = filteredScanCart.slice(
    (scanCartPage - 1) * SCAN_CART_PAGE_SIZE,
    scanCartPage * SCAN_CART_PAGE_SIZE
  );

  useEffect(() => {
    setScanCartPage((currentPage) => Math.min(currentPage, scanCartTotalPages));
  }, [scanCartTotalPages]);

  const summaryTotalPages = Math.max(1, Math.ceil(summaryRows.length / SUMMARY_PAGE_SIZE));
  const pagedSummaryRows = summaryRows.slice(
    (summaryPage - 1) * SUMMARY_PAGE_SIZE,
    summaryPage * SUMMARY_PAGE_SIZE
  );
  

  return (
    <div className={`aq-page ${isCameraOpen ? 'aq-camera-active' : ''}`}>

      <div className="aq-layout">
        {/* --- Left column: Scan station + scanned list --- */}
        <div className="aq-left-col">
          <section className="aq-scan-station">
            <div className="aq-scan-station-header">
              <h3>Scan station</h3>
              <span className="aq-scanner-status">
                <span className="aq-scanner-dot" />
                Scanner ready
              </span>
              {isCameraOpen && <span className="aq-scan-live-count">{scanCart.length} scanned</span>}
            </div>

            {!isCameraOpen ? (
              <form className="aq-scan-row" onSubmit={handleScanSubmit}>
                <div className="aq-scan-input-wrap">
                  <ScanBarcode size={18} className="aq-scan-icon" />
                  <input
                    ref={scanInputRef}
                    type="text"
                    value={scanInput}
                    onChange={(e) => setScanInput(e.target.value)}
                    placeholder="Point scanner here, or type a serial / QR value"
                    autoFocus
                  />
                </div>
                <button type="submit" className="aq-btn-add">
                  Add
                </button>
                <div className="aq-camera-actions">
                  <button
                    type="button"
                    className="aq-btn-camera"
                    onClick={toggleCamera}
                    aria-label="Use camera"
                  >
                    <Camera size={18} />
                  </button>
                  <SnapAndScanButton
                    onDetected={handleSnapDetected}
                    onScanningChange={handlePhotoScanningChange}
                    onSnapStart={handleSnapStart}
                    onSnapComplete={handleSnapComplete}
                    lastExpectedCount={lastSnapExpectedCount}
                    onExpectedCountChange={setLastSnapExpectedCount}
                  />
                </div>
              </form>
            ) : (
              <div className="aq-camera-actions aq-camera-actions-full">
                <button
                  type="button"
                  className="aq-btn-camera aq-btn-camera-active aq-btn-camera-full"
                  onClick={toggleCamera}
                  aria-label="Stop camera"
                >
                  <Camera size={18} /> Stop scanning
                </button>
                <SnapAndScanButton
                  onDetected={handleSnapDetected}
                  onScanningChange={handlePhotoScanningChange}
                  onSnapStart={handleSnapStart}
                  onSnapComplete={handleSnapComplete}
                  lastExpectedCount={lastSnapExpectedCount}
                  onExpectedCountChange={setLastSnapExpectedCount}
                />
              </div>
            )}

            {isCameraOpen && (
              <div className="aq-camera-block">
                <MultiQrScanner
                  ref={scannerRef}
                  isActive={isCameraOpen}
                  paused={isSubmitting || isSummaryOpen || isPhotoScanning}
                  maxCodesPerShot={200}
                  scannedCount={scanCart.length}
                  onDetected={scanCameraBatch}
                  onError={(message) => {
                    notify(message, { title: 'Camera error', danger: true });
                    setIsCameraOpen(false);
                  }}
                  overlayContent={
                    <>
                      <div className="aq-camera-summary">
                        <strong>{scanCart.length} scanned</strong>
                        <div className="aq-camera-chips">
                          {[...scanCart].slice(-3).reverse().map((item) => (
                            <span
                              key={item.scanKey || item.qr_batch}
                              className={`aq-camera-chip aq-camera-chip-${item.scanState || 'ok'}`}
                            >
                              {item.scanState === 'checking' ? 'Checking…' : item.label_id}
                            </span>
                          ))}
                        </div>
                      </div>
                      {cameraToast && <div className="aq-camera-toast" role="status">{cameraToast}</div>}
                    </>
                  }
                />
                {scanSuccessMessage && (
                  <div className="aq-camera-scan-flash">{scanSuccessMessage}</div>
                )}
              </div>
            )}

            <div className="aq-scan-hints">
              <span>ENTER to add · scans append automatically</span>
              <span>No duplicates</span>
            </div>

            

            <div className="aq-divider" />

            <p className="aq-range-label">Or key in a serial range</p>

            <form className="aq-range-row" onSubmit={handleAddRange}>
              <input
                type="text"
                className="aq-range-prefix"
                value={rangePrefix}
                onChange={(e) => setRangePrefix(e.target.value)}
                placeholder="eg: SS"
              />
              <div className="aq-range-field">
                <span className="aq-range-field-label"></span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={rangeFrom}
                  onChange={(e) => setRangeFrom(e.target.value)}
                  placeholder="From"
                />
              </div>
              <span className="aq-range-arrow">→</span>
              <div className="aq-range-field">
                <span className="aq-range-field-label"></span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={rangeTo}
                  onChange={(e) => setRangeTo(e.target.value)}
                  placeholder="To"
                />
              </div>
              <button
                type="submit"
                className="aq-btn-add-range"
                disabled={isAddingRange || !rangeFrom || !rangeTo}
              >
                {isAddingRange ? 'Adding…' : 'Add'}
              </button>
            </form>

            <p className="aq-range-hint">Numbers only · prefix is optional · leading zeros kept</p>

              {scanSuccessMessage && (
                <p className="aq-success-text-on-dark">
                  {scanSuccessMessage}
                </p>
              )}
          </section>

          {snapReport && (
            <section className="aq-snap-report" aria-label="Snap result" role="status" aria-live="polite">
              <div className="aq-snap-report-header">
                <h4>Snap result</h4>
                <button
                  type="button"
                  className="aq-snap-report-dismiss"
                  onClick={() => setSnapReport(null)}
                  aria-label="Dismiss snap result"
                >
                  <X size={16} />
                </button>
              </div>
              {snapReport.allAdded && (
                <p className="aq-snap-report-success">
                  All {snapReport.added} codes added
                </p>
              )}
              <div className="aq-snap-report-counts">
                <span>
                  Photo read <strong>{snapReport.read}</strong>
                  {snapReport.expected > 0 && ` (expected ${snapReport.expected})`}
                </span>
                <span>Added to list <strong>{snapReport.added}</strong></span>
                <span>Failed lookup <strong>{snapReport.failures.length}</strong></span>
                {snapReport.notDetected > 0 && (
                  <span>Not detected <strong>{snapReport.notDetected}</strong></span>
                )}
              </div>
              {snapReport.notDetected > 0 && (
                <p className="aq-snap-report-note">
                  {snapReport.notDetected} expected code{snapReport.notDetected === 1 ? '' : 's'} not detected.
                </p>
              )}
              {snapReport.missingCellHint > 0
                && (snapReport.expected === 0 || snapReport.read < snapReport.expected) && (
                <p className="aq-snap-report-hint">
                  Photo may be missing ~{snapReport.missingCellHint} code{snapReport.missingCellHint === 1 ? '' : 's'}.
                </p>
              )}
              {snapReport.sequenceGaps.length > 0 && (
                <div className="aq-snap-report-group">
                  <strong>Possibly missing</strong>
                  <div className="aq-snap-report-chips">
                    {snapReport.sequenceGaps.map((serial) => (
                      <button
                        key={serial}
                        type="button"
                        className="aq-snap-report-chip aq-snap-report-chip-missing"
                        onClick={() => focusScanInput(serial)}
                      >
                        {serial}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {snapReport.failureGroups.map(({ reason, serials }) => (
                <div className="aq-snap-report-group" key={reason}>
                  <strong>{reason}</strong>
                  <div className="aq-snap-report-chips">
                    {serials.map((serial) => (
                      <button
                        key={serial}
                        type="button"
                        className="aq-snap-report-chip aq-snap-report-chip-failed"
                        onClick={() => focusScanInput(serial)}
                      >
                        {serial}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div className="aq-snap-report-actions">
                <button
                  type="button"
                  className="aq-snap-report-add"
                  onClick={() => enqueueScanBatch(snapReport.retrySerials)}
                  disabled={snapReport.retrySerials.length === 0}
                >
                  Add missing ({snapReport.retrySerials.length})
                </button>
                <button
                  type="button"
                  className="aq-snap-report-manual"
                  onClick={() => focusScanInput()}
                >
                  Scan manually
                </button>
              </div>
            </section>
          )}

          <section className="aq-scanned-card" ref={scannedListRef}>
            <div className="aq-scanned-header">
              <span className="aq-scanned-title">Scanned this session</span>
              <span className="aq-scanned-count-badge">{scanCart.length}</span>
              <div className="aq-scanned-header-spacer" />
              <div className="aq-sort-toggle" role="group" aria-label="Scanned code order">
                <button
                  type="button"
                  className={sortMode === 'newest' ? 'is-active' : ''}
                  onClick={() => {
                    setSortMode('newest');
                    setScanCartPage(1);
                  }}
                  aria-pressed={sortMode === 'newest'}
                >
                  Newest
                </button>
                <button
                  type="button"
                  className={sortMode === 'serial' ? 'is-active' : ''}
                  onClick={() => {
                    setSortMode('serial');
                    setScanCartPage(1);
                  }}
                  aria-pressed={sortMode === 'serial'}
                >
                  Serial A-Z
                </button>
              </div>
              <button type="button" className="aq-btn-clear-all" onClick={clearCart} disabled={scanCart.length === 0}>
                Clear all
              </button>
            </div>

            <div className="aq-scan-search">
              <Search size={17} aria-hidden="true" />
              <input
                type="text"
                value={scanSearchTerm}
                onChange={(event) => {
                  setScanSearchTerm(event.target.value);
                  setScanCartPage(1);
                }}
                placeholder="Search serial, e.g. 021745"
                aria-label="Search scanned serials"
              />
              {scanSearchTerm && (
                <button
                  type="button"
                  onClick={() => {
                    setScanSearchTerm('');
                    setDebouncedScanSearchTerm('');
                    setScanCartPage(1);
                  }}
                  aria-label="Clear search"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              )}
            </div>
            {debouncedScanSearchTerm.trim() && (
              <p className="aq-scan-search-results" aria-live="polite">
                Showing {filteredScanCart.length} of {scanCart.length}
              </p>
            )}

            {debouncedScanSearchTerm.trim() && filteredScanCart.length === 0 ? (
              <div className="aq-scan-search-empty">
                <p>{debouncedScanSearchTerm.trim()} is not in this list</p>
                <div>
                  {/^[A-Za-z0-9-]{3,}$/.test(debouncedScanSearchTerm.trim()) && (
                    <button
                      type="button"
                      className="aq-scan-search-add"
                      onClick={() => {
                        enqueueScanBatch([debouncedScanSearchTerm.trim()]);
                      }}
                    >
                      Add this serial
                    </button>
                  )}
                  <button
                    type="button"
                    className="aq-scan-search-clear"
                    onClick={() => {
                      setScanSearchTerm('');
                      setDebouncedScanSearchTerm('');
                      setScanCartPage(1);
                    }}
                  >
                    Clear search
                  </button>
                </div>
              </div>
            ) : scanCart.length === 0 ? (
              <p className="aq-empty-state">No codes scanned yet. Scan a label or key in a range above.</p>
            ) : (
              <>
                <ul className="aq-scanned-list">
                  {pagedScanCart.map((item, index) => {
                    const badge = badgeInfo(item);
                    const rowNumber = (scanCartPage - 1) * SCAN_CART_PAGE_SIZE + index + 1;
                    return (
                      <li
                        key={item.scanKey || item.qr_batch}
                        className={`aq-scanned-row ${item.scanState ? `aq-scanned-row-${item.scanState}` : ''}`}
                      >
                        <span className="aq-scanned-index">{String(rowNumber).padStart(2, '0')}</span>
                        <span className="aq-scanned-serial">{item.label_id}</span>
                        <span className={badge.className}>{badge.label}</span>
                        <button
                          type="button"
                          className="aq-scanned-remove"
                          onClick={() => removeFromCart(item.qr_batch)}
                          disabled={item.scanState === 'checking'}
                          aria-label="Remove"
                        >
                          <X size={14} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {scanCartTotalPages > 1 && (
                  <div className="aq-summary-pagination">
                    <button type="button" className="aq-btn-secondary" onClick={() => setScanCartPage((p) => Math.max(1, p - 1))} disabled={scanCartPage <= 1}>
                      Previous
                    </button>
                    <span className="aq-summary-pagination-status">Page {scanCartPage} of {scanCartTotalPages}</span>
                    <button type="button" className="aq-btn-secondary" onClick={() => setScanCartPage((p) => Math.min(scanCartTotalPages, p + 1))} disabled={scanCartPage >= scanCartTotalPages}>
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        {isCameraOpen && (
          <div className="aq-camera-bottom-bar">
            <span>{scanCart.length} scanned</span>
            <button type="button" onClick={() => scannedListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              View list
            </button>
            <button type="button" onClick={toggleCamera}>Stop scanning</button>
          </div>
        )}

        {/* --- Right column: Assignment details --- */}
        <section className="aq-details-card">
          <h3>Assignment details</h3>

          <div className="aq-field">
            <label>Product <span className="required-asterisk">*</span></label>
            <select value={productId} onChange={handleProductChange}>
              <option value="">— Select product —</option>
              {products.map((p) => (
                <option key={p.product_id} value={p.product_id}>{p.product_name}</option>
              ))}
            </select>
          </div>

          <div className="aq-field">
            <label>Variant <span className="required-asterisk">*</span></label>
            <select
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
              disabled={!productId}
            >
              <option value="">{productId ? '— Select variant —' : 'Select a product first'}</option>
              {variantOptions.map((v) => (
                <option key={v.variant_id} value={v.variant_id}>{v.sku}</option>
              ))}
            </select>
          </div>

          <div className="aq-field">
            <div className="aq-field-label-row">
              <label>Remark / Batch Number</label>
              <span className="aq-char-count">{batchNumber.length} / 255</span>
            </div>
            <input
              type="text"
              value={batchNumber}
              onChange={(e) => setBatchNumber(e.target.value.slice(0, 255))}
              placeholder="e.g. BATCH-2026-07"
              maxLength={255}
            />
          </div>

          <div className="aq-field">
            <label>Expiry Date</label>
            <input
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
            />
          </div>

          <div className="aq-queue-summary">
            <span className="aq-queue-count">
              {codesQueued} code{codesQueued === 1 ? '' : 's'} queued
              {checkingCount > 0 && ` · ${checkingCount} checking`}
              {targetLabel && <span className="aq-queue-target"> → {targetLabel}</span>}
            </span>
            <span className={`aq-status-pill ${isReady ? 'aq-status-pill-ready' : ''}`}>
              {isReady ? 'Ready' : 'Incomplete'}
            </span>
          </div>

          {submitMessage && <p className="aq-error-text">{submitMessage}</p>}

          <div className="aq-details-actions">
            <button type="button" className="aq-btn-secondary" onClick={handleCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="aq-btn-primary"
              onClick={handleSubmit}
              disabled={!isReady || isSubmitting}
            >
              {isSubmitting ? 'Assigning…' : `Assign ${codesQueued} code${codesQueued === 1 ? '' : 's'}`}
            </button>
          </div>
        </section>
      </div>

      {/* --- Summary Assign modal --- */}
      {isSummaryOpen && (
        <div className="aq-modal-overlay">
          <div className="aq-modal-panel">
            <div className="aq-modal-header">
              <div className="aq-modal-header-left">
                <h3>Summary Assign: {summaryLabel}</h3>
                <span className="aq-pending-badge">{summaryRows.length} pending</span>
              </div>
              {/*<button type="button" className="aq-modal-close" onClick={closeSummary} aria-label="Close">
                <X size={16} />
              </button>*/}
            </div>

            <div className="aq-modal-body">
              {summaryError && <p className="aq-error-text">{summaryError}</p>}
              {summaryStatusMessage && <p className="aq-status-text">{summaryStatusMessage}</p>}

              {isLoadingSummary ? (
                <p className="aq-empty-state">Loading…</p>
              ) : summaryRows.length === 0 ? (
                <p className="aq-empty-state">No pending assignments — they may have already been processed.</p>
              ) : (
                <>
                  <div className="aq-summary-table-wrapper">
                    <table className="aq-summary-table">
                      <thead>
                        <tr>
                          <th>No.</th>
                          <th>Serial Number</th>
                          <th>New Product Name</th>
                          <th>Previous Product Name</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedSummaryRows.map((r, i) => (
                            <tr key={r.qr_batch}>
                              <td>{(summaryPage - 1) * SUMMARY_PAGE_SIZE + i + 1}</td>
                              <td className="aq-summary-serial-cell">{r.label_id}</td>
                              <td>{displayName(r.target_sku, r.target_product_name)}</td>
                              <td>
                                {r.previous_sku
                                  ? displayName(r.previous_sku, r.previous_product_name)
                                  : <span className="aq-muted-dash">— (first assignment)</span>}
                              </td>
                              <td>
                                <button type="button" className="aq-btn-remove-row" onClick={() => removeSummaryRow(r.qr_batch)}>
                                  Remove
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>

                  {summaryTotalPages > 1 && (
                    <div className="aq-summary-pagination">
                      <button
                        type="button"
                        className="aq-btn-secondary"
                        onClick={() => setSummaryPage((p) => Math.max(1, p - 1))}
                        disabled={summaryPage <= 1}
                      >
                        Previous
                      </button>
                      <span className="aq-summary-pagination-status">
                        Page {summaryPage} of {summaryTotalPages}
                      </span>
                      <button
                        type="button"
                        className="aq-btn-secondary"
                        onClick={() => setSummaryPage((p) => Math.min(summaryTotalPages, p + 1))}
                        disabled={summaryPage >= summaryTotalPages}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="aq-modal-footer aq-modal-footer-end">
              <button
                type="button"
                className="aq-btn-primary aq-btn-primary-auto"
                onClick={confirmSummaryAssign}
                disabled={isProcessingSummary || summaryRows.length === 0}
              >
                {isProcessingSummary ? 'Processing…' : `Confirm & Submit (${summaryRows.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}