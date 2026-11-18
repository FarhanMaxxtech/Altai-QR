const MAX_CANVAS_PIXELS = 8_000_000;
const MAX_LONGEST_SIDE = 3400;
const DEBUG_QR = false;
let qrScannerPromise;
let workerPool;
let zbarScanQueue = Promise.resolve();

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
  } catch {
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
    } catch {
      // Older Safari versions may not support resize options.
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(
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
    else request.resolve(data.detections);
    runNext();
  };

  worker.onerror = (error) => {
    failed = true;
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
    return workerPool;
  } catch (error) {
    console.debug('QR worker pool unavailable; using main-thread decoder:', error);
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

  if (variant === 'flat' || variant === 'upscale' || variant === 'adaptive') {
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

  if (variant === 'upscale') {
    const scale = Math.min(2, Math.sqrt(MAX_CANVAS_PIXELS / gray.length));
    if (scale > 1.05) {
      outputWidth = Math.round(width * scale);
      outputHeight = Math.round(height * scale);
      const enlarged = new Uint8Array(outputWidth * outputHeight);
      for (let y = 0; y < outputHeight; y += 1) {
        const sourceY = Math.min(height - 1, Math.floor(y / scale));
        for (let x = 0; x < outputWidth; x += 1) {
          const sourceX = Math.min(width - 1, Math.floor(x / scale));
          enlarged[y * outputWidth + x] = gray[sourceY * width + sourceX];
        }
      }
      gray = enlarged;
    }
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

const makeSlidingTiles = (width, height, qrSize) => {
  const fallback = qrSize <= 0;
  const tileWidth = Math.min(width, Math.max(1, Math.round(fallback ? 1000 : qrSize * 5)));
  const tileHeight = Math.min(height, Math.max(1, Math.round(fallback ? 1000 : qrSize * 5)));
  const stepX = fallback ? Math.round(tileWidth * 0.6) : Math.round(tileWidth - qrSize * 1.5);
  const stepY = fallback ? Math.round(tileHeight * 0.6) : Math.round(tileHeight - qrSize * 1.5);
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

const toOriginalCoordinates = (detections, region, sourceScaleX, sourceScaleY) => (
  detections.map((detection) => ({
    ...detection,
    points: detectionPoints(detection).map((point) => ({
      x: (region.left + point.x) / sourceScaleX,
      y: (region.top + point.y) / sourceScaleY,
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
    const detections = await scanTiled(bitmap, bitmap.width, bitmap.height, {
      expectedCodeCount: 100,
      deepScan: true,
    });
    const elapsed = performance.now() - started;
    console.info(`[qr-scan benchmark] found=${detections.length} total=${Math.round(elapsed)}ms`);
    if (detections.length !== 100) {
      throw new Error(`Expected 100 QR codes, found ${detections.length}`);
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
  const pool = !deepScan && imageSource?.tagName === 'VIDEO' ? null : getWorkerPool();
  const results = new Map();
  const expected = Math.max(0, Number(expectedCodeCount) || 0);
  let qrSize = 0;
  let activePass = 0;
  let qrModuleSize = 0;
  const totalPasses = deepScan ? 5 : 2;
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

  const scanRegion = async (region, variant = 'plain', workerIndex = 0) => {
    const safeRegion = normalizeRegion(region);
    if (pool) {
      const workerDetections = await pool[workerIndex % pool.length].scan(source, safeRegion, variant);
      return toOriginalCoordinates(workerDetections, safeRegion, sourceScaleX, sourceScaleY);
    }
    const detections = await fallbackScanRegion(source, safeRegion, variant);
    return toOriginalCoordinates(detections, safeRegion, sourceScaleX, sourceScaleY);
  };

  const scanRegions = async (regions, stage, variant = 'plain') => {
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
        const index = cursor;
        cursor += 1;
        const region = regions[index];
        try {
          let detections;
          try {
            detections = await scanRegion(region, variant, workerIndex);
          } catch (workerError) {
            if (!pool) throw workerError;
            console.debug('QR worker tile failed; retrying on the main thread:', workerError);
            const safeRegion = normalizeRegion(region);
            detections = await fallbackScanRegion(source, safeRegion, variant);
            detections = toOriginalCoordinates(detections, safeRegion, sourceScaleX, sourceScaleY);
          }
          const added = merge(detections);
          if (added.length === 0) unresolvedRegions.push(region);
          addedCount += added.length;
          report();
        } catch (error) {
          console.debug('QR tile scan failed:', error);
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
      console.debug(`[qr-scan] pass ${stage} ${variant}: ${Math.round(performance.now() - stageStart)}ms, ${results.size} codes`);
    }
    return { unresolvedRegions, addedCount };
  };

  try {
    if (DEBUG_QR) console.debug(`[qr-scan] preprocess/resized: ${Math.round(performance.now() - preprocessStart)}ms`);

    if (detector && deepScan) {
      try {
        const detected = await detector.detect(source);
        merge(detected.map((detection) => ({
          ...detection,
          points: detectionPoints(detection).map((point) => ({
            x: point.x / sourceScaleX,
            y: point.y / sourceScaleY,
          })),
        })));
      } catch {
        // Continue with zbar in tiles.
      }
    }

    if (!deepScan && imageSource?.tagName === 'VIDEO') {
      const tiles = makeSlidingTiles(resized.width, resized.height, 0);
      await scanRegions(tiles.slice(0, 9), 1);
      return [...results.values()];
    }

    const fullRegion = { left: 0, top: 0, width: resized.width, height: resized.height };
    await scanRegions([fullRegion, ...makeCoarseTiles(resized.width, resized.height)], 1);
    const firstPassDetections = [...results.values()];
    const firstPassWorking = toWorkingCoordinates(firstPassDetections, sourceScaleX, sourceScaleY);
    qrSize = medianQrSize(firstPassWorking);
    qrModuleSize = qrSize / 29;
    let grid = estimateGrid(firstPassWorking, qrSize);
    const fallbackWindows = makeSlidingTiles(resized.width, resized.height, qrSize);
    const usedGridGaps = grid.gaps.length > 0;
    const passTwoRegions = usedGridGaps
      ? grid.gaps.map(({ left, top, width: cropWidth, height: cropHeight }) => ({
        left: Math.max(0, Math.min(resized.width - cropWidth, left)),
        top: Math.max(0, Math.min(resized.height - cropHeight, top)),
        width: Math.min(resized.width, cropWidth),
        height: Math.min(resized.height, cropHeight),
      }))
      : fallbackWindows;
    const passTwo = await scanRegions(passTwoRegions, 2);
    const shouldRunExtraRecovery = expected > 0
      ? results.size < expected
      : passTwo.addedCount > 0;
    if (!deepScan) {
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
    if (!shouldRunExtraRecovery) {
      const finalWorking = toWorkingCoordinates([...results.values()], sourceScaleX, sourceScaleY);
      grid = estimateGrid(finalWorking, medianQrSize(finalWorking) || qrSize);
      return attachMissingCells([...results.values()], grid, expected, sourceScaleX, sourceScaleY);
    }

    const currentWorking = toWorkingCoordinates([...results.values()], sourceScaleX, sourceScaleY);
    grid = estimateGrid(currentWorking, medianQrSize(currentWorking));
    const unresolved = grid.gaps.length > 0
      ? grid.gaps.map(({ left, top, width: cropWidth, height: cropHeight }) => ({
        left: Math.max(0, Math.min(resized.width - cropWidth, left)),
        top: Math.max(0, Math.min(resized.height - cropHeight, top)),
        width: Math.min(resized.width, cropWidth),
        height: Math.min(resized.height, cropHeight),
      }))
      : passTwo.unresolvedRegions;

    const variants = [
      { name: 'flat', run: true },
      { name: 'upscale', run: qrModuleSize < 3 },
      { name: 'adaptive', run: true },
    ];
    let remaining = unresolved;
    for (let index = 0; index < variants.length && remaining.length > 0; index += 1) {
      if (!variants[index].run) continue;
      const next = await scanRegions(remaining, index + 3, variants[index].name);
      remaining = next.unresolvedRegions;
      if (next.addedCount === 0) break;
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
