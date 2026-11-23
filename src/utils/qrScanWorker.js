import * as zbar from '@undecaf/zbar-wasm';
import wasmUrl from '@undecaf/zbar-wasm/dist/zbar.wasm?url';

const DEBUG_QR = false;
let scannerPromise;
let zxingPromise;

const debugError = (message, error) => {
  if (DEBUG_QR) console.debug(`[qr-worker] ${message}`, error);
};

const getScanner = () => {
  if (!scannerPromise) {
    zbar.setModuleArgs({
      locateFile: (filename) => (filename === 'zbar.wasm' ? wasmUrl : filename),
    });
    scannerPromise = zbar.getDefaultScanner()
      .then((scanner) => {
        scanner.setConfig(zbar.ZBarSymbolType.ZBAR_NONE, zbar.ZBarConfigType.ZBAR_CFG_ENABLE, 0);
        scanner.setConfig(zbar.ZBarSymbolType.ZBAR_QRCODE, zbar.ZBarConfigType.ZBAR_CFG_ENABLE, 1);
        if (DEBUG_QR) console.debug('[qr-worker] zbar/WASM loaded');
        return scanner;
      })
      .catch((error) => {
        debugError('zbar/WASM load failed', error);
        scannerPromise = null;
        throw error;
      });
  }
  return scannerPromise;
};

const grayscale = (rgba) => {
  const luminance = new Uint8Array(rgba.length / 4);
  for (let source = 0, target = 0; source < rgba.length; source += 4, target += 1) {
    luminance[target] = Math.round(
      rgba[source] * 0.299 + rgba[source + 1] * 0.587 + rgba[source + 2] * 0.114
    );
  }
  return luminance;
};

