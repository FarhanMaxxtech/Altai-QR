import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Zap } from 'lucide-react';
import '../styles/MultiQrScanner.css';

const CAMERA_ERROR = 'Could not access camera. Check permissions and try again.';
const CAMERA_CONSTRAINTS = {
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
  audio: false,
};

let qrScannerPromise;

const getQrScanner = () => {
  if (!qrScannerPromise) {
    qrScannerPromise = Promise.all([
      import('@undecaf/zbar-wasm'),
      import('@undecaf/zbar-wasm/dist/zbar.wasm?url'),
    ])
      .then(([zbar, wasmAsset]) => {
        zbar.setModuleArgs({
          locateFile: (filename) => (filename === 'zbar.wasm' ? wasmAsset.default : filename),
        });
        return zbar.getDefaultScanner().then((scanner) => {
          scanner.setConfig(zbar.ZBarSymbolType.ZBAR_NONE, zbar.ZBarConfigType.ZBAR_CFG_ENABLE, 0);
          scanner.setConfig(zbar.ZBarSymbolType.ZBAR_QRCODE, zbar.ZBarConfigType.ZBAR_CFG_ENABLE, 1);
          return { scanner, scanImageData: zbar.scanImageData };
        });
      })
      .catch((error) => {
        qrScannerPromise = null;
        throw error;
      });
  }
  return qrScannerPromise;
};

const detectionPoints = (detection) => {
  if (detection.cornerPoints?.length) return detection.cornerPoints;
  if (detection.points?.length) return detection.points;

  const { x, y, width, height } = detection.boundingBox || {};
  if ([x, y, width, height].every(Number.isFinite)) {
    return [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ];
  }
  return [];
};

const drawDetections = (context, detections, width, height, pointScale) => {
  context.clearRect(0, 0, width, height);
  context.strokeStyle = '#7fd05c';
  context.lineWidth = Math.max(4, width / 400);

  detections.forEach((detection) => {
    const points = detectionPoints(detection);
    if (points.length < 2) return;

    context.beginPath();
    context.moveTo(points[0].x * pointScale, points[0].y * pointScale);
    points.slice(1).forEach((point) => context.lineTo(point.x * pointScale, point.y * pointScale));
    if (points.length > 2) context.closePath();
    context.stroke();
  });
};

