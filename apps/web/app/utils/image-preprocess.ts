export const MIN_IMAGE_EDGE = 800;
export const MAX_CROP_PREVIEW = 640;

export type ImageMeta = {
  width: number;
  height: number;
};

export type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getLuminance(r: number, g: number, b: number) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function computeLaplacianVariance(data: Uint8ClampedArray, width: number, height: number) {
  const values: number[] = [];
  const idx = (x: number, y: number) => (y * width + x) * 4;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const center = idx(x, y);
      const top = idx(x, y - 1);
      const bottom = idx(x, y + 1);
      const left = idx(x - 1, y);
      const right = idx(x + 1, y);
      const value = data[top] + data[bottom] + data[left] + data[right] - data[center] * 4;
      values.push(Math.abs(value));
    }
  }
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return variance;
}

export async function evaluateImageQuality(dataUrl: string) {
  const img = await loadImage(dataUrl);
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (width < MIN_IMAGE_EDGE || height < MIN_IMAGE_EDGE) {
    return {
      meta: { width, height },
      warning: `resolution is low (${width}x${height}). retake closer for better OCR.`,
    };
  }

  const scale = Math.min(1, 320 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { meta: { width, height }, warning: null };
  }

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const variance = computeLaplacianVariance(imageData.data, canvas.width, canvas.height);
  if (variance < 60) {
    return {
      meta: { width, height },
      warning: 'image looks blurry. retake with steadier focus.',
    };
  }

  return { meta: { width, height }, warning: null };
}

export async function autoCropImage(
  dataUrl: string,
): Promise<{ dataUrl: string; rect: CropRect } | null> {
  const img = await loadImage(dataUrl);
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  const scale = Math.min(1, 360 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = 0;
  let maxY = 0;
  let found = false;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const offset = (y * canvas.width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const lum = getLuminance(r, g, b);
      const saturation = Math.max(r, g, b) - Math.min(r, g, b);
      if (lum < 245 || saturation > 12) {
        found = true;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (!found) return null;
  const boxWidth = maxX - minX;
  const boxHeight = maxY - minY;
  if (boxWidth / canvas.width < 0.5 || boxHeight / canvas.height < 0.5) {
    return null;
  }

  const scaleBack = 1 / scale;
  const padding = Math.round(12 * scaleBack);
  const rect: CropRect = {
    x: clamp(Math.round(minX * scaleBack) - padding, 0, width - 1),
    y: clamp(Math.round(minY * scaleBack) - padding, 0, height - 1),
    width: clamp(Math.round(boxWidth * scaleBack) + padding * 2, 1, width),
    height: clamp(Math.round(boxHeight * scaleBack) + padding * 2, 1, height),
  };

  const outCanvas = document.createElement('canvas');
  outCanvas.width = rect.width;
  outCanvas.height = rect.height;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) return null;

  outCtx.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  return { dataUrl: outCanvas.toDataURL('image/jpeg', 0.92), rect };
}
