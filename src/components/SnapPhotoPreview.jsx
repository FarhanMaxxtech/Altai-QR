import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import '../styles/SnapPhotoPreview.css';

function PhotoMarkerLegend({ inverse = false }) {
  return (
    <div
      className={`snap-photo-preview__legend${inverse ? ' is-inverse' : ''}`}
      aria-label="Photo marker legend"
    >
      <span><i className="snap-photo-preview__legend-swatch is-added" />Green = added</span>
      <span><i className="snap-photo-preview__legend-swatch is-rejected" />Red = not added</span>
      <span><i className="snap-photo-preview__legend-swatch is-missing" />Orange = not detected</span>
    </div>
  );
}

function PhotoSurface({
  photo,
  photoIndex,
  markers,
  activeMarkerId,
  onHighlightMarker,
  onOpen,
  onClose,
  fullscreen = false,
}) {
  const imageRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas) return undefined;

    const draw = () => {
      const bounds = image.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(bounds.width * ratio);
      canvas.height = Math.round(bounds.height * ratio);
      canvas.style.width = `${bounds.width}px`;
      canvas.style.height = `${bounds.height}px`;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, bounds.width, bounds.height);
      const scaleX = bounds.width / photo.width;
      const scaleY = bounds.height / photo.height;
      const detectedSizes = markers
        .filter((marker) => marker.kind === 'added' || marker.kind === 'rejected')
        .map((marker) => marker.size)
        .filter((size) => Number.isFinite(size) && size > 0)
        .sort((left, right) => left - right);
      const middle = Math.floor(detectedSizes.length / 2);
      const medianDetectedSize = detectedSizes.length === 0
        ? 0
        : detectedSizes.length % 2 === 0
          ? (detectedSizes[middle - 1] + detectedSizes[middle]) / 2
          : detectedSizes[middle];

      markers.forEach((marker) => {
        if (
          marker.kind !== 'added'
          && marker.kind !== 'rejected'
          && marker.kind !== 'missing'
        ) return;
        const color = marker.kind === 'added'
          ? '#218838'
          : marker.kind === 'rejected'
            ? '#dc2626'
            : '#f59e0b';
        const isActive = marker.id === activeMarkerId;
        context.strokeStyle = color;
        context.lineWidth = isActive ? 8 : fullscreen ? 6 : 4;
        context.shadowColor = isActive ? color : 'transparent';
        context.shadowBlur = isActive ? 8 : 0;
        if (marker.kind !== 'missing' && marker.points?.length > 1) {
          context.beginPath();
          marker.points.forEach((point, index) => {
            const x = point.x * scaleX;
            const y = point.y * scaleY;
            if (index === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
          });
          context.closePath();
          context.stroke();
        } else {
          const sourceSize = marker.kind === 'missing'
            ? medianDetectedSize || marker.size
            : marker.size;
          const size = Math.max(
            12,
            (sourceSize || Math.min(photo.width, photo.height) * 0.04) * scaleX
          );
          context.strokeRect(
            marker.x * scaleX - size / 2,
            marker.y * scaleY - size / 2,
            size,
            size
          );
        }
      });
      context.shadowBlur = 0;
    };

    draw();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(draw);
    observer?.observe(image);
    window.addEventListener('resize', draw);
    image.addEventListener('load', draw);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', draw);
      image.removeEventListener('load', draw);
    };
  }, [activeMarkerId, fullscreen, markers, photo.height, photo.width, photoIndex]);

  useEffect(() => {
    if (!fullscreen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fullscreen, onClose]);

  return (
    <div className={`snap-photo-preview__surface${fullscreen ? ' is-fullscreen' : ''}`}>
      <div className="snap-photo-preview__stage">
        <img
          ref={imageRef}
          src={photo.thumbnailUrl || photo.url}
          alt={`Scanned sheet ${photoIndex + 1}`}
          className="snap-photo-preview__image"
        />
        <canvas ref={canvasRef} className="snap-photo-preview__canvas" aria-hidden="true" />
        {!fullscreen && (
          <button
            type="button"
            className="snap-photo-preview__open"
            onClick={onOpen}
            aria-label={`Zoom photo ${photoIndex + 1}`}
          />
        )}
        {markers.filter((marker) => marker.kind === 'rejected').map((marker) => (
          <button
            key={marker.id}
            type="button"
            className={`snap-photo-preview__marker snap-photo-preview__marker--rejected${marker.id === activeMarkerId ? ' is-active' : ''}`}
            style={{
              left: `${(marker.x / photo.width) * 100}%`,
              top: `${(marker.y / photo.height) * 100}%`,
            }}
            onClick={() => onHighlightMarker(marker.id)}
            aria-label={marker.label}
            aria-pressed={marker.id === activeMarkerId}
          >
            <span>{marker.number}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function SnapPhotoPreview({
  photos = [],
  markers = [],
  activeMarkerId,
  onHighlightMarker,
}) {
  const [zoomedPhotoIndex, setZoomedPhotoIndex] = useState(null);
  if (photos.length === 0) return null;

  return (
    <div className="snap-photo-preview">
      {photos.map((photo, photoIndex) => ({ photo, photoIndex }))
        .filter(({ photo }) => photo.width > 0 && photo.height > 0)
        .map(({ photo, photoIndex }) => (
        <figure className="snap-photo-preview__figure" key={photo.url}>
          <PhotoSurface
            photo={photo}
            photoIndex={photoIndex}
            markers={markers.filter((marker) => marker.photoIndex === photoIndex)}
            activeMarkerId={activeMarkerId}
            onHighlightMarker={onHighlightMarker}
            onOpen={() => setZoomedPhotoIndex(photoIndex)}
          />
          <figcaption>Photo {photoIndex + 1} · tap to zoom</figcaption>
          <PhotoMarkerLegend />
        </figure>
        ))}
      {zoomedPhotoIndex !== null && createPortal(
        <div
          className="snap-photo-preview__modal"
          role="dialog"
          aria-modal="true"
          aria-label={`Zoomed photo ${zoomedPhotoIndex + 1}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setZoomedPhotoIndex(null);
          }}
        >
          <button
            type="button"
            className="snap-photo-preview__close"
            onClick={() => setZoomedPhotoIndex(null)}
            aria-label="Close zoomed photo"
          >
            <X size={20} />
          </button>
          <div className="snap-photo-preview__zoom-content">
            <PhotoSurface
              photo={photos[zoomedPhotoIndex]}
              photoIndex={zoomedPhotoIndex}
              markers={markers.filter((marker) => marker.photoIndex === zoomedPhotoIndex)}
              activeMarkerId={activeMarkerId}
              onHighlightMarker={onHighlightMarker}
              onClose={() => setZoomedPhotoIndex(null)}
              fullscreen
            />
            <PhotoMarkerLegend inverse />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
