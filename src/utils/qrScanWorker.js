import * as zbar from '@undecaf/zbar-wasm';
import wasmUrl from '@undecaf/zbar-wasm/dist/zbar.wasm?url';

const DEBUG_QR = false;
let scannerPromise;

const getScanner = () => {
  if (!scannerPromise) {
    zbar.setModuleArgs({
      locateFile: (filename) => (filename === 'zbar.wasm' ? wasmUrl : filename),
    });
    scannerPromise = zbar.getDefaultScanner().then((scanner) => {
      scanner.setConfig(zbar.ZBarSymbolType.ZBAR_NONE, zbar.ZBarConfigType.ZBAR_CFG_ENABLE, 0);
      scanner.setConfig(zbar.ZBarSymbolType.ZBAR_QRCODE, zbar.ZBarConfigType.ZBAR_CFG_ENABLE, 1);
      return scanner;
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

const upscale = (luminance, width, height) => {
  const scale = Math.min(2, Math.sqrt(8_000_000 / luminance.length));
  if (scale <= 1.05) return { luminance, width, height };
  const scaledWidth = Math.round(width * scale);
  const scaledHeight = Math.round(height * scale);
  const resized = new Uint8Array(scaledWidth * scaledHeight);
  for (let y = 0; y < scaledHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < scaledWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor(x / scale));
      resized[y * scaledWidth + x] = luminance[sourceY * width + sourceX];
    }
  }
  return { luminance: resized, width: scaledWidth, height: scaledHeight };
};

const scanPixels = async (rgba, width, height, variant) => {
  const stageStart = performance.now();
  const originalWidth = width;
  const originalHeight = height;
  let luminance = grayscale(rgba);
  if (variant === 'flat' || variant === 'upscale' || variant === 'adaptive') {
    luminance = normalizeFlatField(luminance, width, height);
  }
  if (variant === 'adaptive') luminance = adaptiveContrast(luminance);
  if (variant === 'upscale') {
    const enlarged = upscale(luminance, width, height);
    luminance = enlarged.luminance;
    width = enlarged.width;
    height = enlarged.height;
  }
  const scanner = await getScanner();
  const decodeStart = performance.now();
  const symbols = await zbar.scanGrayBuffer(luminance.buffer, width, height, scanner);
  if (DEBUG_QR) {
    console.debug(`[qr-worker] ${variant} preprocess=${Math.round(decodeStart - stageStart)}ms decode=${Math.round(performance.now() - decodeStart)}ms`);
  }
  return symbols.map((symbol) => ({
    rawValue: symbol.decode('utf-8').trim(),
    points: symbol.points.map((point) => ({
      x: point.x * originalWidth / width,
      y: point.y * originalHeight / height,
    })),
  })).filter((symbol) => symbol.rawValue);
};

self.onmessage = async ({ data }) => {
  const { id, bitmap, pixels, width, height, variant } = data;
  let canvas;
  try {
    let rgba = pixels;
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
      rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      imageWidth = canvas.width;
      imageHeight = canvas.height;
    }
    const detections = await scanPixels(
      rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba),
      imageWidth,
      imageHeight,
      variant
    );
    self.postMessage({ id, detections });
  } catch (error) {
    self.postMessage({ id, error: error.message || 'QR worker scan failed' });
  } finally {
    bitmap?.close();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
};
