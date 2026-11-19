const MAX_CANVAS_PIXELS = 8_000_000;
const MAX_LONGEST_SIDE = 3400;
const DEBUG_QR = false;
let qrScannerPromise;
let workerPool;
let zxingScannerPromise;
let zbarScanQueue = Promise.resolve();

const debugQrError = (message, error) => {
  if (DEBUG_QR) console.debug(`[qr-scan] ${message}`, error);
};

const queueZbarScan = (scan) => {
  const task = zbarScanQueue.then(scan);
  zbarScanQueue = task.then(() => undefined, () => undefined);
  return task;
};

const getMainThreadScanner = () => {
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
            scanImageData: zbar.scanImageData,
            scanGrayBuffer: zbar.scanGrayBuffer,
          };
        });
      })
      .catch((error) => {
        debugQrError('main-thread zbar/WASM load failed', error);
        qrScannerPromise = null;
        throw error;
      });
  }
  return qrScannerPromise;
};

export const getQrScanner = async () => {
  const { scanner, scanImageData } = await getMainThreadScanner();
  return {
    scanner,
    scanImageData: (imageData, activeScanner = scanner) => (
      queueZbarScan(() => scanImageData(imageData, activeScanner))
    ),
  };
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

const median = (values) => {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
};

const medianQrSize = (detections) => median(
  detections.map(longestSide).filter((size) => size > 0)
);

const yieldToUI = () => new Promise((resolve) => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
  else window.setTimeout(resolve, 0);
});

const getBarcodeDetector = async () => {
  const Detector = window.BarcodeDetector;
  if (typeof Detector !== 'function' || typeof Detector.getSupportedFormats !== 'function') return null;
  try {
    const formats = await Detector.getSupportedFormats();
    return formats.includes('qr_code') ? new Detector({ formats: ['qr_code'] }) : null;
  } catch (error) {
    debugQrError('BarcodeDetector setup failed', error);
    return null;
  }
};

const resizePhoto = async (imageSource, width, height) => {
  const scale = Math.min(
    1,
    MAX_LONGEST_SIDE / Math.max(width, height),
    Math.sqrt(MAX_CANVAS_PIXELS / (width * height))
  );
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  if (
    typeof createImageBitmap === 'function'
    && (targetWidth !== width || targetHeight !== height)
  ) {
    try {
      const bitmap = await createImageBitmap(imageSource, {
        resizeWidth: targetWidth,
        resizeHeight: targetHeight,
        resizeQuality: 'high',
      });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        sourceScaleX: bitmap.width / width,
        sourceScaleY: bitmap.height / height,
        release: () => bitmap.close(),
      };
    } catch (error) {
      debugQrError('createImageBitmap resize failed; using canvas resize', error);
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not create QR photo resize canvas context');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    imageSource,
    0,
    0,
    targetWidth,
    targetHeight
  );
  return {
    source: canvas,
    width: targetWidth,
    height: targetHeight,
    sourceScaleX: targetWidth / width,
    sourceScaleY: targetHeight / height,
    release: () => {
      canvas.width = 0;
      canvas.height = 0;
    },
  };
};

const makeWorkerSlot = (worker) => {
  let nextId = 0;
  let activeRequest = null;
  let failed = false;
  const queue = [];

  worker.onmessage = ({ data }) => {
    if (!activeRequest || data.id !== activeRequest.id) return;
    const request = activeRequest;
    activeRequest = null;
    if (data.error) request.reject(new Error(data.error));
    else {
      if (DEBUG_QR) console.debug(`[qr-scan] worker completed request ${data.id}`);
      request.resolve(data.detections);
    }
    runNext();
  };

  worker.onmessageerror = (error) => {
    debugQrError('worker message could not be deserialized', error);
    worker.onerror?.(error);
  };

  worker.onerror = (error) => {
    failed = true;
    debugQrError('worker execution/load failed', error);
    if (activeRequest) {
      activeRequest.reject(error);
      activeRequest = null;
    }
    queue.splice(0).forEach((request) => request.reject(error));
  };

  const runNext = async () => {
    if (activeRequest || queue.length === 0) return;
    const request = queue.shift();
    activeRequest = { ...request, id: ++nextId };
    let bitmap;
    try {
      if (typeof OffscreenCanvas === 'function' && typeof createImageBitmap === 'function') {
        bitmap = await createImageBitmap(
          request.source,
          request.region.left,
          request.region.top,
          request.region.width,
          request.region.height
        );
        worker.postMessage({
          id: activeRequest.id,
          bitmap,
          variant: request.variant,
        }, [bitmap]);
      } else {
        const canvas = document.createElement('canvas');
        canvas.width = request.region.width;
        canvas.height = request.region.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(
          request.source,
          request.region.left,
          request.region.top,
          request.region.width,
          request.region.height,
          0,
          0,
          request.region.width,
          request.region.height
        );
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        canvas.width = 0;
        canvas.height = 0;
        worker.postMessage({
          id: activeRequest.id,
          pixels: pixels.data.buffer,
          width: request.region.width,
          height: request.region.height,
          variant: request.variant,
        }, [pixels.data.buffer]);
      }
    } catch (error) {
      bitmap?.close();
      debugQrError('worker request dispatch failed', error);
      activeRequest.reject(error);
      activeRequest = null;
      runNext();
    }
  };

  return {
    scan(source, region, variant) {
      return new Promise((resolve, reject) => {
        if (failed) {
          reject(new Error('QR worker is unavailable'));
          return;
        }
        queue.push({ source, region, variant, resolve, reject });
        runNext();
      });
    },
    terminate() {
      worker.terminate();
    },
  };
};

