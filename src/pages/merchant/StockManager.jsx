// src/pages/merchant/StockManager.jsx
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { ScanBarcode, Camera, X, Trash2, Info, Search } from 'lucide-react';
import { apiFetch, apiFetchScanLookupBatch } from '../../utils/api';
import { formatDateTime, formatRelativeTime } from '../../utils/dateFormat';
import { useNavigate, useLocation } from 'react-router-dom';
import { useConfirm } from '../../context/ConfirmContext';
import MultiQrScanner from '../../components/MultiQrScanner';
import SnapAndScanButton from '../../components/SnapAndScanButton';
import SnapPhotoPreview from '../../components/SnapPhotoPreview';

import '../../styles/StockManager.css';

const PAGE_SIZE = 10;
const RECENT_DAYS = 3;
const MAX_RANGE_SIZE = 500;

function normalizeSerialSearch(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\d+/g, (digits) => digits.replace(/^0+(?=\d)/, ''));
}

function findSerialGaps(serials, { maxGaps = 10 } = {}) {
  const groups = new Map();
  serials.forEach((serial) => {
    const match = String(serial).match(/^(.*?)(\d+)$/);
    if (!match) return;
    const [, prefix, digits] = match;
    const key = `${prefix}\u0000${digits.length}`;
    const group = groups.get(key) || { prefix, width: digits.length, numbers: new Set() };
    group.numbers.add(Number(digits));
    groups.set(key, group);
  });

  const missingSerials = [];
  let ignoredGapCount = 0;
  const serialGroups = [];
  groups.forEach(({ prefix, width, numbers }) => {
    if (numbers.size < 2) return;
    const sorted = [...numbers].sort((a, b) => a - b);
    const gaps = [];
    for (let number = sorted[0] + 1; number < sorted[sorted.length - 1]; number += 1) {
      if (!numbers.has(number)) gaps.push(`${prefix}${String(number).padStart(width, '0')}`);
    }
    serialGroups.push({
      prefix,
      width,
      minimum: sorted[0],
      maximum: sorted[sorted.length - 1],
      presentCount: numbers.size,
      totalCount: sorted[sorted.length - 1] - sorted[0] + 1,
    });
    if (gaps.length > maxGaps) {
      ignoredGapCount += gaps.length;
      return;
    }
    missingSerials.push(...gaps);
  });
  return { missingSerials, ignoredGapCount, groups: serialGroups };
}

