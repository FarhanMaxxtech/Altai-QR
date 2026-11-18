const MAX_CANVAS_PIXELS = 16_000_000;
let qrScannerPromise;
let zbarScanQueue = Promise.resolve();

const queueZbarScan = (imageData, scanner, scanImageData) => {
  const scan = zbarScanQueue.then(() => scanImageData(imageData, scanner));
  zbarScanQueue = scan.then(() => undefined, () => undefined);
  return scan;
};

export const getQrScanner = () => {
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
          return {
            scanner,
            scanImageData: (imageData, activeScanner = scanner) => (
              queueZbarScan(imageData, activeScanner, zbar.scanImageData)
            ),
          };
        });
      })
      .catch((error) => {
        qrScannerPromise = null;
        throw error;
      });
  }
  return qrScannerPromise;
};

export const detectionValue = (detection) => {
  const value = detection.rawValue ?? detection.decode?.() ?? '';
  return typeof value === 'string' ? value.trim() : '';
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

const longestSide = (detection) => {
  const points = detectionPoints(detection);
  if (points.length < 2) return 0;
  return Math.max(...points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    return Math.hypot(next.x - point.x, next.y - point.y);
  }));
};

const medianQrSize = (detections) => {
  const sizes = detections.map(longestSide).filter((size) => size > 0).sort((a, b) => a - b);
  if (sizes.length === 0) return 0;
  const middle = Math.floor(sizes.length / 2);
  return sizes.length % 2 === 0 ? (sizes[middle - 1] + sizes[middle]) / 2 : sizes[middle];
};

const yieldToUI = () => new Promise((resolve) => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
  else window.setTimeout(resolve, 0);
});

const getBarcodeDetector = async () => {
  const Detector = window.BarcodeDetector;
  if (typeof Detector !== 'function' || typeof Detector.getSupportedFormats !== 'function') {
    return null;
  }
  try {
    const formats = await Detector.getSupportedFormats();
    return formats.includes('qr_code') ? new Detector({ formats: ['qr_code'] }) : null;
  } catch (error) {
    console.debug('QR BarcodeDetector unavailable:', error);
    return null;
  }
};

const createSafeSourceCanvas = (imageSource, width, height) => {
  const scale = Math.min(
    1,
    Math.sqrt(MAX_CANVAS_PIXELS / (width * height)),
    16384 / width,
    16384 / height
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(
    imageSource,
    0,
    0,
    canvas.width,
    canvas.height
  );
  return {
    canvas,
    sourceScaleX: canvas.width / width,
    sourceScaleY: canvas.height / height,
  };
};

const grayscaleCanvas = (source) => {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(source, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < imageData.data.length; index += 4) {
    const gray = Math.round(
      imageData.data[index] * 0.299
      + imageData.data[index + 1] * 0.587
      + imageData.data[index + 2] * 0.114
    );
    imageData.data[index] = gray;
    imageData.data[index + 1] = gray;
    imageData.data[index + 2] = gray;
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
};

const flatFieldCanvas = (source) => {
  const canvas = grayscaleCanvas(source);
  const fieldScale = 24;
  const fieldCanvas = document.createElement('canvas');
  fieldCanvas.width = Math.max(1, Math.ceil(canvas.width / fieldScale));
  fieldCanvas.height = Math.max(1, Math.ceil(canvas.height / fieldScale));
  const fieldContext = fieldCanvas.getContext('2d', { willReadFrequently: true });
  fieldContext.filter = 'blur(3px)';
  fieldContext.drawImage(canvas, 0, 0, fieldCanvas.width, fieldCanvas.height);
  fieldContext.filter = 'none';

  const context = canvas.getContext('2d', { willReadFrequently: true });
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const fieldData = fieldContext.getImageData(0, 0, fieldCanvas.width, fieldCanvas.height);
  const sampleField = (x, y) => {
    const fieldX = Math.min(fieldCanvas.width - 1, x / fieldScale);
    const fieldY = Math.min(fieldCanvas.height - 1, y / fieldScale);
    const left = Math.floor(fieldX);
    const top = Math.floor(fieldY);
    const right = Math.min(fieldCanvas.width - 1, left + 1);
    const bottom = Math.min(fieldCanvas.height - 1, top + 1);
    const horizontal = fieldX - left;
    const vertical = fieldY - top;
    const upperLeft = fieldData.data[(top * fieldCanvas.width + left) * 4];
    const upperRight = fieldData.data[(top * fieldCanvas.width + right) * 4];
    const lowerLeft = fieldData.data[(bottom * fieldCanvas.width + left) * 4];
    const lowerRight = fieldData.data[(bottom * fieldCanvas.width + right) * 4];
    const upper = upperLeft * (1 - horizontal) + upperRight * horizontal;
    const lower = lowerLeft * (1 - horizontal) + lowerRight * horizontal;
    return upper * (1 - vertical) + lower * vertical;
  };
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const index = (y * canvas.width + x) * 4;
      const ratio = imageData.data[index] / Math.max(1, sampleField(x, y));
      minimum = Math.min(minimum, ratio);
      maximum = Math.max(maximum, ratio);
    }
  }

  const contrast = maximum > minimum ? 255 / (maximum - minimum) : 1;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const index = (y * canvas.width + x) * 4;
      const ratio = imageData.data[index] / Math.max(1, sampleField(x, y));
      const normalized = Math.max(0, Math.min(255, Math.round((ratio - minimum) * contrast)));
      imageData.data[index] = normalized;
      imageData.data[index + 1] = normalized;
      imageData.data[index + 2] = normalized;
    }
  }
  context.putImageData(imageData, 0, 0);
  fieldCanvas.width = 0;
  fieldCanvas.height = 0;
  return canvas;
};