const boxBlur = (source, width, height, radius, horizontal) => {
  const output = new Uint8Array(source.length);
  const span = radius * 2 + 1;
  const major = horizontal ? height : width;
  const minor = horizontal ? width : height;
  for (let line = 0; line < major; line += 1) {
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const position = Math.max(0, Math.min(minor - 1, offset));
      const index = horizontal ? line * width + position : position * width + line;
      sum += source[index];
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

const normalizeFlatField = (luminance, width, height) => {
  const radius = Math.max(2, Math.round(Math.min(width, height) / 30));
  const background = boxBlur(boxBlur(luminance, width, height, radius, true), width, height, radius, false);
  const corrected = new Uint8Array(luminance.length);
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let index = 0; index < luminance.length; index += 1) {
    const ratio = luminance[index] * 128 / Math.max(1, background[index]);
    corrected[index] = Math.min(255, Math.max(0, Math.round(ratio)));
    minimum = Math.min(minimum, corrected[index]);
    maximum = Math.max(maximum, corrected[index]);
  }
  return stretch(corrected, minimum, maximum);
};

const stretch = (luminance, minimum, maximum) => {
  const output = new Uint8Array(luminance.length);
  const scale = maximum > minimum ? 255 / (maximum - minimum) : 1;
  for (let index = 0; index < luminance.length; index += 1) {
    output[index] = Math.max(0, Math.min(255, Math.round((luminance[index] - minimum) * scale)));
  }
  return output;
};

const adaptiveContrast = (luminance) => {
  const histogram = new Uint32Array(256);
  luminance.forEach((value) => { histogram[value] += 1; });
  const lowLimit = luminance.length * 0.01;
  const highLimit = luminance.length * 0.99;
  let cumulative = 0;
  let minimum = 0;
  let maximum = 255;
  for (let value = 0; value < 256; value += 1) {
    cumulative += histogram[value];
    if (cumulative >= lowLimit) {
      minimum = value;
      break;
    }
  }
  cumulative = 0;
  for (let value = 255; value >= 0; value -= 1) {
    cumulative += histogram[value];
    if (cumulative >= luminance.length - highLimit) {
      maximum = value;
      break;
    }
  }
  return stretch(luminance, minimum, maximum);
};

const scanPixels = async (sourceGray, width, height, variant) => {
  const stageStart = performance.now();
  let luminance = new Uint8Array(sourceGray);
  if (variant === 'flat' || variant === 'adaptive') {
    luminance = normalizeFlatField(luminance, width, height);
  }
  if (variant === 'adaptive') luminance = adaptiveContrast(luminance);
  if (variant === 'unsharp') {
    const radius = Math.max(1, Math.round(Math.min(width, height) / 80));
    const blurred = boxBlur(boxBlur(luminance, width, height, radius, true), width, height, radius, false);
    for (let index = 0; index < luminance.length; index += 1) {
      luminance[index] = Math.max(0, Math.min(255, Math.round(
        luminance[index] + (luminance[index] - blurred[index]) * 0.6
      )));
    }
  } else if (variant === 'inverted') {
    for (let index = 0; index < luminance.length; index += 1) {
      luminance[index] = 255 - luminance[index];
    }
  }
  const scanner = await getScanner();
  const decodeStart = performance.now();
  const symbols = await zbar.scanGrayBuffer(luminance.buffer, width, height, scanner);
  if (DEBUG_QR) {
    console.debug(`[qr-worker] ${variant} preprocess=${Math.round(decodeStart - stageStart)}ms decode=${Math.round(performance.now() - decodeStart)}ms`);
  }
  return symbols.map((symbol) => ({
    rawValue: symbol.decode('utf-8').trim(),
    points: symbol.points.map((point) => ({ x: point.x, y: point.y })),
  })).filter((symbol) => symbol.rawValue);
};

const getZXing = async () => {
  if (!zxingPromise) {
    zxingPromise = Promise.all([
      import('zxing-wasm/full'),
      import('zxing-wasm/full/zxing_full.wasm?url'),
    ]).then(([zxing, wasmAsset]) => {
      zxing.setZXingModuleOverrides({
        locateFile: (filename) => (
          filename.endsWith('.wasm') ? wasmAsset.default : filename
        ),
      });
      if (DEBUG_QR) console.debug('[qr-worker] zxing/WASM loaded');
      return zxing;
    }).catch((error) => {
      debugError('zxing/WASM load failed', error);
      zxingPromise = null;
      throw error;
    });
  }
  return zxingPromise;
};

const scanZXing = async (rgba, width, height) => {
  const { readBarcodes } = await getZXing();
  const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
  const results = await readBarcodes(imageData, {
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
};

self.onmessage = async ({ data }) => {
  const { id, bitmap, pixels, pixelFormat, width, height, variant } = data;
  let canvas;
  try {
    let pixelBuffer = pixels;
    let format = pixelFormat || 'rgba';
    let imageWidth = width;
    let imageHeight = height;
    if (bitmap) {
      if (typeof OffscreenCanvas !== 'function') {
        throw new Error('OffscreenCanvas is unavailable for bitmap worker input');
      }
      canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Could not create QR worker canvas context');
      context.drawImage(bitmap, 0, 0);
      pixelBuffer = context.getImageData(0, 0, canvas.width, canvas.height).data;
      format = 'rgba';
      imageWidth = canvas.width;
      imageHeight = canvas.height;
    }
    if (DEBUG_QR) console.debug(`[qr-worker] request ${id} ${variant} ${imageWidth}x${imageHeight}`);
    const pixelsData = pixelBuffer instanceof Uint8Array || pixelBuffer instanceof Uint8ClampedArray
      ? pixelBuffer
      : new Uint8Array(pixelBuffer);
    const detections = variant === 'zxing'
      ? await scanZXing(pixelsData, imageWidth, imageHeight)
      : await scanPixels(
        format === 'gray' ? pixelsData : grayscale(pixelsData),
        imageWidth,
        imageHeight,
        variant
      );
    self.postMessage({ id, detections });
  } catch (error) {
    debugError(`${variant} scan failed`, error);
    self.postMessage({ id, error: error.message || 'QR worker scan failed' });
  } finally {
    bitmap?.close();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
};