const getWorkerPool = () => {
  if (workerPool) return workerPool;
  if (
    typeof Worker !== 'function'
  ) {
    return null;
  }
  const slots = [];
  try {
    const count = Math.max(2, Math.min(4, Number(navigator.hardwareConcurrency) || 2));
    for (let index = 0; index < count; index += 1) {
      slots.push(makeWorkerSlot(
        new Worker(new URL('./qrScanWorker.js', import.meta.url), { type: 'module' })
      ));
    }
    workerPool = slots;
    if (DEBUG_QR) console.debug(`[qr-scan] created ${count} module workers`);
    return workerPool;
  } catch (error) {
    debugQrError('worker pool unavailable; using main-thread decoder', error);
    slots.forEach((slot) => slot.terminate());
    workerPool = null;
    return null;
  }
};

const grayFromImageData = (imageData) => {
  const gray = new Uint8Array(imageData.width * imageData.height);
  const rgba = imageData.data;
  for (let source = 0, target = 0; source < rgba.length; source += 4, target += 1) {
    gray[target] = Math.round(rgba[source] * 0.299 + rgba[source + 1] * 0.587 + rgba[source + 2] * 0.114);
  }
  return gray;
};

const boxBlurGray = (source, width, height, radius, horizontal) => {
  const output = new Uint8Array(source.length);
  const major = horizontal ? height : width;
  const minor = horizontal ? width : height;
  const span = radius * 2 + 1;
  for (let line = 0; line < major; line += 1) {
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const position = Math.max(0, Math.min(minor - 1, offset));
      sum += source[horizontal ? line * width + position : position * width + line];
    }
    for (let position = 0; position < minor; position += 1) {
      const index = horizontal ? line * width + position : position * width + line;
      output[index] = Math.round(sum / span);
      const leaving = Math.max(0, position - radius);
      const entering = Math.min(minor - 1, position + radius + 1);
      const leavingIndex = horizontal ? line * width + leaving : leaving * width + line;
      const enteringIndex = horizontal ? line * width + entering : entering * width + line;
      sum += source[enteringIndex] - source[leavingIndex];
    }
  }
  return output;
};

const stretchGray = (gray, minimum, maximum) => {
  const scale = maximum > minimum ? 255 / (maximum - minimum) : 1;
  return gray.map((value) => Math.max(0, Math.min(255, Math.round((value - minimum) * scale))));
};

const prepareFallbackGray = (imageData, variant) => {
  const { width, height } = imageData;
  let gray = grayFromImageData(imageData);
  let outputWidth = width;
  let outputHeight = height;

  if (variant === 'flat' || variant === 'adaptive') {
    const radius = Math.max(2, Math.round(Math.min(width, height) / 30));
    const background = boxBlurGray(
      boxBlurGray(gray, width, height, radius, true),
      width,
      height,
      radius,
      false
    );
    const corrected = new Uint8Array(gray.length);
    let minimum = 255;
    let maximum = 0;
    for (let index = 0; index < gray.length; index += 1) {
      corrected[index] = Math.min(255, Math.round(gray[index] * 128 / Math.max(1, background[index])));
      minimum = Math.min(minimum, corrected[index]);
      maximum = Math.max(maximum, corrected[index]);
    }
    gray = stretchGray(corrected, minimum, maximum);
    if (variant === 'adaptive') {
      const histogram = new Uint32Array(256);
      gray.forEach((value) => { histogram[value] += 1; });
      let minimum = 0;
      let maximum = 255;
      let cumulative = 0;
      for (let value = 0; value < 256; value += 1) {
        cumulative += histogram[value];
        if (cumulative >= gray.length * 0.01) {
          minimum = value;
          break;
        }
      }
      cumulative = 0;
      for (let value = 255; value >= 0; value -= 1) {
        cumulative += histogram[value];
        if (cumulative >= gray.length * 0.01) {
          maximum = value;
          break;
        }
      }
      gray = stretchGray(gray, minimum, maximum);
    }
  }

  if (variant === 'unsharp') {
    const radius = Math.max(1, Math.round(Math.min(width, height) / 80));
    const blurred = boxBlurGray(
      boxBlurGray(gray, width, height, radius, true),
      width,
      height,
      radius,
      false
    );
    gray = gray.map((value, index) => (
      Math.max(0, Math.min(255, Math.round(value + (value - blurred[index]) * 0.6)))
    ));
  } else if (variant === 'inverted') {
    gray = gray.map((value) => 255 - value);
  }
  return { gray, width: outputWidth, height: outputHeight };
};