const MultiQrScanner = forwardRef(function MultiQrScanner({
  isActive,
  paused = false,
  scannedCount = 0,
  overlayContent,
  onDetected,
  onError,
  maxCodesPerShot = 5,
}, ref) {
  const videoRef = useRef(null);
  const frameRef = useRef(null);
  const overlayRef = useRef(null);
  const cooldownValuesRef = useRef(new Map());
  const pausedRef = useRef(paused);
  const streamRef = useRef(null);
  const [isTorchSupported, setIsTorchSupported] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [hasDetectionFlash, setHasDetectionFlash] = useState(false);
  const onDetectedRef = useRef(onDetected);
  const onErrorRef = useRef(onError);
  const [statusError, setStatusError] = useState('');

  pausedRef.current = paused;
  onDetectedRef.current = onDetected;
  onErrorRef.current = onError;

  useImperativeHandle(ref, () => ({
    resetSession() {
      cooldownValuesRef.current.clear();
    },
  }), []);

  useEffect(() => {
    if (!isActive) return undefined;

    let cancelled = false;
    let stream = null;
    let intervalId = null;
    let isDecoding = false;
    let isStarting = false;
    let flashTimeoutId = null;
    let visibilityRetryTimeoutId = null;
    const cooldownValues = cooldownValuesRef.current;
    cooldownValues.clear();
    const video = videoRef.current;
    const frame = frameRef.current;
    const overlay = overlayRef.current;
    const overlayContext = overlay?.getContext('2d');
    const frameCanvas = document.createElement('canvas');
    const frameContext = frameCanvas.getContext('2d', { willReadFrequently: true });

    frame?.style.setProperty('--multi-qr-aspect-ratio', '16 / 9');
    const updateFrameAspectRatio = () => {
      if (video.videoWidth && video.videoHeight) {
        frame?.style.setProperty(
          '--multi-qr-aspect-ratio',
          `${video.videoWidth} / ${video.videoHeight}`
        );
      }
    };
    video.addEventListener('loadedmetadata', updateFrameAspectRatio);

    setStatusError('');
    setIsTorchSupported(false);
    setIsTorchOn(false);

    const stopCamera = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      streamRef.current = null;
      if (video) video.srcObject = null;
      setIsTorchSupported(false);
      setIsTorchOn(false);
    };

    const reportError = (message) => {
      if (cancelled) return;
      setStatusError(message);
      stopCamera();
      onErrorRef.current?.(message);
    };

    const start = async () => {
      if (isStarting || stream || document.visibilityState === 'hidden') return;
      isStarting = true;
      if (!window.isSecureContext) {
        isStarting = false;
        reportError('Camera scanning requires a secure HTTPS connection.');
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        isStarting = false;
        reportError(CAMERA_ERROR);
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      } catch {
        isStarting = false;
        reportError(CAMERA_ERROR);
        return;
      }

      if (cancelled || document.visibilityState === 'hidden') {
        stopCamera();
        isStarting = false;
        return;
      }

      try {
        streamRef.current = stream;
        const videoTrack = stream.getVideoTracks()[0];
        try {
          setIsTorchSupported(Boolean(videoTrack?.getCapabilities?.().torch));
        } catch {
          setIsTorchSupported(false);
        }
        video.srcObject = stream;
        await video.play();
        updateFrameAspectRatio();

        if (cancelled || document.visibilityState === 'hidden' || !stream) {
          stopCamera();
          isStarting = false;
          return;
        }

        let detector = null;
        let zbarScanner = null;
        let scanWithZbar = null;
        const BarcodeDetector = window.BarcodeDetector;
        if (
          typeof BarcodeDetector === 'function' &&
          typeof BarcodeDetector.getSupportedFormats === 'function'
        ) {
          let formats = [];
          try {
            formats = await BarcodeDetector.getSupportedFormats();
          } catch {
            formats = [];
          }
          if (formats.includes('qr_code')) {
            try {
              detector = new BarcodeDetector({ formats: ['qr_code'] });
            } catch {
              detector = null;
            }
          }
        }

        if (!detector) {
          const zbar = await getQrScanner();
          zbarScanner = zbar.scanner;
          scanWithZbar = zbar.scanImageData;
        }
        if (cancelled || document.visibilityState === 'hidden' || !stream) {
          stopCamera();
          isStarting = false;
          return;
        }

        intervalId = window.setInterval(async () => {
          if (cancelled || pausedRef.current || document.visibilityState === 'hidden' || isDecoding || !video.videoWidth || !video.videoHeight) return;
          isDecoding = true;

          try {
            const sourceWidth = video.videoWidth;
            const sourceHeight = video.videoHeight;
            const scale = Math.min(1, 1280 / sourceWidth);
            const width = Math.round(sourceWidth * scale);
            const height = Math.round(sourceHeight * scale);
            if (frameCanvas.width !== width || frameCanvas.height !== height) {
              frameCanvas.width = width;
              frameCanvas.height = height;
            }
            if (overlay.width !== sourceWidth || overlay.height !== sourceHeight) {
              overlay.width = sourceWidth;
              overlay.height = sourceHeight;
            }

            frameContext.drawImage(video, 0, 0, width, height);
            let detections;
            if (detector) {
              detections = await detector.detect(frameCanvas);
            } else {
              const imageData = frameContext.getImageData(0, 0, width, height);
              detections = await scanWithZbar(imageData, zbarScanner);
            }

            if (cancelled) return;
            drawDetections(overlayContext, detections, sourceWidth, sourceHeight, 1 / scale);

            const maxCodes = Math.max(1, Math.floor(Number(maxCodesPerShot) || 5));
            const values = [];
            const now = Date.now();
            detections.forEach((detection) => {
              const value = (detection.rawValue ?? detection.decode?.() ?? '').trim();
              if (!value || values.includes(value)) return;
              const lastSeen = cooldownValues.get(value);
              cooldownValues.set(value, now);
              if (lastSeen === undefined || now - lastSeen >= 2500) {
                if (values.length < maxCodes) values.push(value);
              }
            });

            cooldownValues.forEach((lastSeen, value) => {
              if (now - lastSeen > 10000) cooldownValues.delete(value);
            });

            if (values.length > 0) {
              if (navigator.vibrate) navigator.vibrate(60);
              setHasDetectionFlash(true);
              if (flashTimeoutId !== null) window.clearTimeout(flashTimeoutId);
              flashTimeoutId = window.setTimeout(() => setHasDetectionFlash(false), 220);
              onDetectedRef.current?.(values);
            }
          } catch (error) {
            console.error('QR camera decoding failed:', error);
            reportError('Could not read QR codes from the camera. Please try again.');
          } finally {
            isDecoding = false;
          }
        }, 200);
        isStarting = false;
      } catch (error) {
        isStarting = false;
        console.error('Could not initialize the QR camera scanner:', error);
        reportError('Could not start QR scanning. Please refresh and try again.');
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (visibilityRetryTimeoutId !== null) {
          window.clearTimeout(visibilityRetryTimeoutId);
          visibilityRetryTimeoutId = null;
        }
        stopCamera();
      } else {
        const restart = () => {
          visibilityRetryTimeoutId = null;
          if (cancelled || document.visibilityState === 'hidden') return;
          if (isStarting) {
            visibilityRetryTimeoutId = window.setTimeout(restart, 100);
            return;
          }
          start();
        };
        restart();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    start();
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopCamera();
      if (visibilityRetryTimeoutId !== null) window.clearTimeout(visibilityRetryTimeoutId);
      if (flashTimeoutId !== null) window.clearTimeout(flashTimeoutId);
      setHasDetectionFlash(false);
      video.removeEventListener('loadedmetadata', updateFrameAspectRatio);
      if (overlayContext && overlay) {
        overlayContext.clearRect(0, 0, overlay.width, overlay.height);
      }
    };
  }, [isActive, maxCodesPerShot]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !isTorchSupported) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !isTorchOn }] });
      setIsTorchOn((current) => !current);
    } catch (error) {
      console.error('Could not toggle camera torch:', error);
    }
  };

  return (
    <div className="multi-qr-scanner">
      <div ref={frameRef} className="multi-qr-scanner__frame">
        <video ref={videoRef} className="multi-qr-scanner__video" playsInline muted autoPlay />
        <canvas ref={overlayRef} className="multi-qr-scanner__overlay" aria-hidden="true" />
        <div className={`multi-qr-scanner__flash${hasDetectionFlash ? ' is-active' : ''}`} aria-hidden="true" />
        {overlayContent && <div className="multi-qr-scanner__content">{overlayContent}</div>}
        {isTorchSupported && (
          <button
            type="button"
            className={`multi-qr-scanner__torch${isTorchOn ? ' is-active' : ''}`}
            onClick={toggleTorch}
            aria-label={isTorchOn ? 'Turn torch off' : 'Turn torch on'}
            aria-pressed={isTorchOn}
          >
            <Zap size={18} />
          </button>
        )}
      </div>
      <p className={statusError ? 'multi-qr-scanner__status multi-qr-scanner__status--error' : 'multi-qr-scanner__status'}>
        {statusError || `Scanning… ${scannedCount} in batch`}
      </p>
    </div>
  );
});

export default MultiQrScanner;
