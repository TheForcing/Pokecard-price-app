'use client';

import type { Language, Market } from '@pokecard/shared';
import { useEffect, useRef, useState } from 'react';

const MIN_IMAGE_EDGE = 800;
const MAX_CROP_PREVIEW = 640;

type ImageMeta = {
  width: number;
  height: number;
};

type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type UploadCameraCropSectionProps = {
  market: Market;
  language: Language;
  loading: boolean;
  onMarketChange: (market: Market) => void;
  onLanguageChange: (language: Language) => void;
  onRecognize: (preview: string) => Promise<void> | void;
  onResetFlow: () => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getLuminance(r: number, g: number, b: number) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
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

async function evaluateImageQuality(dataUrl: string) {
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

async function autoCropImage(dataUrl: string): Promise<{ dataUrl: string; rect: CropRect } | null> {
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

export function UploadCameraCropSection({
  market,
  language,
  loading,
  onMarketChange,
  onLanguageChange,
  onRecognize,
  onResetFlow,
}: UploadCameraCropSectionProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [original, setOriginal] = useState<string | null>(null);
  const [imageMeta, setImageMeta] = useState<ImageMeta | null>(null);
  const [qualityWarning, setQualityWarning] = useState<string | null>(null);
  const [cropMode, setCropMode] = useState(false);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [cropScale, setCropScale] = useState<{
    scale: number;
    width: number;
    height: number;
  } | null>(null);
  const [cropMessage, setCropMessage] = useState<string | null>(null);
  const [autoCropFailed, setAutoCropFailed] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cropImageRef = useRef<HTMLImageElement | null>(null);
  const isDraggingCrop = useRef(false);
  const cropStart = useRef<{ x: number; y: number } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    async function startCamera() {
      setCameraError(null);
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('camera not supported in this browser');
        setCameraActive(false);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'failed to access camera';
        setCameraError(message);
        setCameraActive(false);
      }
    }

    function stopCamera() {
      const stream = streamRef.current;
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    }

    if (cameraActive) {
      startCamera();
    } else {
      stopCamera();
    }

    return () => stopCamera();
  }, [cameraActive]);

  useEffect(() => {
    if (!cropMode || !preview) return;
    let cancelled = false;
    loadImage(preview)
      .then((img) => {
        if (cancelled) return;
        cropImageRef.current = img;
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        const scale = Math.min(1, MAX_CROP_PREVIEW / Math.max(width, height));
        const scaledWidth = Math.max(1, Math.round(width * scale));
        const scaledHeight = Math.max(1, Math.round(height * scale));
        setCropScale({ scale, width: scaledWidth, height: scaledHeight });
        const canvas = cropCanvasRef.current;
        if (!canvas) return;
        canvas.width = scaledWidth;
        canvas.height = scaledHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, scaledWidth, scaledHeight);
        ctx.drawImage(img, 0, 0, scaledWidth, scaledHeight);
      })
      .catch(() => {
        if (!cancelled) setCropMessage('failed to load image for cropping');
      });
    return () => {
      cancelled = true;
    };
  }, [cropMode, preview]);

  useEffect(() => {
    if (!cropMode || !cropScale || !cropImageRef.current || !cropCanvasRef.current) return;
    const canvas = cropCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, cropScale.width, cropScale.height);
    ctx.drawImage(cropImageRef.current, 0, 0, cropScale.width, cropScale.height);
    if (cropRect) {
      ctx.strokeStyle = 'rgba(255, 140, 0, 0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
      ctx.fillStyle = 'rgba(255, 140, 0, 0.15)';
      ctx.fillRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
    }
  }, [cropMode, cropRect, cropScale]);

  async function onPick(file: File | null) {
    onResetFlow();
    setCropMode(false);
    setCropRect(null);
    setCropScale(null);
    setCropMessage(null);
    setAutoCropFailed(false);
    setQualityWarning(null);
    setImageMeta(null);
    if (cameraActive) setCameraActive(false);
    if (!file) {
      setPreview(null);
      setOriginal(null);
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    setPreview(dataUrl);
    setOriginal(dataUrl);
    const quality = await evaluateImageQuality(dataUrl);
    setImageMeta(quality.meta);
    setQualityWarning(quality.warning);
  }

  async function captureFromCamera() {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);

    onResetFlow();
    setPreview(dataUrl);
    setOriginal(dataUrl);
    setCropMode(false);
    setCropRect(null);
    setCropScale(null);
    setCropMessage(null);
    setAutoCropFailed(false);
    const quality = await evaluateImageQuality(dataUrl);
    setImageMeta(quality.meta);
    setQualityWarning(quality.warning);
  }

  function onCropPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!cropScale || !cropCanvasRef.current) return;
    const rect = cropCanvasRef.current.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left, 0, cropScale.width);
    const y = clamp(event.clientY - rect.top, 0, cropScale.height);
    isDraggingCrop.current = true;
    cropStart.current = { x, y };
    setCropRect({ x, y, width: 0, height: 0 });
  }

  function onCropPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDraggingCrop.current || !cropStart.current || !cropScale || !cropCanvasRef.current)
      return;
    const rect = cropCanvasRef.current.getBoundingClientRect();
    const currentX = clamp(event.clientX - rect.left, 0, cropScale.width);
    const currentY = clamp(event.clientY - rect.top, 0, cropScale.height);
    const start = cropStart.current;
    const x = Math.min(start.x, currentX);
    const y = Math.min(start.y, currentY);
    const width = Math.abs(currentX - start.x);
    const height = Math.abs(currentY - start.y);
    setCropRect({ x, y, width, height });
  }

  function onCropPointerUp() {
    isDraggingCrop.current = false;
    cropStart.current = null;
  }

  function applyManualCrop() {
    if (!cropRect || !cropScale || !cropImageRef.current) {
      setCropMessage('draw a crop box first');
      return;
    }
    const scaleBack = 1 / cropScale.scale;
    const rect = {
      x: Math.round(cropRect.x * scaleBack),
      y: Math.round(cropRect.y * scaleBack),
      width: Math.round(cropRect.width * scaleBack),
      height: Math.round(cropRect.height * scaleBack),
    };
    if (rect.width < 10 || rect.height < 10) {
      setCropMessage('crop area is too small');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(
      cropImageRef.current,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      rect.width,
      rect.height,
    );
    onResetFlow();
    setPreview(canvas.toDataURL('image/jpeg', 0.92));
    setCropMode(false);
    setCropRect(null);
    setCropMessage('crop applied');
  }

  async function applyAutoCrop() {
    if (!original) return;
    setCropMessage(null);
    const result = await autoCropImage(original);
    if (!result) {
      setAutoCropFailed(true);
      setCropMode(true);
      setCropMessage('auto crop failed. please crop manually.');
      return;
    }
    onResetFlow();
    setAutoCropFailed(false);
    setPreview(result.dataUrl);
    setCropMode(false);
    setCropRect(null);
    setCropMessage('auto crop applied');
  }

  function resetToOriginal() {
    if (!original) return;
    onResetFlow();
    setPreview(original);
    setCropMode(false);
    setCropRect(null);
    setCropMessage(null);
  }

  return (
    <>
      <section style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 16 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          Market
          <select value={market} onChange={(e) => onMarketChange(e.target.value as Market)}>
            <option value="US">US</option>
            <option value="JP">JP</option>
            <option value="KR">KR</option>
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          Card Language
          <select value={language} onChange={(e) => onLanguageChange(e.target.value as Language)}>
            <option value="EN">EN</option>
            <option value="JA">JA</option>
            <option value="KO">KO</option>
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          Image
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          />
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          Crop
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={!preview}
              onClick={applyAutoCrop}
              style={{ height: 40 }}
            >
              Auto Crop
            </button>
            <button
              type="button"
              disabled={!preview}
              onClick={() => {
                setCropMode(true);
                setCropRect(null);
                setCropMessage(null);
              }}
              style={{ height: 40 }}
            >
              Manual Crop
            </button>
            <button
              type="button"
              disabled={!preview || !original}
              onClick={resetToOriginal}
              style={{ height: 40 }}
            >
              Reset
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          Camera
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setCameraActive((current) => !current)}
              style={{ height: 40 }}
              type="button"
            >
              {cameraActive ? 'Stop Camera' : 'Use Camera'}
            </button>
            <button
              onClick={captureFromCamera}
              disabled={!cameraActive}
              style={{ height: 40 }}
              type="button"
            >
              Capture
            </button>
          </div>
          {cameraError && <div style={{ color: 'crimson', fontSize: 12 }}>{cameraError}</div>}
        </div>

        <button
          onClick={() => {
            if (preview) onRecognize(preview);
          }}
          disabled={!preview || loading}
          style={{ height: 40, alignSelf: 'end' }}
        >
          {loading ? 'Working…' : 'Recognize'}
        </button>
      </section>

      {qualityWarning && (
        <p style={{ marginTop: 8, color: '#a04500', fontSize: 12 }}>
          Quality check: {qualityWarning}
        </p>
      )}
      {imageMeta && (
        <p style={{ marginTop: 4, color: '#555', fontSize: 12 }}>
          Image size: {imageMeta.width} x {imageMeta.height}
        </p>
      )}

      {cameraActive && (
        <section style={{ marginTop: 12 }}>
          <video
            ref={videoRef}
            playsInline
            muted
            style={{ width: '100%', maxWidth: 520, borderRadius: 12, border: '1px solid #ddd' }}
          />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </section>
      )}

      {cropMode && preview && (
        <section style={{ marginTop: 12, border: '1px solid #ddd', borderRadius: 12, padding: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Manual Crop</h2>
          <p style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
            Drag to select the card area. Then apply crop.
          </p>
          <canvas
            ref={cropCanvasRef}
            onPointerDown={onCropPointerDown}
            onPointerMove={onCropPointerMove}
            onPointerUp={onCropPointerUp}
            onPointerLeave={onCropPointerUp}
            style={{
              width: '100%',
              maxWidth: MAX_CROP_PREVIEW,
              borderRadius: 10,
              border: '1px solid #eee',
              touchAction: 'none',
              marginTop: 8,
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" onClick={applyManualCrop}>
              Apply Crop
            </button>
            <button
              type="button"
              onClick={() => {
                setCropMode(false);
                setCropRect(null);
                setCropMessage(null);
              }}
            >
              Cancel
            </button>
          </div>
          {cropMessage && <div style={{ marginTop: 6, fontSize: 12 }}>{cropMessage}</div>}
          {autoCropFailed && (
            <div style={{ marginTop: 6, color: '#a04500', fontSize: 12 }}>
              Auto crop failed. Manual crop recommended.
            </div>
          )}
        </section>
      )}

      <section style={{ marginTop: 16, border: '1px solid #ddd', borderRadius: 12, padding: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Preview</h2>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="preview"
            style={{ width: '100%', marginTop: 10, borderRadius: 10 }}
          />
        ) : (
          <p style={{ opacity: 0.7, marginTop: 10 }}>Pick an image to preview.</p>
        )}
      </section>
    </>
  );
}
