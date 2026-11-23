import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ScanLine, X, CircleAlert } from 'lucide-react';
import { detectionValue, scanTiled } from '../utils/qrImageScanner';
import '../styles/MultiQrScanner.css';

export default function SnapAndScanButton({
  onDetected,
  onError,
  onScanningChange,
  onSnapStart,
  onSnapComplete,
  lastExpectedCount = 0,
  onExpectedCountChange,
  disabled = false,
}) {
  const inputRef = useRef(null);
  const expectedInputRef = useRef(null);
  const expectedOverlayRef = useRef(null);
  const onDetectedRef = useRef(onDetected);
  const onErrorRef = useRef(onError);
  const onScanningChangeRef = useRef(onScanningChange);
  const onSnapStartRef = useRef(onSnapStart);
  const onSnapCompleteRef = useRef(onSnapComplete);
  const onExpectedCountChangeRef = useRef(onExpectedCountChange);
  const scannedValuesRef = useRef(new Set());
  const expectedRef = useRef(0);
  const [isScanningPhoto, setIsScanningPhoto] = useState(false);
  const [isExpectedPanelOpen, setIsExpectedPanelOpen] = useState(false);
  const [scanProgress, setScanProgress] = useState('');
  const [scanCount, setScanCount] = useState(0);
  const [expectedInput, setExpectedInput] = useState(
    lastExpectedCount > 0 ? String(lastExpectedCount) : ''
  );
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  onDetectedRef.current = onDetected;
  onErrorRef.current = onError;
  onScanningChangeRef.current = onScanningChange;
  onSnapStartRef.current = onSnapStart;
  onSnapCompleteRef.current = onSnapComplete;
  onExpectedCountChangeRef.current = onExpectedCountChange;

  const createPhotoThumbnail = async (bitmap) => {
    const scale = Math.min(1, 900 / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create photo thumbnail canvas');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.84));
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new Error('Could not create photo thumbnail');
    return URL.createObjectURL(blob);
  };

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);

  useEffect(() => {
    if (!isExpectedPanelOpen) return undefined;
    const viewport = window.visualViewport;
    const updateViewport = () => {
      expectedOverlayRef.current?.style.setProperty(
        '--vv-height',
        `${viewport?.height || window.innerHeight}px`
      );
      expectedOverlayRef.current?.style.setProperty(
        '--vv-offset-top',
        `${viewport?.offsetTop || 0}px`
      );
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setIsExpectedPanelOpen(false);
    };
    updateViewport();
    viewport?.addEventListener('resize', updateViewport);
    viewport?.addEventListener('scroll', updateViewport);
    window.addEventListener('keydown', handleKeyDown);
    const focusFrame = window.requestAnimationFrame(() => expectedInputRef.current?.focus());
    const scrollTimer = window.setTimeout(
      () => expectedInputRef.current?.scrollIntoView({ block: 'center' }),
      250
    );
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.clearTimeout(scrollTimer);
      viewport?.removeEventListener('resize', updateViewport);
      viewport?.removeEventListener('scroll', updateViewport);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isExpectedPanelOpen]);

  const showToast = (nextToast, duration) => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast(nextToast);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, duration);
  };

  const closeToast = () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = null;
    setToast(null);
  };

  const continueToPhoto = (expected) => {
    expectedRef.current = expected;
    scannedValuesRef.current = new Set();
    setScanCount(0);
    setScanProgress('');
    setToast(null);
    onSnapStartRef.current?.({ expected });
    if (expected > 0) onExpectedCountChangeRef.current?.(expected);
    setIsExpectedPanelOpen(false);
    inputRef.current?.click();
  };

  const handleExpectedSubmit = (event) => {
    event.preventDefault();
    const parsedExpected = Number(expectedInput);
    const expected = Number.isInteger(parsedExpected) && parsedExpected > 0
      ? parsedExpected
      : 0;
    if (expected > 0) {
      setExpectedInput(String(expected));
      onExpectedCountChangeRef.current?.(expected);
    }
    continueToPhoto(expected);
  };

  const handleSkip = () => continueToPhoto(0);

  const scanPhotos = async (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (files.length === 0) return;

    const expected = expectedRef.current;
    let missingCellHint = 0;
    let failed = false;
    let scanStoppedEarly = false;
    let smallestLongSide = Infinity;
    const photoResults = [];
    setIsScanningPhoto(true);
    onScanningChangeRef.current?.(true);
    setScanProgress('');
    setToast(null);
    try {
      for (const file of files) {
        let bitmap;
        const photo = {
          url: URL.createObjectURL(file),
          width: 0,
          height: 0,
          detections: [],
          holes: [],
          lattice: null,
          validatedHoleCount: 0,
        };
        try {
          bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
          photo.width = bitmap.width;
          photo.height = bitmap.height;
          smallestLongSide = Math.min(smallestLongSide, Math.max(bitmap.width, bitmap.height));
          const detections = await scanTiled(bitmap, bitmap.width, bitmap.height, {
            expectedCodeCount: expected,
            deepScan: true,
            onProgress: ({ pass, totalPasses, codes, stage }) => {
              setScanProgress(stage || `Pass ${pass}/${totalPasses}`);
              setScanCount(codes);
            },
            onDetections: (detections) => {
              const addedValues = [...new Set(detections.map(detectionValue).filter(Boolean))];
              addedValues.forEach((value) => scannedValuesRef.current.add(value));
              if (addedValues.length > 0) {
                onDetectedRef.current?.(addedValues, { source: 'snap', expected });
              }
            },
          });
          photo.detections = detections;
          photo.holes = detections.missingCells?.positions || [];
          photo.lattice = detections.missingCells?.lattice || null;
          photo.validatedHoleCount = detections.missingCells?.validatedHoleCount
            ?? photo.holes.length;
          missingCellHint += detections.missingCells?.count || 0;
          scanStoppedEarly = scanStoppedEarly || Boolean(detections.scanStoppedEarly);
        } catch (error) {
          failed = true;
          console.error('QR photo decoding failed:', error);
          const message = 'Could not read QR codes from this photo. Try another image.';
          onErrorRef.current?.(message);
        } finally {
          if (bitmap) {
            try {
              photo.thumbnailUrl = await createPhotoThumbnail(bitmap);
            } catch (error) {
              console.warn('Could not make QR photo thumbnail:', error);
            }
          }
          bitmap?.close();
          photoResults.push(photo);
        }
      }

      const values = [...scannedValuesRef.current];
      const complete = onSnapCompleteRef.current;
      complete?.({
        values,
        expected,
        missingCells: { count: missingCellHint },
        scanStoppedEarly,
        photos: photoResults,
      });
      if (!complete) {
        photoResults.forEach(({ url, thumbnailUrl }) => {
          if (url) URL.revokeObjectURL(url);
          if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
        });
      }
      if (values.length === 0) {
        showToast({
          kind: 'error',
          message: failed
            ? 'Could not read QR codes from this photo. Try another image.'
            : smallestLongSide < 1500
              ? 'Photo resolution is low. Take the photo closer or use a higher-resolution image.'
              : 'No QR codes found. Try a closer, well-lit photo.',
        }, 6000);
      } else if (expected > 0 && values.length < expected && smallestLongSide < 1500) {
        showToast({
          kind: 'error',
          message: `Found ${values.length} of ${expected}. A higher-resolution photo may find the rest.`,
        }, 6000);
      }
    } finally {
      setIsScanningPhoto(false);
      setScanProgress('');
      onScanningChangeRef.current?.(false);
    }
  };

  return (
    <div className="multi-qr-snap">
      <input
        ref={inputRef}
        className="multi-qr-snap__input"
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        onChange={scanPhotos}
        tabIndex="-1"
        aria-label="Select QR code photos"
      />
      <button
        type="button"
        className="multi-qr-snap__button"
        onClick={() => setIsExpectedPanelOpen(true)}
        disabled={disabled || isScanningPhoto}
        aria-label="Snap and scan QR codes from a photo"
        title="Snap and scan QR codes from a photo"
      >
        {isScanningPhoto ? (
          <>
            <span className="multi-qr-snap__spinner" aria-hidden="true" />
            <span className="multi-qr-snap__scanning-label">Scanning… {scanCount} codes</span>
            {scanProgress && <span className="multi-qr-snap__progress">{scanProgress}</span>}
          </>
        ) : (
          <>
            <ScanLine className="multi-qr-snap__icon" size={18} aria-hidden="true" />
            <span>Snap</span>
          </>
        )}
      </button>
      {toast && (
        <div
          className={`multi-qr-snap__toast multi-qr-snap__toast--${toast.kind}`}
          role="status"
          aria-live="polite"
        >
          <CircleAlert size={16} aria-hidden="true" />
          <span>{toast.message}</span>
          <button
            type="button"
            className="multi-qr-snap__toast-close"
            onClick={closeToast}
            aria-label="Dismiss scan result"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
      {isExpectedPanelOpen && createPortal(
        <div
          ref={expectedOverlayRef}
          className="multi-qr-snap__overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsExpectedPanelOpen(false);
          }}
        >
          <form
            className="multi-qr-snap__panel"
            onSubmit={handleExpectedSubmit}
            role="dialog"
            aria-modal="true"
            aria-labelledby="multi-qr-snap-title"
          >
            <div className="multi-qr-snap__panel-heading">
              <span className="multi-qr-snap__panel-icon"><ScanLine size={20} /></span>
              <h2 id="multi-qr-snap-title">Before you snap</h2>
            </div>
            <label className="multi-qr-snap__expected-label" htmlFor="multi-qr-snap-expected">
              How many QR codes are in this photo?
            </label>
            <input
              ref={expectedInputRef}
              id="multi-qr-snap-expected"
              className="multi-qr-snap__expected-input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={expectedInput}
              autoFocus
              onChange={(event) => setExpectedInput(event.target.value.replace(/\D/g, ''))}
            />
            <p className="multi-qr-snap__expected-help">
              Optional - helps the scanner check for and report codes that may be missing.
            </p>
            <div className="multi-qr-snap__panel-actions">
              <button
                type="button"
                className="multi-qr-snap__cancel"
                onClick={() => setIsExpectedPanelOpen(false)}
              >
                Cancel
              </button>
              <button type="button" className="multi-qr-snap__skip" onClick={handleSkip}>
                Skip
              </button>
              <button type="submit" className="multi-qr-snap__continue">
                Continue
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </div>
  );
}