function releaseSnapPhotoUrls(photos) {
  const urls = new Set(photos.flatMap((photo) => [photo.url, photo.thumbnailUrl]).filter(Boolean));
  urls.forEach((url) => URL.revokeObjectURL(url));
}



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
  const [snapReport, setSnapReport] = useState(null);
  const [snapPhotos, setSnapPhotos] = useState([]);
  const [activeSnapMarkerId, setActiveSnapMarkerId] = useState(null);
  const [lastSnapExpectedCount, setLastSnapExpectedCount] = useState(0);
  const [scanSearchTerm, setScanSearchTerm] = useState('');
  const [debouncedScanSearchTerm, setDebouncedScanSearchTerm] = useState('');
  const scanCartRef = useRef([]);
  const commitCart = (next) => {
    scanCartRef.current = next;
    setScanCart(next);
  };
  const expandLookupResult = (lookupResult) => {
    if (lookupResult?.kind !== 'bundle') return [lookupResult];
    return (lookupResult.items || []).map((item) => ({
      ...item,
      bundle_id: lookupResult.bundle_id,
      bundle_code: lookupResult.bundle_code,
    }));
  };
  const scanQueueRef = useRef([]);
  const isProcessingQueueRef = useRef(false);

  const [rangePrefix, setRangePrefix] = useState('');
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [isAddingRange, setIsAddingRange] = useState(false);

  const [page, setPage] = useState(1);
  const scanInputRef = useRef(null);
  const snapValuesRef = useRef(new Set());
  const snapFailuresRef = useRef(new Map());
  const snapRepairValuesRef = useRef(new Set());
  const snapRepairPendingRef = useRef(false);
  const snapExpectedRef = useRef(0);
  const snapCompleteRef = useRef(false);
  const snapScanStoppedEarlyRef = useRef(false);
  const snapReportTimerRef = useRef(null);
  const snapPhotosRef = useRef([]);

  useEffect(() => () => releaseSnapPhotoUrls(snapPhotosRef.current), []);

  const clearSnapPhotos = useCallback(() => {
    releaseSnapPhotoUrls(snapPhotosRef.current);
    snapPhotosRef.current = [];
    setSnapPhotos([]);
    setActiveSnapMarkerId(null);
  }, []);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setDebouncedScanSearchTerm(scanSearchTerm);
      setPage(1);
    }, 150);
    return () => window.clearTimeout(timerId);
  }, [scanSearchTerm]);

  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isPhotoScanning, setIsPhotoScanning] = useState(false);
  const [scanSuccessMessage, setScanSuccessMessage] = useState('');
  const [cameraToast, setCameraToast] = useState('');
  const [isCameraDialogOpen, setIsCameraDialogOpen] = useState(false);
  const scanSessionRef = useRef(0);
  const scannerRef = useRef(null);
  const cameraPendingValuesRef = useRef(new Map());
  const cameraPendingStoreRef = useRef(null);
  const cameraBatchTimerRef = useRef(null);
  const cameraBatchRequestRef = useRef(null);
  const flushCameraBatchRef = useRef(null);
  const isPhotoScanningRef = useRef(false);
  const cameraResultQueueRef = useRef(Promise.resolve());
  const cameraDialogRef = useRef(false);
  const recentFailuresRef = useRef(new Map());
  const scanCartSectionRef = useRef(null);

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
    setIsPhotoScanning(isScanning);
    if (!isScanning && cameraPendingValuesRef.current.size > 0) {
      scheduleCameraBatch(0);
    }
  };

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
    cameraPendingStoreRef.current = null;
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
    if (!snapReport?.allAdded) return undefined;
    snapReportTimerRef.current = window.setTimeout(() => {
      setSnapReport(null);
      clearSnapPhotos();
      snapReportTimerRef.current = null;
    }, 4000);
    return () => {
      if (snapReportTimerRef.current !== null) {
        window.clearTimeout(snapReportTimerRef.current);
        snapReportTimerRef.current = null;
      }
    };
  }, [snapReport, clearSnapPhotos]);

  const recordSnapFailure = (value, reason, serial = null) => {
    if (snapValuesRef.current.has(value) || snapRepairValuesRef.current.has(value)) {
      snapFailuresRef.current.set(value, { reason, serial });
    }
  };

  const recordSnapFailures = (failures) => {
    failures.forEach(({ value, message, serial }) => {
      if (snapValuesRef.current.has(value) || snapRepairValuesRef.current.has(value)) {
        snapFailuresRef.current.set(value, { reason: message, serial: serial || null });
      }
    });
  };

  const finishSnapRepairIfReady = () => {
    if (
      !snapRepairPendingRef.current
      || scanQueueRef.current.length > 0
      || scanCartRef.current.some((row) => row.scanState === 'checking')
    ) return;
    snapRepairPendingRef.current = false;
    snapCompleteRef.current = true;
    maybeBuildSnapReport();
  };

  const handleSnapStart = ({ expected }) => {
    clearSnapPhotos();
    snapValuesRef.current = new Set();
    snapFailuresRef.current.clear();
    snapRepairValuesRef.current.clear();
    snapRepairPendingRef.current = false;
    snapExpectedRef.current = expected;
    snapCompleteRef.current = false;
    snapScanStoppedEarlyRef.current = false;
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
      if (!canCreateAdjustments || !isConfigValid || cameraDialogRef.current) {
        values.forEach((value) => {
          snapFailuresRef.current.set(
            value,
            {
              reason: 'Select an adjustment type and store before scanning.',
              serial: null,
            }
          );
        });
        return;
      }
    }
    scanCameraBatch(values, null, metadata);
  };

  const maybeBuildSnapReport = () => {
    if (
      !snapCompleteRef.current
      || cameraPendingValuesRef.current.size > 0
      || cameraBatchRequestRef.current
    ) return;

    const values = [...snapValuesRef.current];
    const expected = snapExpectedRef.current;
    const addedRows = scanCartRef.current.filter((row) => (
      row.scanState === 'ok' && snapValuesRef.current.has(row.scanValue)
    ));
    const repairedRows = scanCartRef.current.filter((row) => (
      row.scanState !== 'checking'
      && snapRepairValuesRef.current.has(row.label_id || row.scanValue)
    ));
    const addedRowsAll = [...new Set([...addedRows, ...repairedRows])];
    const successfulValues = new Set(addedRowsAll.flatMap((row) => [row.scanValue, row.label_id]));
    const failures = [...snapFailuresRef.current.entries()]
      .filter(([value]) => !successfulValues.has(value))
      .map(([value, failure]) => ({ value, ...failure }));
    const failureByValue = new Map(failures.map((failure) => [failure.value, failure]));
    const rejectedNumbers = new Map();
    let nextRejectedNumber = 0;
    const photoValues = new Set(snapPhotosRef.current.flatMap((photo) => (
      (photo.detections || [])
        .map((detection) => String(detection.rawValue || detection.raw_value || detection.value || ''))
        .filter(Boolean)
    )));
    failures.filter((failure) => photoValues.has(failure.value)).forEach((failure) => {
      rejectedNumbers.set(failure.value, ++nextRejectedNumber);
    });
    const notDetected = Math.max(0, expected - values.length - repairedRows.length);
    const validatedHoleCount = snapPhotosRef.current.reduce(
      (count, photo) => count + (photo.validatedHoleCount ?? photo.holes?.length ?? 0),
      0
    );
    const availableHoleCount = snapPhotosRef.current.reduce(
      (count, photo) => count + (photo.holes?.length || 0),
      0
    );
    const canMarkMissing = expected > 0 && notDetected > 0 && availableHoleCount >= 1;
    // TODO remove after verifying orange marker placement.
    console.log('[snap-orange]', {
      expected,
      notDetected,
      validatedHoleCount,
      holes: snapPhotosRef.current.map((photo) => photo.holes?.length || 0),
      basis: snapPhotosRef.current.map((photo) => ({
        a: photo.lattice?.a || null,
        b: photo.lattice?.b || null,
      })),
      spacing: snapPhotosRef.current.map((photo) => photo.lattice?.spacing ?? null),
    });
    const photoMarkers = snapPhotosRef.current.flatMap((photo, photoIndex) => {
      const codeMarkers = (photo.detections || []).flatMap((detection, detectionIndex) => {
        const value = String(detection.rawValue || detection.raw_value || detection.value || '');
        const points = detection.points || [];
        if (!value || points.length === 0) return [];
        const xValues = points.map((point) => point.x);
        const yValues = points.map((point) => point.y);
        const center = points.reduce((sum, point) => ({
          x: sum.x + point.x / points.length,
          y: sum.y + point.y / points.length,
        }), { x: 0, y: 0 });
        const added = scanCartRef.current.some((row) => (
          row.scanState === 'ok' && row.scanValue === value
        ));
        const failure = failureByValue.get(value);
        let number;
        if (!added) {
          if (!rejectedNumbers.has(value)) {
            rejectedNumbers.set(value, ++nextRejectedNumber);
          }
          number = rejectedNumbers.get(value);
        }
        return [{
          id: added ? `added:${photoIndex}:${detectionIndex}:${value}` : `rejected:${value}`,
          kind: added ? 'added' : 'rejected',
          value,
          serial: failure?.serial || null,
          number,
          points,
          x: center.x,
          y: center.y,
          size: Math.max(
            Math.max(...xValues) - Math.min(...xValues),
            Math.max(...yValues) - Math.min(...yValues)
          ),
          photoIndex,
          label: added
            ? `Added code${failure?.serial ? ` ${failure.serial}` : ''}`
            : `Rejected code ${number}${failure?.serial ? `: ${failure.serial}` : ''}`,
        }];
      });
      const codeSizes = codeMarkers
        .map((marker) => marker.size)
        .filter((size) => Number.isFinite(size) && size > 0)
        .sort((left, right) => left - right);
      const middle = Math.floor(codeSizes.length / 2);
      const medianCodeSize = codeSizes.length === 0
        ? 0
        : codeSizes.length % 2 === 0
          ? (codeSizes[middle - 1] + codeSizes[middle]) / 2
          : codeSizes[middle];
      const photoHoles = photo.holes || [];
      const hasGridCoordinates = photoHoles.every((hole) => (
        Number.isFinite(hole.row) && Number.isFinite(hole.column)
      ));
      const orderedPhotoHoles = hasGridCoordinates
        ? [...photoHoles].sort((left, right) => (
          (left.row - right.row) || (left.column - right.column)
        ))
        : [...photoHoles];
      const missingMarkers = canMarkMissing
        ? orderedPhotoHoles.slice(0, notDetected).map((hole, holeIndex) => ({
            id: `missing:${photoIndex}:${holeIndex}`,
            kind: 'missing',
            x: hole.x,
            y: hole.y,
            size: medianCodeSize || hole.size,
            photoIndex,
            label: 'Undetected QR code slot',
          }))
        : [];
      return [...codeMarkers, ...missingMarkers];
    });
    const presentSerials = [...new Set([
      ...addedRowsAll.map((row) => row.label_id).filter(Boolean),
      ...failures.map((failure) => failure.serial).filter(Boolean),
    ])];
    const serialGaps = findSerialGaps(presentSerials);
    const sequenceGaps = serialGaps.missingSerials;
    const serialGroups = serialGaps.groups;
    const serialRange = serialGroups.map(({ prefix, width, minimum, maximum }) => (
      `${prefix}${String(minimum).padStart(width, '0')} to ${prefix}${String(maximum).padStart(width, '0')}`
    )).join(' · ');
    const sequenceCount = serialGroups.reduce((count, group) => count + group.presentCount, 0);
    const sequenceTotal = serialGroups.reduce((count, group) => count + group.totalCount, 0);
    const hasDifferentPrefixes = new Set(serialGroups.map((group) => group.prefix)).size > 1;
    const showIgnoredGapNote = serialGaps.ignoredGapCount > 0
      && !(sequenceGaps.length === 0 && hasDifferentPrefixes);
    const allAdded = values.length > 0
      && addedRowsAll.length >= values.length
      && failures.length === 0
      && sequenceGaps.length === 0
      && serialGaps.ignoredGapCount === 0
      && notDetected === 0;
    const failureGroups = [...new Map(
      failures.map(({ reason }) => [reason, { reason, serials: [] }])
    ).values()];
    failureGroups.forEach((group) => {
      group.items = failures
        .filter((failure) => failure.reason === group.reason)
        .map((failure) => ({
          failure,
          marker: photoMarkers.find((marker) => (
            marker.kind === 'rejected' && marker.value === failure.value
          )),
        }))
        .filter(({ failure, marker }) => failure.serial || marker)
        .map((failure) => ({
          id: `rejected:${failure.failure.value}`,
          serial: failure.failure.serial || null,
          markerId: failure.marker?.id,
          number: failure.marker?.number,
        }));
      group.serials = group.items.map((item) => item.serial);
    });

    snapCompleteRef.current = false;
    setSnapReport({
      read: values.length,
      added: addedRowsAll.length,
      expected,
      notDetected,
      notAdded: failures.length,
      failures,
      failureGroups,
      sequenceGaps,
      photoMarkers,
      retrySerials: sequenceGaps,
      serialRange,
      sequenceCount,
      sequenceTotal,
      ignoredGapCount: serialGaps.ignoredGapCount,
      showIgnoredGapNote,
      scanStoppedEarly: snapScanStoppedEarlyRef.current,
      allAdded,
    });
  };

  const handleSnapComplete = ({ values, expected, scanStoppedEarly, photos = [] }) => {
    snapValuesRef.current = new Set(values);
    snapExpectedRef.current = expected || 0;
    snapScanStoppedEarlyRef.current = Boolean(scanStoppedEarly);
    snapPhotosRef.current = photos;
    setSnapPhotos(photos);
    snapCompleteRef.current = true;
    maybeBuildSnapReport();
  };

  const addMissingSnapSerials = () => {
    const serials = snapReport?.retrySerials || [];
    if (serials.length === 0) return;
    snapRepairValuesRef.current = new Set(serials);
    snapRepairPendingRef.current = true;
    enqueueScanBatch(serials);
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
    if (scanCartRef.current.length > 0) {
      const ok = await confirm(
        'Changing the adjustment type or store will clear your current batch. Continue?',
        { title: 'Discard Changes', confirmLabel: 'Continue', danger: true }
      );
      if (!ok) return false;
      resetScanSession();
      commitCart([]);
      setSubmitMessage('');
      setPage(1);
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
    resetScanSession();
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
    resetScanSession();
    setSourceStore(value);
    setConfigError('');
  };

  const handleFromStoreChange = async (e) => {
    const value = e.target.value;
    if (!(await resetCartIfDirty())) return;
    resetScanSession();
    setFromStore(value);
    setConfigError('');
  };

  const handleToStoreChange = async (e) => {
    const value = e.target.value;
    if (!(await resetCartIfDirty())) return;
    resetScanSession();
    setToStore(value);
    setConfigError('');
  };

  // --- Scanning --------------------------------------------------------------

  const addToCart = async (value, sessionId = scanSessionRef.current) => {
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
    if (sessionId !== scanSessionRef.current) return;

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
        if (scanCartRef.current.length > 0) {
          const switchAndClear = await confirm(
            `${result.message}\n\nYour current batch has ${scanCartRef.current.length} unit(s) from "${currentStoreName}". Switching to "${storeName}" will clear that batch and start fresh with this code.`,
            {
              title: 'Different store',
              confirmLabel: `Switch & clear batch`,
              cancelLabel: `Keep "${currentStoreName}" batch`,
              danger: true,
            }
          );
          if (sessionId !== scanSessionRef.current) return;
          if (!switchAndClear) return; // keep the existing batch, skip this code entirely

          resetScanSession();
          if (isTransfer) {
            setFromStore(result.current_store_id);
          } else {
            setSourceStore(result.current_store_id);
          }

          const retry = await lookup(result.current_store_id);
          if (scanSessionRef.current !== sessionId + 1) return;
          if (!retry.res.ok) {
            notify(`"${value}": ${retry.result.message || 'Could not recognize this code.'}`, { title: 'Scan issue', danger: true });
            return;
          }
          commitCart(expandLookupResult(retry.result)); // start fresh — old batch is discarded
          setPage(1);
          return;
        }

        // Batch is empty — no conflict, just confirm the store switch as before.
        const confirmed = await confirm(
          `${result.message}\n\nSwitch the source store to "${storeName}" and add this code?`,
          { title: 'Wrong store', confirmLabel: 'Switch & add' }
        );
        if (sessionId !== scanSessionRef.current) return;
        if (!confirmed) return;

        if (isTransfer) {
          setFromStore(result.current_store_id);
        } else {
          setSourceStore(result.current_store_id);
        }

        const retry = await lookup(result.current_store_id);
        if (sessionId !== scanSessionRef.current) return;
        if (!retry.res.ok) {
          notify(`"${value}": ${retry.result.message || 'Could not recognize this code.'}`, { title: 'Scan issue', danger: true });
          return;
        }
        commitCart([...scanCartRef.current, ...expandLookupResult(retry.result)]);
        setPage(1);
        return;
      }

      notify(`"${result.label_id || value}": ${result.message || 'Could not recognize this code.'}`, { title: 'Scan issue', danger: true });
      return;
    }


    commitCart([...scanCartRef.current, ...expandLookupResult(result)]);
    setPage(1);

    if (navigator.vibrate) navigator.vibrate(80);
    setScanSuccessMessage(result.kind === 'bundle'
      ? `✓ Bundle ${result.bundle_code} added with ${result.items?.length || 0} units.`
      : `✓ ${result.label_id} added.`);
    setTimeout(() => setScanSuccessMessage(''), 2000);
    } catch (err) {
      if (sessionId !== scanSessionRef.current) return;
      notify('Could not reach server. Check it is running.', { title: 'Network error', danger: true });
    console.error(err);
  }
};

  // Serializes scans so a fast USB scanner (which fires Enter far quicker
  // than addToCart's network round-trip) can't run addToCart concurrently
  // and race on scanCartRef.current, silently dropping scans.
  const enqueueScanBatch = (values) => {
    const batch = values.map((value) => value.trim()).filter(Boolean);
    if (batch.length === 0) return;
    scanQueueRef.current.push({ batch, sessionId: scanSessionRef.current });
    processScanQueue();
  };

  const enqueueScan = (value) => enqueueScanBatch([value]);

  const processScanQueue = async () => {
    if (isProcessingQueueRef.current) return;
    isProcessingQueueRef.current = true;
    while (scanQueueRef.current.length > 0) {
      const { batch, sessionId } = scanQueueRef.current.shift();
      if (sessionId !== scanSessionRef.current) continue;
      if (batch.length > 1) {
        await addManyToCart(batch);
      } else {
        await addToCart(batch[0], sessionId);
      }
    }
    isProcessingQueueRef.current = false;
    finishSnapRepairIfReady();
  };

    const handleScanSubmit = (e) => {
    e.preventDefault();
    if (!scanInput.trim()) return;
    enqueueScan(scanInput.trim());
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
    const sessionId = scanSessionRef.current;
    if (!canCreateAdjustments) return;
    if (!isConfigValid) {
      notify('Please select an adjustment type and store before scanning.');
      return;
    }

    const fromStoreForType = SOURCE_STORE_TYPES.includes(selectedTypeKey)
      ? sourceStore
      : (isTransfer ? fromStore : '');

    let current = [...scanCartRef.current];
    const failures = [];
    let successCount = 0;

    for (let offset = 0; offset < values.length; offset += 100) {
      const chunk = values.slice(offset, offset + 100).map((value) => value.trim()).filter(Boolean);
      const candidates = [];
      chunk.forEach((value) => {
        if (current.some((item) => item.label_id === value || item.qr_id === value)
          || candidates.includes(value)) {
          failures.push({ value, message: 'already scanned' });
        } else {
          candidates.push(value);
        }
      });
      if (candidates.length === 0) continue;

      try {
        const results = await apiFetchScanLookupBatch(
          '/api/transactions/scan-lookup-batch',
          candidates,
          {
            transaction_type: selectedType.txType,
            from_store_id: fromStoreForType,
          },
          (value) => {
            const params = new URLSearchParams({
              serial_number: value,
              transaction_type: selectedType.txType,
            });
            if (fromStoreForType) params.set('from_store_id', fromStoreForType);
            return `/api/transactions/scan-lookup?${params.toString()}`;
          }
        );
        if (sessionId !== scanSessionRef.current) return;
        current = [...scanCartRef.current];
        results.forEach((result) => {
          if (!result.ok) {
            const value = result.label_id || result.value;
            const message = result.message || 'could not be recognized';
            failures.push({ value, message });
            if (snapRepairValuesRef.current.has(value)) {
              recordSnapFailure(value, message, result.label_id || null);
            }
            return;
          }
          const expanded = result.kind === 'bundle'
            ? (result.items || []).map((item) => ({
                ...item,
                bundle_id: result.bundle_id,
                bundle_code: result.bundle_code,
              }))
            : [result.data];
          for (const item of expanded) {
            if (current.some((row) => row.qr_batch === item.qr_batch || row.label_id === item.label_id)) continue;
            current = [...current, item];
            successCount++;
          }
        });
        commitCart(current);
        setPage(1);
      } catch (err) {
        if (sessionId !== scanSessionRef.current) return;
        candidates.forEach((value) => {
          const message = 'could not reach server';
          failures.push({ value, message });
          if (snapRepairValuesRef.current.has(value)) recordSnapFailure(value, message, value);
        });
        console.error(err);
      }
    }

    if (sessionId !== scanSessionRef.current) return;

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
      if (isCameraOpen) {
        showCameraFailures(failures);
      } else {
        notify(text, { title: 'Scan issue', danger: true });
      }
    }

    return { successCount, failures };
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
    const storeIdOverride = cameraPendingStoreRef.current;
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
          const currentFromStore = storeIdOverride || (
            SOURCE_STORE_TYPES.includes(selectedTypeKey)
              ? sourceStore
              : (isTransfer ? fromStore : '')
          );
          const controller = new AbortController();
          request.controller = controller;
          let attemptTimedOut = false;
          let timeoutId;
          try {
            const lookup = apiFetchScanLookupBatch(
              '/api/transactions/scan-lookup-batch',
              values,
              {
                transaction_type: selectedType.txType,
                from_store_id: currentFromStore,
              },
              (value) => {
                const params = new URLSearchParams({
                  serial_number: value,
                  transaction_type: selectedType.txType,
                });
                if (currentFromStore) params.set('from_store_id', currentFromStore);
                return `/api/transactions/scan-lookup?${params.toString()}`;
              },
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

        const previous = cameraResultQueueRef.current;
        let releaseResultLock;
        cameraResultQueueRef.current = new Promise((resolve) => {
          releaseResultLock = resolve;
        });
        await previous;
        try {
          if (sessionId !== scanSessionRef.current) return;
          const successfulRows = new Map();
          const failures = [];
          const wrongStoreResults = [];
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
            } else if (result.wrong_store && result.current_store_id) {
              wrongStoreResults.push({ ...result, value: result.value });
              recordSnapFailure(
                result.value,
                result.message || 'belongs to another store',
                result.label_id || null
              );
            } else {
              const message = result.message || 'Could not recognize this code.';
              failures.push({ value: result.label_id || result.value, message });
              recordSnapFailure(result.value, message, result.label_id || null);
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

          if (wrongStoreResults.length === 0) return;

          const storeGroups = new Map();
          wrongStoreResults.forEach((item) => {
            const group = storeGroups.get(item.current_store_id) || [];
            group.push(item);
            storeGroups.set(item.current_store_id, group);
          });
          const groupedText = [...storeGroups.entries()]
            .map(([storeId, items]) => {
              const storeName = items[0].current_store_name || stores.find((store) => store.store_id === storeId)?.location || 'another store';
              return `${items.length} code${items.length === 1 ? '' : 's'} belong${items.length === 1 ? 's' : ''} to "${storeName}": ${items.map((item) => item.value).join(', ')}`;
            })
            .join('\n');

          cameraDialogRef.current = true;
          setIsCameraDialogOpen(true);
          const targetStoreIds = [...storeGroups.keys()];
          const canSwitchTogether = targetStoreIds.length === 1;
          const readyCount = scanCartRef.current.filter((item) => item.scanState === 'ok' || !item.scanState).length;
          const message = canSwitchTogether
            ? `${groupedText}\n\n${readyCount > 0 ? `Your current batch has ${readyCount} unit(s). Switching stores will clear that batch. ` : ''}Switch to this store and add these codes?`
            : `${groupedText}\n\nThese codes belong to different stores. Scan codes from one store at a time.`;
          const confirmed = await confirm(message, {
            title: 'Different store',
            confirmLabel: canSwitchTogether ? (readyCount > 0 ? 'Switch & clear batch' : 'Switch & add') : 'OK',
            hideCancel: !canSwitchTogether,
            cancelLabel: 'Keep current store',
            danger: readyCount > 0 && canSwitchTogether,
          });
          cameraDialogRef.current = false;
          setIsCameraDialogOpen(false);

          if (sessionId !== scanSessionRef.current || !confirmed || !canSwitchTogether) {
            wrongStoreResults.forEach((item) => recentFailuresRef.current.set(item.value, Date.now()));
            return;
          }

          const targetStoreId = targetStoreIds[0];
          resetScanSession();
          commitCart([]);
          setPage(1);
          if (isTransfer) {
            setFromStore(targetStoreId);
          } else {
            setSourceStore(targetStoreId);
          }
          wrongStoreResults.forEach((item) => recentFailuresRef.current.delete(item.value));
          scanCameraBatch(wrongStoreResults.map((item) => item.value), targetStoreId);
        } finally {
          releaseResultLock();
        }
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
      if (cameraPendingValuesRef.current.size === 0) cameraPendingStoreRef.current = null;
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
      finishSnapRepairIfReady();
      maybeBuildSnapReport();
    }
  };
  flushCameraBatchRef.current = flushCameraBatch;

  const scanCameraBatch = (values, storeIdOverride = null, metadata = null) => {
    if (!canCreateAdjustments || !isConfigValid || cameraDialogRef.current) return;
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
      pendingValues.set(value, `camera-${sessionId}-${now}-${pendingValues.size}`);
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
      const nextCart = [...filtered, ...next.slice(current.length)];
      pendingValues.forEach((scanKey, value) => cameraPendingValuesRef.current.set(value, scanKey));
      if (storeIdOverride) cameraPendingStoreRef.current = storeIdOverride;
      commitCart(nextCart);
      setPage(1);
      scheduleCameraBatch();
    }
    if (duplicates.length > 0) {
      recordSnapFailures(duplicates);
      showCameraFailures(duplicates);
    }
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

  const removeFromCart = async (qrBatch) => {
    const target = scanCartRef.current.find((item) => item.qr_batch === qrBatch);
    if (target?.bundle_id) {
      const confirmed = await confirm(`Remove bundle ${target.bundle_code || ''}? This removes all of its items from the batch.`, {
        title: 'Remove bundle',
        confirmLabel: 'Remove bundle',
        cancelLabel: 'Cancel',
        danger: true,
      });
      if (!confirmed) return;
    }
    const next = target?.bundle_id
      ? scanCartRef.current.filter((item) => item.bundle_id !== target.bundle_id)
      : scanCartRef.current.filter((item) => item.qr_batch !== qrBatch);
    commitCart(next);
    const totalPages = Math.max(1, Math.ceil(next.length / PAGE_SIZE));
    setPage((p) => Math.min(p, totalPages));
  };

  const clearCart = () => {
    resetScanSession();
    commitCart([]);
    setSubmitMessage('');
    setPage(1);
    snapCompleteRef.current = false;
    snapValuesRef.current.clear();
    snapFailuresRef.current.clear();
    snapRepairValuesRef.current.clear();
    snapRepairPendingRef.current = false;
    setSnapReport(null);
    clearSnapPhotos();
  };

  const toggleCamera = () => {
    if (!isCameraOpen) {
      if (!canCreateAdjustments) return;
      if (!isConfigValid) {
        notify('Please select an adjustment type and store before scanning.');
        return;
      }
    }
    if (isCameraOpen && cameraPendingValuesRef.current.size > 0) {
      if (cameraBatchTimerRef.current !== null) {
        window.clearTimeout(cameraBatchTimerRef.current);
        cameraBatchTimerRef.current = null;
      }
      flushCameraBatch();
    }
    setIsCameraOpen((open) => !open);
  };

  // --- Pagination ------------------------------------------------------------

  const readyCart = scanCart.filter((item) => item.scanState !== 'checking');
  const checkingCount = scanCart.filter((item) => item.scanState === 'checking').length;
  const orderedScanCart = useMemo(() => [...scanCart].reverse(), [scanCart]);
  const normalizedScanSearch = normalizeSerialSearch(debouncedScanSearchTerm.trim());
  const filteredScanCart = useMemo(() => (
    normalizedScanSearch
      ? orderedScanCart.filter((item) => normalizeSerialSearch(item.label_id).includes(normalizedScanSearch))
      : orderedScanCart
  ), [orderedScanCart, normalizedScanSearch]);
  const totalPages = Math.max(1, Math.ceil(filteredScanCart.length / PAGE_SIZE));
  const pagedCart = filteredScanCart.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, totalPages));
  }, [totalPages]);
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
    () => new Set(readyCart.map((i) => i.variant_id)).size,
    [readyCart]
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
    if (readyCart.length === 0) return '0 units';
    if (selectedTypeKey === 'STOCK_OUT' || selectedTypeKey === 'DAMAGE') return `-${readyCart.length} units`;
    if (selectedTypeKey === 'TRANSFER') return `+${readyCart.length} units`;
    return `+${readyCart.length} units`;
  })();

  const netChangeClass = (() => {
    if (readyCart.length === 0) return '';
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
      if (checkingCount > 0) {
        setSubmitMessage('Wait for all QR lookups to finish.');
        return;
      }
      if (readyCart.length === 0) {
        notify('Scan at least one unit first.');
        return;
      }
      setReviewRows(readyCart.map((item) => ({ ...item })));
      setReviewPage(1);
      setIsReviewOpen(true);
    };

    const removeReviewRow = async (qrBatch) => {
      const target = reviewRows.find((item) => item.qr_batch === qrBatch);
      if (target?.bundle_id) {
        const confirmed = await confirm(`Remove bundle ${target.bundle_code || ''}? This removes all of its items from the review.`, {
          title: 'Remove bundle',
          confirmLabel: 'Remove bundle',
          cancelLabel: 'Cancel',
          danger: true,
        });
        if (!confirmed) return;
        setReviewRows((prev) => prev.filter((r) => r.bundle_id !== target.bundle_id));
        return;
      }
      setReviewRows((prev) => prev.filter((r) => r.qr_batch !== qrBatch));
    };

    const rejectReview = () => {
      resetScanSession();
      setIsReviewOpen(false);
      setReviewRows([]);
      commitCart([]);
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
            Object.entries(groups).map(([variantId, qrIds]) =>
              apiFetch('/api/transactions/scan-move', {
                method: 'POST',
                body: JSON.stringify({
                  qr_ids: qrIds,
                  transaction_type: selectedType.txType,
                  from_store_id,
                  to_store_id,
                  reference_doc: !isTransfer ? (referenceDoc || null) : null,
                  bundle_ids: [...new Set(reviewRows.filter((item) => item.variant_id === variantId && item.bundle_id).map((item) => item.bundle_id))],
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

          resetScanSession();
          commitCart([]);
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
    if (scanCartRef.current.length > 0) {
      const ok = await confirm('Discard this batch and reset the form?', {
        title: 'Discard Changes',
        confirmLabel: 'Discard',
        danger: true,
      });
      if (!ok) return;
    }
    resetScanSession();
    commitCart([]);
    setSelectedTypeKey('');
    setSourceStore('');
    setFromStore('');
    setToStore('');
    setReferenceDoc('');
    setRemark('');
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
    <div className={`sa-page ${isCameraOpen ? 'sa-camera-active' : ''}`}>
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
              <div className="sa-camera-actions">
                <button type="button" className="sa-btn-camera" onClick={toggleCamera} disabled={!isConfigValid || !canCreateAdjustments}>
                  <Camera size={18} />
                </button>
                <SnapAndScanButton
                  onDetected={handleSnapDetected}
                  onScanningChange={handlePhotoScanningChange}
                  onSnapStart={handleSnapStart}
                  onSnapComplete={handleSnapComplete}
                  lastExpectedCount={lastSnapExpectedCount}
                  onExpectedCountChange={setLastSnapExpectedCount}
                  disabled={!isConfigValid || !canCreateAdjustments}
                />
              </div>
            </form>
          ) : (
            <div className="sa-camera-actions sa-camera-actions-full">
              <button
                type="button"
                className="sa-btn-camera sa-btn-camera-active sa-btn-camera-full"
                onClick={toggleCamera}
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
                disabled={!isConfigValid || !canCreateAdjustments}
              />
            </div>
          )}



          {isCameraOpen && (
            <div className="sa-camera-block">
              <MultiQrScanner
                ref={scannerRef}
                isActive={isCameraOpen}
                paused={isCameraDialogOpen || isReviewOpen || isSubmitting || isPhotoScanning}
                maxCodesPerShot={200}
                scannedCount={scanCart.length}
                onDetected={scanCameraBatch}
                onError={(message) => {
                  notify(message, { title: 'Camera error', danger: true });
                  setIsCameraOpen(false);
                }}
                overlayContent={
                  <>
                    <div className="sa-camera-summary">
                      <strong>{scanCart.length} scanned</strong>
                      <div className="sa-camera-chips">
                        {[...scanCart].slice(-3).reverse().map((item) => (
                          <span
                            key={item.scanKey || item.qr_batch}
                            className={`sa-camera-chip sa-camera-chip-${item.scanState || 'ok'}`}
                          >
                            {item.scanState === 'checking' ? 'Checking…' : item.label_id}
                          </span>
                        ))}
                      </div>
                    </div>
                    {cameraToast && <div className="sa-camera-toast" role="status">{cameraToast}</div>}
                  </>
                }
              />
              {scanSuccessMessage && (
                <div className="sa-camera-scan-flash">{scanSuccessMessage}</div>
              )}
            </div>
          )}

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

        {snapReport && (
          <section className="sa-snap-report" aria-label="Snap result" role="status" aria-live="polite">
            <div className="sa-snap-report-header">
              <h4>Snap result</h4>
              <button
                type="button"
                className="sa-snap-report-dismiss"
                onClick={() => {
                  setSnapReport(null);
                  clearSnapPhotos();
                }}
                aria-label="Dismiss snap result"
              >
                <X size={16} />
              </button>
            </div>
            {snapReport.allAdded && (
              <p className="sa-snap-report-success">
                All {snapReport.added} codes added
              </p>
            )}
            <div className="sa-snap-report-counts">
              <span>
                Read <strong>{snapReport.read}</strong>
                {snapReport.expected > 0 && <> of <strong>{snapReport.expected}</strong></>}
                {' '}· Added <strong>{snapReport.added}</strong>
                {' '}· Not added <strong>{snapReport.notAdded}</strong>
              </span>
              {snapReport.notDetected > 0 && (
                <span>Not detected <strong>{snapReport.notDetected}</strong></span>
              )}
            </div>
            <SnapPhotoPreview
              photos={snapPhotos}
              markers={snapReport.photoMarkers}
              activeMarkerId={activeSnapMarkerId}
              onHighlightMarker={setActiveSnapMarkerId}
            />
            {snapReport.serialRange && (
              <p className="sa-snap-report-note">
                Serial range: {snapReport.serialRange} · {snapReport.sequenceCount} of {snapReport.sequenceTotal} in sequence
              </p>
            )}
            {snapReport.showIgnoredGapNote && (
              <p className="sa-snap-report-note">
                Serials are not continuous ({snapReport.ignoredGapCount} gaps); check manually
              </p>
            )}
            {snapReport.scanStoppedEarly && (
              <p className="sa-snap-report-hint">Scan stopped early</p>
            )}
            {snapReport.sequenceGaps.length > 0 && (
              <div className="sa-snap-report-group">
                <strong>Possibly missing</strong>
                <div className="sa-snap-report-chips">
                  {snapReport.sequenceGaps.map((serial) => (
                    <button
                      key={serial}
                      type="button"
                      className="sa-snap-report-chip sa-snap-report-chip-missing"
                      onClick={() => focusScanInput(serial)}
                    >
                      {serial}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {snapReport.failureGroups.map(({ reason, items }) => (
              <div className="sa-snap-report-group" key={reason}>
                <strong>{reason}</strong>
                <div className="sa-snap-report-chips">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`sa-snap-report-chip sa-snap-report-chip-failed${item.markerId && item.markerId === activeSnapMarkerId ? ' is-active' : ''}`}
                      onClick={() => {
                        if (item.markerId) setActiveSnapMarkerId(item.markerId);
                        if (item.serial) focusScanInput(item.serial);
                      }}
                      aria-pressed={Boolean(item.markerId && item.markerId === activeSnapMarkerId)}
                    >
                      {item.number ? `#${item.number} ` : ''}{item.serial || 'Code'}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <p className="sa-snap-report-note sa-snap-report-edge-note">
              Edge limitation: codes beyond the serial range may be missed.
            </p>
            <div className="sa-snap-report-actions">
              {snapReport.retrySerials.length > 0 && (
                <>
                  <p className="sa-snap-report-safety">
                    Adds these serials from the sequence. Only tap if the labels on your sheet are in this order.
                  </p>
                  <button
                    type="button"
                    className="sa-snap-report-add"
                    onClick={addMissingSnapSerials}
                  >
                    Add missing ({snapReport.retrySerials.length})
                  </button>
                </>
              )}
              <button
                type="button"
                className="sa-snap-report-manual"
                onClick={() => focusScanInput()}
              >
                Scan manually
              </button>
            </div>
          </section>
        )}

        {/* --- Batch table --- */}
        <section className="sa-card" ref={scanCartSectionRef}>
          <div className="sa-batch-header">
            <span className="sa-batch-title">Batch</span>
            <span className="sa-batch-count-badge">{scanCart.length} UNIT{scanCart.length === 1 ? '' : 'S'}</span>
            <div className="sa-batch-header-spacer" />
            <button type="button" className="sa-btn-clear-batch" onClick={clearCart} disabled={scanCart.length === 0}>
              Clear batch
            </button>
          </div>

          <div className="sa-scan-search">
            <Search size={17} aria-hidden="true" />
            <input
              type="text"
              value={scanSearchTerm}
              onChange={(event) => {
                setScanSearchTerm(event.target.value);
                setPage(1);
              }}
              placeholder="Search serial, e.g. 021745"
              aria-label="Search batch serials"
            />
            {scanSearchTerm && (
              <button
                type="button"
                onClick={() => {
                  setScanSearchTerm('');
                  setDebouncedScanSearchTerm('');
                  setPage(1);
                }}
                aria-label="Clear search"
              >
                <X size={16} aria-hidden="true" />
              </button>
            )}
          </div>
          {debouncedScanSearchTerm.trim() && (
            <p className="sa-scan-search-results" aria-live="polite">
              Showing {filteredScanCart.length} of {scanCart.length}
            </p>
          )}

          {debouncedScanSearchTerm.trim() && filteredScanCart.length === 0 ? (
            <div className="sa-scan-search-empty">
              <p>{debouncedScanSearchTerm.trim()} is not in this list</p>
              <div>
                {/^[A-Za-z0-9-]{3,}$/.test(debouncedScanSearchTerm.trim()) && (
                  <button
                    type="button"
                    className="sa-scan-search-add"
                    onClick={() => {
                      enqueueScanBatch([debouncedScanSearchTerm.trim()]);
                    }}
                  >
                    Add this serial
                  </button>
                )}
                <button
                  type="button"
                  className="sa-scan-search-clear"
                  onClick={() => {
                    setScanSearchTerm('');
                    setDebouncedScanSearchTerm('');
                    setPage(1);
                  }}
                >
                  Clear search
                </button>
              </div>
            </div>
          ) : scanCart.length === 0 ? (
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
                        <tr key={item.scanKey || item.qr_batch} className={item.scanState === 'checking' ? 'sa-scan-row-checking' : ''}>
                          <td className="sa-col-no">{String(rowNumber).padStart(2, '0')}</td>
                          <td className="sa-serial-cell">
                            {item.label_id}
                            {item.bundle_code && <span className="sa-bundle-chip">{item.bundle_code}</span>}
                          </td>
                          <td className="sa-sku-cell">{item.scanState === 'checking' ? 'Checking…' : item.sku}</td>
                          <td>{item.product_name}</td>
                          <td className={`sa-col-qty ${sign.className}`}>{sign.text}</td>
                          <td className="sa-col-remove">
                            <button type="button" className="sa-remove-btn" onClick={() => removeFromCart(item.qr_batch)} disabled={item.scanState === 'checking'} aria-label="Remove">
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
            <span className="sa-review-value">{readyCart.length}</span>
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
            <button type="button" className="sa-btn-primary" onClick={openReview} disabled={!isConfigValid || readyCart.length === 0 || checkingCount > 0 || isSubmitting || !canCreateAdjustments}>
            {isSubmitting ? 'Submitting…' : `Submit ${readyCart.length} unit${readyCart.length === 1 ? '' : 's'}`}
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
                                <td className="sa-serial-cell">
                                  {item.label_id}
                                  {item.bundle_code && <span className="sa-bundle-chip">{item.bundle_code}</span>}
                                </td>
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
      {isCameraOpen && (
        <div className="sa-camera-bottom-bar">
          <span>{scanCart.length} scanned</span>
          <button type="button" onClick={() => scanCartSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            View list
          </button>
          <button type="button" onClick={toggleCamera}>Stop scanning</button>
        </div>
      )}
    </div>
  );
}