const makeSlidingTiles = (width, height, qrSize) => {
  const fallback = qrSize <= 0;
  const tileWidth = Math.min(width, Math.max(1, Math.round(fallback ? 1000 : qrSize * 5)));
  const tileHeight = Math.min(height, Math.max(1, Math.round(fallback ? 1000 : qrSize * 5)));
  const stepX = fallback ? Math.max(1, Math.round(tileWidth * 0.6)) : Math.max(1, Math.round(tileWidth - qrSize * 1.5));
  const stepY = fallback ? Math.max(1, Math.round(tileHeight * 0.6)) : Math.max(1, Math.round(tileHeight - qrSize * 1.5));

  const positions = (extent, tile, step) => {
    if (extent <= tile) return [0];
    const result = [0];
    while (result[result.length - 1] + tile < extent) {
      const next = Math.min(result[result.length - 1] + step, extent - tile);
      if (next <= result[result.length - 1]) break;
      result.push(next);
    }
    return result;
  };

  return positions(height, tileHeight, stepY).flatMap((top) => (
    positions(width, tileWidth, stepX).map((left) => ({
      left,
      top,
      width: Math.min(tileWidth, width - left),
      height: Math.min(tileHeight, height - top),
    }))
  ));
};

const makeCoarseTiles = (width, height) => {
  const tileWidth = Math.ceil(width * 0.65);
  const tileHeight = Math.ceil(height * 0.65);
  return [0, width - tileWidth].flatMap((left) => (
    [0, height - tileHeight].map((top) => ({
      left,
      top,
      width: tileWidth,
      height: tileHeight,
    }))
  ));
};

const makeLiveTiles = (width, height) => {
  const overlap = 0.15;
  const tileWidth = width / (3 - 2 * overlap);
  const tileHeight = height / (3 - 2 * overlap);
  const stepX = tileWidth * (1 - overlap);
  const stepY = tileHeight * (1 - overlap);
  return [0, 1, 2].flatMap((column) => (
    [0, 1, 2].map((row) => ({
      left: column * stepX,
      top: row * stepY,
      width: Math.min(tileWidth, width - column * stepX),
      height: Math.min(tileHeight, height - row * stepY),
    }))
  ));
};

const prepareVariant = (canvas, variant) => {
  if (variant === 'gray') return [grayscaleCanvas(canvas)];
  if (variant === 'flat') return [flatFieldCanvas(canvas)];
  if (variant !== 'upscale') return [];

  const flat = flatFieldCanvas(canvas);
  const scale = Math.min(1.5, Math.sqrt(MAX_CANVAS_PIXELS / (flat.width * flat.height)));
  const enlarged = document.createElement('canvas');
  enlarged.width = Math.max(1, Math.floor(flat.width * scale));
  enlarged.height = Math.max(1, Math.floor(flat.height * scale));
  enlarged.getContext('2d').drawImage(flat, 0, 0, enlarged.width, enlarged.height);
  return [flat, enlarged];
};

