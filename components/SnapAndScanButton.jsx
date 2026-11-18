import { useRef, useState } from 'react';
import { detectionValue, scanTiled } from '../utils/qrImageScanner';
import '../styles/MultiQrScanner.css';

export default function SnapAndScanButton({
  onDetected,
  onError,
  onScanningChange,
  disabled = false,
  expectedCodeCount,
}) {
  const inputRef = useRef(null);
  const onDetectedRef = useRef(onDetected);
  const onErrorRef = useRef(onError);
  const onScanningChangeRef = useRef(onScanningChange);
  const photoValuesRef = useRef(new Set());
  const [expectedInput, setExpectedInput] = useState(
    expectedCodeCount == null ? '' : String(expectedCodeCount)
  );
  const [isScanningPhoto, setIsScanningPhoto] = useState(false);
  const [photoValues, setPhotoValues] = useState([]);
  const [hasScannedPhoto, setHasScannedPhoto] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [scanProgress, setScanProgress] = useState('');

  onDetectedRef.current = onDetected;
  onErrorRef.current = onError;
  onScanningChangeRef.current = onScanningChange;

  const scanPhotos = async (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (files.length === 0) return;

    setIsScanningPhoto(true);
    onScanningChangeRef.current?.(true);
    setPhotoError('');
    setScanProgress('');
    try {
      for (const file of files) {
        let bitmap;
        try {
          bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
          const parsedExpected = Number(expectedInput);
          const expected = Number.isInteger(parsedExpected) && parsedExpected > 0 ? parsedExpected : 0;
          const detections = await scanTiled(bitmap, bitmap.width, bitmap.height, {
            expectedCodeCount: expected,
            deepScan: true,
            onProgress: ({ pass, totalPasses, codes }) => {
              setScanProgress(`pass ${pass}/${totalPasses}, ${codes} codes`);
            },
          });

          const values = detections.map(detectionValue).filter(Boolean);
          if (values.length > 0) onDetectedRef.current?.(values);
          values.forEach((value) => photoValuesRef.current.add(value));
          setPhotoValues([...photoValuesRef.current]);
          setHasScannedPhoto(true);
        } catch (error) {
          console.error('QR photo decoding failed:', error);
          const message = 'Could not read QR codes from this photo. Try another image.';
          setPhotoError(message);
          onErrorRef.current?.(message);
        } finally {
          bitmap?.close();
        }
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
      <label
        className="multi-qr-snap__expected-label"
        style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '11px' }}
      >
        Expected codes (optional)
        <input
          className="multi-qr-snap__expected"
          type="number"
          min="1"
          step="1"
          inputMode="numeric"
          value={expectedInput}
          onChange={(event) => setExpectedInput(event.target.value)}
          aria-label="Expected codes (optional)"
          style={{ width: '6.5rem' }}
        />
      </label>
      <button
        type="button"
        className="multi-qr-snap__button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || isScanningPhoto}
        style={isScanningPhoto ? { whiteSpace: 'normal', maxWidth: '10rem' } : undefined}
      >
        {isScanningPhoto
          ? `Scanning photo…${scanProgress ? ` ${scanProgress}` : ''}`
          : hasScannedPhoto ? 'Snap again' : 'Snap & scan'}
      </button>
      {(hasScannedPhoto || photoError) && (
        <div className="multi-qr-snap__results" role="status">
          {hasScannedPhoto && (
            <>
              <strong>Found {photoValues.length} codes</strong>
              <ul>
                {photoValues.map((value) => <li key={value}>{value}</li>)}
              </ul>
            </>
          )}
          {photoError && <p>{photoError}</p>}
        </div>
      )}
    </div>
  );
}