const fallbackScanRegion = async (source, region, variant) => {
  const started = performance.now();
  const { scanner, scanImageData, scanGrayBuffer } = await getMainThreadScanner();
  const canvas = document.createElement('canvas');
  canvas.width = region.width;
  canvas.height = region.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  try {
    if (!context) throw new Error('Could not create QR fallback canvas context');
    context.drawImage(
      source,
      region.left,
      region.top,
      region.width,
      region.height,
      0,
      0,
      region.width,
      region.height
    );
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    let detections;
    let coordinateScaleX = 1;
    let coordinateScaleY = 1;
    if (variant === 'plain') {
      detections = await queueZbarScan(() => scanImageData(imageData, scanner));
    } else {
      const prepared = prepareFallbackGray(imageData, variant);
      coordinateScaleX = imageData.width / prepared.width;
      coordinateScaleY = imageData.height / prepared.height;
      detections = await queueZbarScan(() => (
        scanGrayBuffer(prepared.gray.buffer, prepared.width, prepared.height, scanner)
      ));
    }
    if (DEBUG_QR) console.debug(`[qr-scan] fallback ${variant} decode ${Math.round(performance.now() - started)}ms`);
    return detections.map((detection) => ({
      rawValue: detection.decode('utf-8').trim(),
      points: detectionPoints(detection).map((point) => ({
        x: point.x * coordinateScaleX,
        y: point.y * coordinateScaleY,
      })),
    })).filter((detection) => detection.rawValue);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
};

const getZXingScanner = async () => {
  if (!zxingScannerPromise) {
    zxingScannerPromise = Promise.all([
      import('zxing-wasm/full'),
      import('zxing-wasm/full/zxing_full.wasm?url'),
    ]).then(([zxing, wasmAsset]) => {
      zxing.setZXingModuleOverrides({
        locateFile: (filename) => (
          filename.endsWith('.wasm') ? wasmAsset.default : filename
        ),
      });
      return zxing;
    }).catch((error) => {
      debugQrError('main-thread zxing/WASM load failed', error);
      zxingScannerPromise = null;
      throw error;
    });
  }
  return zxingScannerPromise;
};

const fallbackZXingScanRegion = async (source, region) => {
  const { readBarcodes } = await getZXingScanner();
  const canvas = document.createElement('canvas');
  canvas.width = region.width;
  canvas.height = region.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  try {
    if (!context) throw new Error('Could not create QR ZXing canvas context');
    context.drawImage(
      source,
      region.left,
      region.top,
      region.width,
      region.height,
      0,
      0,
      region.width,
      region.height
    );
    const results = await readBarcodes(context.getImageData(0, 0, canvas.width, canvas.height), {
      formats: ['QRCode'],
      tryHarder: true,
      tryRotate: true,
    });
    return results.filter((result) => result.text).map((result) => ({
      rawValue: result.text.trim(),
      points: [
        result.position.topLeft,
        result.position.topRight,
        result.position.bottomRight,
        result.position.bottomLeft,
      ],
    }));
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
};

const makeCoarseTiles = (width, height) => {
  const tileWidth = Math.ceil(width * 0.55);
  const tileHeight = Math.ceil(height * 0.55);
  return [0, width - tileWidth].flatMap((left) => (
    [0, height - tileHeight].map((top) => ({
      left,
      top,
      width: tileWidth,
      height: tileHeight,
    }))
  ));
};

const makeVideoTiles = (width, height) => {
  const tileWidth = Math.min(width, Math.max(1, Math.round(Math.min(width, 1000))));
  const tileHeight = Math.min(height, Math.max(1, Math.round(Math.min(height, 1000))));
  const stepX = Math.round(tileWidth * 0.6);
  const stepY = Math.round(tileHeight * 0.6);
  const positions = (extent, tile, step) => {
    if (extent <= tile) return [0];
    const result = [0];
    while (result[result.length - 1] + tile < extent) {
      const next = Math.min(result[result.length - 1] + Math.max(step, 1), extent - tile);
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

const makeScaleLadderTiles = (width, height, fraction) => {
  const tileWidth = Math.min(width, Math.max(1, Math.round(width * fraction)));
  const tileHeight = Math.min(height, Math.max(1, Math.round(height * fraction)));
  const stepX = Math.max(1, Math.round(tileWidth * 0.7));
  const stepY = Math.max(1, Math.round(tileHeight * 0.7));
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

const estimateQrSizeFromImage = (width, height) => Math.max(
  1,
  Math.round(Math.min(width, height) * 0.06)
);

const prepareRegionCanvas = (source, region, qrSize, { addQuietZone = false } = {}) => {
  const estimatedModuleSize = Math.max(1, qrSize / 29);
  const padding = addQuietZone ? Math.ceil(estimatedModuleSize * 4) : 0;
  const paddedWidth = region.width + padding * 2;
  const paddedHeight = region.height + padding * 2;
  const scale = Math.max(1, Math.min(
    180 / Math.max(1, qrSize),
    MAX_LONGEST_SIDE / Math.max(paddedWidth, paddedHeight),
    Math.sqrt(MAX_CANVAS_PIXELS / (paddedWidth * paddedHeight))
  ));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(paddedWidth * scale));
  canvas.height = Math.max(1, Math.round(paddedHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not create QR upscaling canvas context');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    source,
    region.left,
    region.top,
    region.width,
    region.height,
    Math.round(padding * scale),
    Math.round(padding * scale),
    Math.round(region.width * scale),
    Math.round(region.height * scale)
  );
  return {
    source: canvas,
    width: canvas.width,
    height: canvas.height,
    scale,
    padding: padding * scale,
    release: () => {
      canvas.width = 0;
      canvas.height = 0;
    },
  };
};

const projectionPeriod = (projection, minimumLag, maximumLag) => {
  let bestLag = 0;
  let bestScore = 0;
  const end = Math.min(maximumLag, Math.floor(projection.length / 2));
  for (let lag = Math.max(2, minimumLag); lag <= end; lag += 1) {
    let sum = 0;
    let leftPower = 0;
    let rightPower = 0;
    const count = projection.length - lag;
    for (let index = 0; index < count; index += 1) {
      const left = projection[index];
      const right = projection[index + lag];
      sum += left * right;
      leftPower += left * left;
      rightPower += right * right;
    }
    const score = sum / Math.sqrt(Math.max(1, leftPower * rightPower));
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  return bestScore >= 0.12 ? bestLag : 0;
};

const projectionCenters = (projection, pitch, symbolSize) => {
  if (!pitch) return [];
  let bestPhase = 0;
  let bestScore = -Infinity;
  for (let phase = 0; phase < pitch; phase += 1) {
    let score = 0;
    for (let center = phase; center < projection.length; center += pitch) {
      const start = Math.max(0, Math.floor(center - symbolSize / 2));
      const end = Math.min(projection.length, Math.ceil(center + symbolSize / 2));
      for (let index = start; index < end; index += 1) score += projection[index];
    }
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
    }
  }
  const centers = [];
  for (let center = bestPhase; center < projection.length; center += pitch) {
    if (center >= symbolSize / 2 && center < projection.length - symbolSize / 2) centers.push(center);
  }
  return centers;
};

const findLabelCells = (source, width, height, expected, qrSize) => {
  const analysisScale = Math.min(1, 1200 / Math.max(width, height));
  const analysisWidth = Math.max(1, Math.round(width * analysisScale));
  const analysisHeight = Math.max(1, Math.round(height * analysisScale));
  const analysisQrSize = qrSize * analysisScale;
  const canvas = document.createElement('canvas');
  canvas.width = analysisWidth;
  canvas.height = analysisHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not create QR segmentation canvas context');
  try {
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, analysisWidth, analysisHeight);
    const imageData = context.getImageData(0, 0, analysisWidth, analysisHeight);
    const gray = grayFromImageData(imageData);
    const radius = Math.max(2, Math.round(analysisQrSize / 3));
    const background = boxBlurGray(
      boxBlurGray(gray, analysisWidth, analysisHeight, radius, true),
      analysisWidth,
      analysisHeight,
      radius,
      false
    );
    const rows = new Float32Array(analysisHeight);
    const columns = new Float32Array(analysisWidth);
    for (let y = 0; y < analysisHeight; y += 1) {
      for (let x = 0; x < analysisWidth; x += 1) {
        const index = y * analysisWidth + x;
        if (gray[index] < background[index] - 12) {
          rows[y] += 1;
          columns[x] += 1;
        }
      }
    }
    const minPitch = Math.max(2, Math.floor(analysisQrSize * 1.35));
    const maxPitchX = Math.min(analysisWidth / 2, Math.ceil(analysisQrSize * 3.2));
    const maxPitchY = Math.min(analysisHeight / 2, Math.ceil(analysisQrSize * 3.2));
    const xPitch = projectionPeriod(columns, minPitch, maxPitchX);
    const yPitch = projectionPeriod(rows, minPitch, maxPitchY);
    let xCenters = projectionCenters(columns, xPitch, analysisQrSize);
    let yCenters = projectionCenters(rows, yPitch, analysisQrSize);

    if (expected > 0) {
      const layouts = [];
      for (let columnsCount = 1; columnsCount <= expected; columnsCount += 1) {
        const rowsCount = Math.ceil(expected / columnsCount);
        const pitchRatio = (width / columnsCount) / (height / rowsCount);
        layouts.push({
          columns: columnsCount,
          rows: rowsCount,
          score: Math.abs(Math.log(Math.max(0.01, pitchRatio / 0.85))),
        });
      }
      layouts.sort((a, b) => a.score - b.score);
      const layout = layouts[0];
      if (xCenters.length !== layout.columns) {
        xCenters = projectionCenters(columns, analysisWidth / layout.columns, analysisQrSize);
      }
      if (yCenters.length !== layout.rows) {
        yCenters = projectionCenters(rows, analysisHeight / layout.rows, analysisQrSize);
      }
    }
    if (!xCenters.length || !yCenters.length) return [];

    const cellWidth = Math.min(
      qrSize * 1.45,
      (xPitch / analysisScale) || qrSize * 1.6
    );
    const cellHeight = Math.min(
      qrSize * 1.45,
      (yPitch / analysisScale) || qrSize * 1.6
    );
    const cells = [];
    yCenters.forEach((centerY) => {
      xCenters.forEach((centerX) => {
        const originalCenterX = centerX / analysisScale;
        const originalCenterY = centerY / analysisScale;
        cells.push({
          left: Math.max(0, originalCenterX - cellWidth / 2),
          top: Math.max(0, originalCenterY - cellHeight / 2),
          width: Math.min(width, cellWidth),
          height: Math.min(height, cellHeight),
          centerX: originalCenterX,
          centerY: originalCenterY,
        });
      });
    });
    return expected > 0 ? cells.slice(0, expected) : cells;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
};

const makeSlidingTiles = (width, height, qrSize) => {
  if (qrSize <= 0) return makeScaleLadderTiles(width, height, 0.3);
  const tileWidth = Math.min(width, Math.max(1, Math.round(qrSize * 5)));
  const tileHeight = Math.min(height, Math.max(1, Math.round(qrSize * 5)));
  const stepX = Math.round(tileWidth - qrSize * 1.5);
  const stepY = Math.round(tileHeight - qrSize * 1.5);
  const positions = (extent, tile, step) => {
    if (extent <= tile) return [0];
    const result = [0];
    while (result[result.length - 1] + tile < extent) {
      const next = Math.min(result[result.length - 1] + Math.max(step, 1), extent - tile);
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

const clusterCoordinates = (coordinates, tolerance) => {
  const sorted = [...coordinates].sort((a, b) => a - b);
  const clusters = [];
  sorted.forEach((value) => {
    const current = clusters[clusters.length - 1];
    if (!current || value - current.mean > tolerance) {
      clusters.push({ values: [value], mean: value });
    } else {
      current.values.push(value);
      current.mean = current.values.reduce((sum, item) => sum + item, 0) / current.values.length;
    }
  });
  return clusters.map((cluster) => cluster.mean);
};

const estimateGrid = (detections, qrSize) => {
  if (detections.length < 4 || qrSize <= 0) return { gaps: [], qrSize };
  const centers = detections.map((detection) => {
    const points = detectionPoints(detection);
    if (points.length === 0) return null;
    return points.reduce((center, point) => ({
      x: center.x + point.x / points.length,
      y: center.y + point.y / points.length,
    }), { x: 0, y: 0 });
  }).filter(Boolean);

  const xLines = clusterCoordinates(centers.map((point) => point.x), qrSize * 0.55);
  const yLines = clusterCoordinates(centers.map((point) => point.y), qrSize * 0.55);
  const spacing = (lines) => median(lines.slice(1).map((line, index) => line - lines[index])
    .filter((distance) => distance >= qrSize * 0.7 && distance <= qrSize * 3.2));
  const xSpacing = spacing(xLines);
  const ySpacing = spacing(yLines);
  if (!xSpacing || !ySpacing) return { gaps: [], qrSize };

  const xCount = Math.round((xLines[xLines.length - 1] - xLines[0]) / xSpacing) + 1;
  const yCount = Math.round((yLines[yLines.length - 1] - yLines[0]) / ySpacing) + 1;
  if (xCount < 2 || yCount < 2 || xCount * yCount > detections.length + 20) {
    return { gaps: [], qrSize };
  }
  const occupied = new Set();
  centers.forEach((center) => {
    const column = Math.round((center.x - xLines[0]) / xSpacing);
    const row = Math.round((center.y - yLines[0]) / ySpacing);
    if (
      column >= 0 && column < xCount && row >= 0 && row < yCount
      && Math.abs(center.x - (xLines[0] + column * xSpacing)) < xSpacing * 0.4
      && Math.abs(center.y - (yLines[0] + row * ySpacing)) < ySpacing * 0.4
    ) occupied.add(`${column}:${row}`);
  });

  const gaps = [];
  for (let row = 0; row < yCount; row += 1) {
    for (let column = 0; column < xCount; column += 1) {
      if (occupied.has(`${column}:${row}`)) continue;
      const centerX = xLines[0] + column * xSpacing;
      const centerY = yLines[0] + row * ySpacing;
      const side = qrSize * 1.6;
      gaps.push({
        left: centerX - side / 2,
        top: centerY - side / 2,
        width: side,
        height: side,
        centerX,
        centerY,
      });
    }
  }
  return { gaps, qrSize, rows: yCount, columns: xCount };
};

const toOriginalCoordinates = (
  detections,
  region,
  sourceScaleX,
  sourceScaleY,
  scale = 1,
  padding = 0
) => (
  detections.map((detection) => ({
    ...detection,
    points: detectionPoints(detection).map((point) => ({
      x: (region.left + (point.x - padding) / scale) / sourceScaleX,
      y: (region.top + (point.y - padding) / scale) / sourceScaleY,
    })),
  }))
);

const toWorkingCoordinates = (detections, sourceScaleX, sourceScaleY) => (
  detections.map((detection) => ({
    ...detection,
    points: detectionPoints(detection).map((point) => ({
      x: point.x * sourceScaleX,
      y: point.y * sourceScaleY,
    })),
  }))
);

/**
 * DevTools benchmark: import('/src/utils/qrImageScanner.js'), then call
 * benchmark100QrImage(file) with the known 100-label photo to assert its count and log time.
 */
export const benchmark100QrImage = async (file) => {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const started = performance.now();
  try {
    const passCounts = new Map();
    const detections = await scanTiled(bitmap, bitmap.width, bitmap.height, {
      expectedCodeCount: 100,
      deepScan: true,
      onProgress: ({ pass, codes }) => passCounts.set(pass, codes),
    });
    const elapsed = performance.now() - started;
    console.info(`[qr-scan benchmark] found=${detections.length} total=${Math.round(elapsed)}ms`);
    const passNames = [
      'initial',
      '30% tiles',
      '20% tiles',
      '12% tiles',
      'cell crops',
      'flat-field',
      'adaptive',
      'unsharp',
      'inverted',
      'ZXing',
    ];
    let previousCount = 0;
    const summary = [...passCounts.entries()].sort(([a], [b]) => a - b).map(([pass, codes]) => {
      const added = Math.max(0, codes - previousCount);
      previousCount = codes;
      return `${passNames[pass - 1]} +${added} (${codes})`;
    });
    const solvedAt = [...passCounts.entries()]
      .sort(([a], [b]) => a - b)
      .find(([, codes]) => codes >= 98);
    console.info(
      `[qr-scan benchmark] passes=${summary.join(', ')}; `
      + `98+ first reached=${solvedAt ? passNames[solvedAt[0] - 1] : 'not reached'}`
    );
    if (detections.length < 98) {
      throw new Error(`Expected at least 98 of 100 QR codes, found ${detections.length}`);
    }
    return { count: detections.length, elapsed };
  } finally {
    bitmap.close();
  }
};

export const scanTiled = async (
  imageSource,
  width,
  height,
  { expectedCodeCount = 0, onProgress, deepScan = false } = {}
) => {
  const totalStart = performance.now();
  const preprocessStart = performance.now();
  const resized = await resizePhoto(imageSource, width, height);
  const { source, sourceScaleX, sourceScaleY } = resized;
  const detector = await getBarcodeDetector();
  const isVideo = !deepScan && imageSource?.tagName === 'VIDEO';
  const pool = isVideo ? null : getWorkerPool();
  const results = new Map();
  const expected = Math.max(0, Number(expectedCodeCount) || 0);
  let qrSize = 0;
  let activePass = 0;
  const totalPasses = deepScan ? 10 : 2;
  const report = () => onProgress?.({ pass: activePass, totalPasses, codes: results.size });
  const merge = (detections) => {
    const added = [];
    detections.forEach((detection) => {
      const rawValue = detectionValue(detection);
      if (!rawValue || results.has(rawValue)) return;
      const normalized = { ...detection, rawValue };
      results.set(rawValue, normalized);
      added.push(normalized);
    });
    return added;
  };
  const normalizeRegion = (region) => {
    const left = Math.max(0, Math.min(resized.width - 1, Math.floor(region.left)));
    const top = Math.max(0, Math.min(resized.height - 1, Math.floor(region.top)));
    return {
      left,
      top,
      width: Math.max(1, Math.min(resized.width - left, Math.ceil(region.width))),
      height: Math.max(1, Math.min(resized.height - top, Math.ceil(region.height))),
    };
  };

  const scanRegion = async (region, variant = 'plain', workerIndex = 0, options = {}) => {
    const safeRegion = normalizeRegion(region);
    const prepared = options.upscale || options.addQuietZone
      ? prepareRegionCanvas(source, safeRegion, qrSize, { addQuietZone: options.addQuietZone })
      : null;
    const scanSource = prepared?.source || source;
    const scanRect = prepared
      ? { left: 0, top: 0, width: prepared.width, height: prepared.height }
      : safeRegion;
    try {
      let detections;
      if (pool) {
        detections = await pool[workerIndex % pool.length].scan(scanSource, scanRect, variant);
      } else if (variant === 'zxing') {
        detections = await fallbackZXingScanRegion(scanSource, scanRect);
      } else {
        detections = await fallbackScanRegion(scanSource, scanRect, variant);
      }
      return toOriginalCoordinates(
        detections,
        safeRegion,
        sourceScaleX,
        sourceScaleY,
        prepared?.scale || 1,
        prepared?.padding || 0
      );
    } finally {
      prepared?.release();
    }
  };

  const scanRegions = async (regions, stage, variant = 'plain', options = {}) => {
    activePass = stage;
    report();
    const stageStart = performance.now();
    let cursor = 0;
    let addedCount = 0;
    let failureCount = 0;
    let firstError;
    const unresolvedRegions = [];
    const runWorker = async (workerIndex) => {
      while (cursor < regions.length) {
        if (expected > 0 && results.size >= expected) break;
        const index = cursor;
        cursor += 1;
        const region = regions[index];
        try {
          let detections;
          try {
            detections = await scanRegion(region, variant, workerIndex, options);
          } catch (workerError) {
            if (!pool) throw workerError;
            debugQrError(`worker ${variant} scan failed; retrying on main thread`, workerError);
            detections = await scanRegionOnMainThread(region, variant, options);
          }
          const added = merge(detections);
          if (added.length === 0) unresolvedRegions.push(region);
          addedCount += added.length;
          report();
        } catch (error) {
          debugQrError(`pass ${stage} ${variant} tile failed`, error);
          failureCount += 1;
          if (!firstError) firstError = error;
          unresolvedRegions.push(region);
        }
        await yieldToUI();
      }
    };
    const count = pool ? pool.length : 1;
    await Promise.all(Array.from({ length: Math.min(count, regions.length) }, (_, index) => runWorker(index)));
    if (failureCount === regions.length && regions.length > 0) {
      throw firstError || new Error('All QR tile scans failed');
    }
    if (DEBUG_QR) {
      console.debug(
        `[qr-scan] pass ${stage}/${totalPasses} ${variant}: `
        + `${regions.length} tiles (${regions[0]?.width || 0}x${regions[0]?.height || 0}), `
        + `+${addedCount} codes (${results.size} total), `
        + `${Math.round(performance.now() - stageStart)}ms`
      );
    }
    return { unresolvedRegions, addedCount };
  };

  const scanRegionOnMainThread = async (region, variant, options) => {
    const safeRegion = normalizeRegion(region);
    const prepared = options.upscale || options.addQuietZone
      ? prepareRegionCanvas(source, safeRegion, qrSize, { addQuietZone: options.addQuietZone })
      : null;
    const scanSource = prepared?.source || source;
    const scanRect = prepared
      ? { left: 0, top: 0, width: prepared.width, height: prepared.height }
      : safeRegion;
    try {
      const detections = variant === 'zxing'
        ? await fallbackZXingScanRegion(scanSource, scanRect)
        : await fallbackScanRegion(scanSource, scanRect, variant);
      return toOriginalCoordinates(
        detections,
        safeRegion,
        sourceScaleX,
        sourceScaleY,
        prepared?.scale || 1,
        prepared?.padding || 0
      );
    } finally {
      prepared?.release();
    }
  };

  try {
    if (DEBUG_QR) {
      console.debug(
        `[qr-scan] source=${width}x${height}, resized=${resized.width}x${resized.height}, `
        + `scale=${sourceScaleX.toFixed(3)}x${sourceScaleY.toFixed(3)}, `
        + `path=${detector && deepScan ? 'BarcodeDetector + ' : ''}`
        + `${pool ? `${pool.length} worker(s)` : 'main-thread fallback'}`
      );
    }

    if (detector && deepScan) {
      const detectorStart = performance.now();
      try {
        const detected = await detector.detect(source);
        merge(detected.map((detection) => ({
          ...detection,
          points: detectionPoints(detection).map((point) => ({
            x: point.x / sourceScaleX,
            y: point.y / sourceScaleY,
          })),
        })));
        if (DEBUG_QR) {
          console.debug(
            `[qr-scan] BarcodeDetector pass found ${results.size} codes in `
            + `${Math.round(performance.now() - detectorStart)}ms`
          );
        }
      } catch (error) {
        debugQrError('BarcodeDetector scan failed; continuing with worker decoder', error);
      }
    }

    if (isVideo) {
      const tiles = makeVideoTiles(resized.width, resized.height);
      await scanRegions(tiles.slice(0, 9), 1);
      return [...results.values()];
    }

    const fullRegion = { left: 0, top: 0, width: resized.width, height: resized.height };
    await scanRegions(
      [fullRegion, ...makeCoarseTiles(resized.width, resized.height)],
      1
    );
    const firstPassDetections = [...results.values()];
    const firstPassWorking = toWorkingCoordinates(firstPassDetections, sourceScaleX, sourceScaleY);
    qrSize = medianQrSize(firstPassWorking) || estimateQrSizeFromImage(resized.width, resized.height);
    let grid = estimateGrid(firstPassWorking, qrSize);
    const completeGrid = expected === 0
      && grid.rows > 0
      && grid.columns > 0
      && grid.gaps.length === 0
      && grid.rows * grid.columns === results.size
      && grid.columns >= Math.ceil(resized.width / (qrSize * 3.2))
      && grid.rows >= Math.ceil(resized.height / (qrSize * 3.2));

    if (!deepScan) {
      const fallbackWindows = makeSlidingTiles(resized.width, resized.height, medianQrSize(firstPassWorking));
      const passTwoRegions = grid.gaps.length > 0
        ? grid.gaps.map(({ left, top, width: cropWidth, height: cropHeight }) => ({
          left: Math.max(0, Math.min(resized.width - cropWidth, left)),
          top: Math.max(0, Math.min(resized.height - cropHeight, top)),
          width: Math.min(resized.width, cropWidth),
          height: Math.min(resized.height, cropHeight),
        }))
        : fallbackWindows;
      await scanRegions(passTwoRegions, 2);
      const finalWorking = toWorkingCoordinates([...results.values()], sourceScaleX, sourceScaleY);
      grid = estimateGrid(finalWorking, medianQrSize(finalWorking) || qrSize);
      return attachMissingCells(
        [...results.values()],
        grid,
        expected,
        sourceScaleX,
        sourceScaleY
      );
    }

    if ((expected > 0 && results.size >= expected) || completeGrid) {
      const finalWorking = toWorkingCoordinates([...results.values()], sourceScaleX, sourceScaleY);
      grid = estimateGrid(finalWorking, medianQrSize(finalWorking) || qrSize);
      return attachMissingCells([...results.values()], grid, expected, sourceScaleX, sourceScaleY);
    }

    const ladder = [
      { fraction: 0.3, pass: 2 },
      { fraction: 0.2, pass: 3 },
      { fraction: 0.12, pass: 4 },
    ];
    let remainingTiles = [];
    for (const { fraction, pass } of ladder) {
      const tiles = makeScaleLadderTiles(resized.width, resized.height, fraction);
      const tileResult = await scanRegions(tiles, pass, 'plain', { upscale: true });
      remainingTiles = tileResult.unresolvedRegions;
      if (expected > 0 && results.size >= expected) break;
    }

    if (expected > 0 && results.size >= expected) {
      const finalWorking = toWorkingCoordinates([...results.values()], sourceScaleX, sourceScaleY);
      grid = estimateGrid(finalWorking, medianQrSize(finalWorking) || qrSize);
      return attachMissingCells([...results.values()], grid, expected, sourceScaleX, sourceScaleY);
    }

    const currentWorking = toWorkingCoordinates([...results.values()], sourceScaleX, sourceScaleY);
    const detectedQrSize = medianQrSize(currentWorking) || qrSize;
    grid = estimateGrid(currentWorking, detectedQrSize);
    let cells = findLabelCells(source, resized.width, resized.height, expected, detectedQrSize);
    const existingCenters = currentWorking.map((detection) => {
      const points = detectionPoints(detection);
      return points.reduce((center, point) => ({
        x: center.x + point.x / points.length,
        y: center.y + point.y / points.length,
      }), { x: 0, y: 0 });
    });
    cells = cells.filter((cell) => !existingCenters.some((center) => (
      Math.hypot(center.x - cell.centerX, center.y - cell.centerY) < detectedQrSize * 0.8
    )));
    if (cells.length === 0 && grid.gaps.length > 0) {
      cells = grid.gaps;
    }
    if (cells.length === 0) {
      cells = remainingTiles;
    }

    let remaining = cells;
    if (remaining.length > 0) {
      const plain = await scanRegions(remaining, 5, 'plain', {
        upscale: true,
        addQuietZone: true,
      });
      remaining = plain.unresolvedRegions;
    } else {
      activePass = 5;
      report();
      if (DEBUG_QR) console.debug('[qr-scan] pass 5 skipped: no unresolved cells');
    }

    const variants = [
      { name: 'flat', pass: 6 },
      { name: 'adaptive', pass: 7 },
      { name: 'unsharp', pass: 8 },
      { name: 'inverted', pass: 9 },
    ];
    for (const variant of variants) {
      if (expected > 0 && results.size >= expected) break;
      if (remaining.length === 0) break;
      const next = await scanRegions(remaining, variant.pass, variant.name, {
        upscale: true,
        addQuietZone: true,
      });
      remaining = next.unresolvedRegions;
    }

    if (remaining.length > 0 && (expected === 0 || results.size < expected)) {
      await scanRegions(remaining, 10, 'zxing', {
        upscale: true,
        addQuietZone: true,
      });
    } else {
      activePass = 10;
      report();
      if (DEBUG_QR) console.debug('[qr-scan] pass 10 skipped: no unresolved cells');
    }

    const finalWorking = toWorkingCoordinates([...results.values()], sourceScaleX, sourceScaleY);
    grid = estimateGrid(finalWorking, medianQrSize(finalWorking) || qrSize);
    const output = attachMissingCells([...results.values()], grid, expected, sourceScaleX, sourceScaleY);
    if (DEBUG_QR) {
      console.debug(`[qr-scan] decode total=${Math.round(performance.now() - totalStart)}ms, preprocessing=${Math.round(performance.now() - preprocessStart)}ms`);
    }
    return output;
  } finally {
    resized.release();
  }
};

const attachMissingCells = (detections, grid, expected, sourceScaleX = 1, sourceScaleY = 1) => {
  const positions = grid.gaps.map(({ centerX, centerY }) => ({
    x: centerX / sourceScaleX,
    y: centerY / sourceScaleY,
  }));
  const count = positions.length || (expected > detections.length ? expected - detections.length : 0);
  detections.missingCells = { count, positions };
  detections.found = detections.length;
  if (expected > 0) {
    detections.expected = expected;
    if (detections.length > expected) detections.exceededExpected = true;
  }
  return detections;
};