const eraseDetections = (context, detections, sourceScaleX, sourceScaleY) => {
  detections.forEach((detection) => {
    const points = detectionPoints(detection);
    if (points.length < 3) return;
    const center = points.reduce((sum, point) => ({
      x: sum.x + point.x / points.length,
      y: sum.y + point.y / points.length,
    }), { x: 0, y: 0 });
    context.beginPath();
    points.forEach((point, index) => {
      const x = (center.x + (point.x - center.x) * 1.08) * sourceScaleX;
      const y = (center.y + (point.y - center.y) * 1.08) * sourceScaleY;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
    context.fillStyle = '#fff';
    context.fill();
  });
};

export const scanTiled = async (
  imageSource,
  width,
  height,
  { expectedCodeCount = 0, onProgress, deepScan = false } = {}
) => {
  const { scanner, scanImageData } = await getQrScanner();
  const barcodeDetector = await getBarcodeDetector();
  const {
    canvas: workCanvas,
    sourceScaleX,
    sourceScaleY,
  } = createSafeSourceCanvas(imageSource, width, height);
  const workContext = workCanvas.getContext('2d', { willReadFrequently: true });
  const tileCanvas = document.createElement('canvas');
  const tileContext = tileCanvas.getContext('2d', { willReadFrequently: true });
  const results = new Map();
  let activeBarcodeDetector = barcodeDetector;
  const expected = Math.max(0, Number(expectedCodeCount) || 0);
  let qrSize = 0;

  const report = (pass, codes) => onProgress?.({ pass, totalPasses: 5, codes });
  const merge = (detections) => {
    const added = [];
    detections.forEach((detection) => {
      const value = detectionValue(detection);
      if (!value || results.has(value)) return;
      const result = { ...detection, rawValue: value };
      results.set(value, result);
      added.push(result);
    });
    return added;
  };
  const reachedExpected = () => expected > 0 && results.size >= expected;

  const scanTile = async (region, variant = 'plain') => {
    tileCanvas.width = Math.max(1, Math.ceil(region.width));
    tileCanvas.height = Math.max(1, Math.ceil(region.height));
    tileContext.drawImage(
      workCanvas,
      region.left,
      region.top,
      region.width,
      region.height,
      0,
      0,
      region.width,
      region.height
    );

    const preparedCanvases = prepareVariant(tileCanvas, variant);
    const scanCanvas = preparedCanvases[preparedCanvases.length - 1] || tileCanvas;
    const pointScale = scanCanvas.width / tileCanvas.width;
    try {
      const scanContext = scanCanvas === tileCanvas
        ? tileContext
        : scanCanvas.getContext('2d', { willReadFrequently: true });
      const zbarDetections = await scanImageData(
        scanContext.getImageData(0, 0, scanCanvas.width, scanCanvas.height),
        scanner
      );
      let barcodeDetections = [];
      if (activeBarcodeDetector) {
        try {
          barcodeDetections = await activeBarcodeDetector.detect(scanCanvas);
        } catch (error) {
          console.debug('QR BarcodeDetector tile scan failed; continuing with zbar:', error);
          activeBarcodeDetector = null;
        }
      }
      const decoded = [...zbarDetections, ...barcodeDetections];
      return decoded.map((detection) => ({
        ...detection,
        rawValue: detectionValue(detection),
        points: detectionPoints(detection).map((point) => ({
          x: (region.left + point.x / pointScale) / sourceScaleX,
          y: (region.top + point.y / pointScale) / sourceScaleY,
        })),
      })).filter((detection) => detection.rawValue);
    } finally {
      preparedCanvases.forEach((prepared) => {
        prepared.width = 0;
        prepared.height = 0;
      });
    }
  };

  const scanRegions = async (regions, pass, variant = 'plain', label = 'tiles') => {
    const added = [];
    const unresolvedRegions = [];
    report(pass, results.size);
    for (const region of regions) {
      const detections = await scanTile(region, variant);
      const newlyDetected = merge(detections);
      if (newlyDetected.length === 0) unresolvedRegions.push(region);
      added.push(...newlyDetected);
      report(pass, results.size);
      await yieldToUI();
      if (reachedExpected()) break;
    }
    console.debug(`[qr-scan] pass ${pass}/5 ${label}: ${added.length} new, ${results.size} total`);
    return { added, unresolvedRegions };
  };

  try {
    if (!deepScan && imageSource?.tagName === 'VIDEO') {
      await scanRegions(makeLiveTiles(workCanvas.width, workCanvas.height), 2, 'plain', 'live tiles');
      return [...results.values()];
    }

    const fullRegion = { left: 0, top: 0, width: workCanvas.width, height: workCanvas.height };
    await scanRegions(
      [fullRegion, ...makeCoarseTiles(workCanvas.width, workCanvas.height)],
      1,
      'plain',
      'full + coarse'
    );
    const originalToWorkingScale = Math.sqrt(sourceScaleX * sourceScaleY);
    qrSize = medianQrSize([...results.values()]) * originalToWorkingScale;
    eraseDetections(workContext, [...results.values()], sourceScaleX, sourceScaleY);

    if (!reachedExpected()) {
      let tiles = makeSlidingTiles(workCanvas.width, workCanvas.height, qrSize);
      if (results.size === 0) tiles = makeSlidingTiles(workCanvas.width, workCanvas.height, 0);
      const tilePass = await scanRegions(tiles, 2, 'plain', 'adaptive windows');
      qrSize = medianQrSize([...results.values()]) * originalToWorkingScale || qrSize;
      eraseDetections(workContext, [...results.values()], sourceScaleX, sourceScaleY);

      if (!deepScan) return [...results.values()];

      let rescanTiles = makeSlidingTiles(workCanvas.width, workCanvas.height, qrSize);
      const missedByKey = new Map();
      const rememberMissed = (regions) => regions.forEach((region) => {
        missedByKey.set(`${region.left}:${region.top}:${region.width}:${region.height}`, region);
      });
      rememberMissed(tilePass.unresolvedRegions);
      let hasNewCodes = true;
      for (let round = 1; round <= 3 && hasNewCodes && !reachedExpected(); round += 1) {
        const rescan = await scanRegions(rescanTiles, 3, 'plain', `erase-rescan ${round}`);
        rememberMissed(rescan.unresolvedRegions);
        hasNewCodes = rescan.added.length > 0;
        qrSize = medianQrSize([...results.values()]) * originalToWorkingScale || qrSize;
        rescanTiles = makeSlidingTiles(workCanvas.width, workCanvas.height, qrSize);
        eraseDetections(workContext, [...results.values()], sourceScaleX, sourceScaleY);
      }

      if (!reachedExpected()) {
        const variantTiles = missedByKey.size > 0 ? [...missedByKey.values()] : rescanTiles;
        const grayPass = await scanRegions(variantTiles, 4, 'gray', 'plain grayscale');
        eraseDetections(workContext, [...results.values()], sourceScaleX, sourceScaleY);
        if (!reachedExpected()) {
          const flatTiles = expected > 0 && grayPass.unresolvedRegions.length > 0
            ? grayPass.unresolvedRegions
            : variantTiles;
          const flatPass = await scanRegions(flatTiles, 4, 'flat', 'flat-field');
          eraseDetections(workContext, [...results.values()], sourceScaleX, sourceScaleY);
          if (!reachedExpected()) {
            const upscaleTiles = expected > 0 && flatPass.unresolvedRegions.length > 0
              ? flatPass.unresolvedRegions
              : variantTiles;
            await scanRegions(upscaleTiles, 5, 'upscale', 'flat-field 1.5x');
            eraseDetections(workContext, [...results.values()], sourceScaleX, sourceScaleY);
          }
        }
      }
    } else if (deepScan) {
      console.debug(`[qr-scan] pass 2/5 skipped: expected ${expected} reached in pass 1`);
    }

    return [...results.values()];
  } finally {
    tileCanvas.width = 0;
    tileCanvas.height = 0;
    workCanvas.width = 0;
    workCanvas.height = 0;
  }
};
