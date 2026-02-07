'use client';

import type {
  CandidateCard,
  CardIdentity,
  RecognizeResponse,
  PriceResponse,
  Market,
  Language,
  CardVariant,
} from '@pokecard/shared';
import { useEffect, useMemo, useRef, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000';
const LOW_CONFIDENCE_THRESHOLD = 0.5;
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getLuminance(r: number, g: number, b: number) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
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

export default function HomePage() {
  const [file, setFile] = useState<File | null>(null);
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
  const [market, setMarket] = useState<Market>('US');
  const [language, setLanguage] = useState<Language>('EN');
  const [recognizeRes, setRecognizeRes] = useState<RecognizeResponse | null>(null);
  const [selected, setSelected] = useState<CandidateCard | null>(null);
  const [price, setPrice] = useState<PriceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lowConfidence, setLowConfidence] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [manualSetCode, setManualSetCode] = useState('');
  const [manualNumber, setManualNumber] = useState('');
  const [manualVariant, setManualVariant] = useState<CardVariant | ''>('');
  const [manualResults, setManualResults] = useState<CardIdentity[]>([]);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualSelected, setManualSelected] = useState<CardIdentity | null>(null);
  const [showAllCandidates, setShowAllCandidates] = useState(false);
  const [showAllManualResults, setShowAllManualResults] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cropImageRef = useRef<HTMLImageElement | null>(null);
  const isDraggingCrop = useRef(false);
  const cropStart = useRef<{ x: number; y: number } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const candidates = useMemo(() => recognizeRes?.candidates ?? [], [recognizeRes]);
  const displayedCandidates = useMemo(
    () => (showAllCandidates ? candidates : candidates.slice(0, 5)),
    [candidates, showAllCandidates],
  );
  const displayedManualResults = useMemo(
    () => (showAllManualResults ? manualResults : manualResults.slice(0, 5)),
    [manualResults, showAllManualResults],
  );
  const isLowConfidence =
    (selected?.confidence != null && selected.confidence < LOW_CONFIDENCE_THRESHOLD) ||
    lowConfidence;

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
      } catch (e: any) {
        setCameraError(e?.message ?? 'failed to access camera');
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

  async function onPick(f: File | null) {
    setError(null);
    setRecognizeRes(null);
    setSelected(null);
    setPrice(null);
    setLowConfidence(false);
    setShowAllCandidates(false);
    setFile(f);
    if (cameraActive) setCameraActive(false);
    setCropMode(false);
    setCropRect(null);
    setCropScale(null);
    setCropMessage(null);
    setAutoCropFailed(false);
    setQualityWarning(null);
    setImageMeta(null);
    if (!f) {
      setPreview(null);
      setOriginal(null);
      return;
    }
    const dataUrl = await fileToDataUrl(f);
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
    setFile(null);
    setPreview(dataUrl);
    setOriginal(dataUrl);
    setRecognizeRes(null);
    setSelected(null);
    setPrice(null);
    setLowConfidence(false);
    setCropMode(false);
    setCropRect(null);
    setCropScale(null);
    setCropMessage(null);
    setAutoCropFailed(false);
    const quality = await evaluateImageQuality(dataUrl);
    setImageMeta(quality.meta);
    setQualityWarning(quality.warning);
  }

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
    const cropped = canvas.toDataURL('image/jpeg', 0.92);
    setPreview(cropped);
    setRecognizeRes(null);
    setSelected(null);
    setPrice(null);
    setLowConfidence(false);
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
    setAutoCropFailed(false);
    setPreview(result.dataUrl);
    setRecognizeRes(null);
    setSelected(null);
    setPrice(null);
    setLowConfidence(false);
    setCropMode(false);
    setCropRect(null);
    setCropMessage('auto crop applied');
  }

  function resetToOriginal() {
    if (!original) return;
    setPreview(original);
    setCropMode(false);
    setCropRect(null);
    setCropMessage(null);
  }

  async function recognize() {
    if (!preview) return;
    setLoading(true);
    setError(null);
    setPrice(null);
    setShowAllCandidates(false);
    try {
      const res = await fetch(`${API_BASE}/recognize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: preview, hint: { market, language } }),
      });
      if (!res.ok) throw new Error(`recognize failed: ${res.status}`);
      const data = (await res.json()) as RecognizeResponse;
      setRecognizeRes(data);
      const bestCandidate = data.best ?? data.candidates[0] ?? null;
      const low = data.needsUserPick
        ? true
        : !!bestCandidate && bestCandidate.confidence < LOW_CONFIDENCE_THRESHOLD;
      setLowConfidence(low);
      setSelected(low ? null : bestCandidate);
    } catch (e: any) {
      setError(e?.message ?? 'unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function fetchPrice(cardId: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/cards/${encodeURIComponent(cardId)}/prices?market=${market}`,
      );
      if (!res.ok) throw new Error(`price failed: ${res.status}`);
      const data = (await res.json()) as PriceResponse;
      setPrice(data);
    } catch (e: any) {
      setError(e?.message ?? 'unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function searchCards() {
    setManualLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (manualQuery.trim()) params.set('q', manualQuery.trim());
      if (language) params.set('language', language);
      if (manualSetCode.trim()) params.set('setCode', manualSetCode.trim());
      if (manualNumber.trim()) params.set('number', manualNumber.trim());
      if (manualVariant) params.set('variant', manualVariant);
      params.set('limit', '20');
      const res = await fetch(`${API_BASE}/cards/search?${params.toString()}`);
      if (!res.ok) throw new Error(`search failed: ${res.status}`);
      const data = (await res.json()) as { items: CardIdentity[] };
      setManualResults(data.items ?? []);
      setShowAllManualResults(false);
      setManualSelected(null);
    } catch (e: any) {
      setError(e?.message ?? 'unknown error');
    } finally {
      setManualLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 28, margin: 0 }}>PokéCard Price Finder</h1>
      <p style={{ marginTop: 8, opacity: 0.8 }}>
        Upload a Pokémon card photo → recognize (stub) → show low/high price (stub).
      </p>

      <section style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 16 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          Market
          <select value={market} onChange={(e) => setMarket(e.target.value as Market)}>
            <option value="US">US</option>
            <option value="JP">JP</option>
            <option value="KR">KR</option>
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          Card Language
          <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
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
          onClick={recognize}
          disabled={!preview || loading}
          style={{ height: 40, alignSelf: 'end' }}
        >
          {loading ? 'Working…' : 'Recognize'}
        </button>
      </section>

      {error && <p style={{ marginTop: 12, color: 'crimson' }}>Error: {error}</p>}

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

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <div style={{ border: '1px solid #ddd', borderRadius: 12, padding: 12 }}>
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
        </div>

        <div style={{ border: '1px solid #ddd', borderRadius: 12, padding: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Candidates</h2>
          {isLowConfidence && (
            <p style={{ marginTop: 8, color: '#a04500', fontSize: 12 }}>
              Low confidence. Please verify the candidate.
            </p>
          )}
          {candidates.length === 0 ? (
            <p style={{ opacity: 0.7, marginTop: 10 }}>Run recognize to see candidates.</p>
          ) : (
            <>
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  marginTop: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {displayedCandidates.map((c) => (
                  <li
                    key={c.cardId}
                    style={{
                      border: '1px solid #eee',
                      borderRadius: 10,
                      padding: 10,
                      background: selected?.cardId === c.cardId ? '#f7f7ff' : 'white',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <div
                          style={{
                            width: 64,
                            height: 88,
                            borderRadius: 8,
                            border: '1px solid #eee',
                            background: '#fafafa',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden',
                            color: '#999',
                            fontSize: 11,
                          }}
                        >
                          {c.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={c.imageUrl}
                              alt={c.name}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          ) : (
                            'No image'
                          )}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600 }}>{c.name}</div>
                          <div style={{ opacity: 0.75, fontSize: 12 }}>
                            {c.setCode ?? '-'} / {c.number ?? '-'} / {c.language ?? '-'}
                          </div>
                          <div style={{ opacity: 0.75, fontSize: 12 }}>
                            confidence: {c.confidence.toFixed(2)}
                          </div>
                        </div>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                          alignItems: 'end',
                        }}
                      >
                        <button
                          onClick={() => {
                            setSelected(c);
                            setPrice(null);
                          }}
                          style={{ height: 30 }}
                        >
                          Select
                        </button>
                        <button
                          onClick={() => fetchPrice(c.identityId ?? c.cardId)}
                          style={{ height: 30 }}
                        >
                          Get Price
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              {candidates.length > 5 && (
                <button
                  type="button"
                  onClick={() => setShowAllCandidates((current) => !current)}
                  style={{ marginTop: 8, height: 32 }}
                >
                  {showAllCandidates ? 'Show top 5' : 'Show all'}
                </button>
              )}
            </>
          )}
        </div>
      </section>

      <section style={{ marginTop: 16, border: '1px solid #ddd', borderRadius: 12, padding: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Manual Search</h2>
        <p style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
          Use this when OCR is uncertain. Search by name + set/number + variant.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            Name
            <input
              value={manualQuery}
              onChange={(e) => setManualQuery(e.target.value)}
              placeholder="Pikachu"
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            Set Code
            <input
              value={manualSetCode}
              onChange={(e) => setManualSetCode(e.target.value)}
              placeholder="swsh4"
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            Number
            <input
              value={manualNumber}
              onChange={(e) => setManualNumber(e.target.value)}
              placeholder="043"
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            Variant
            <select
              value={manualVariant}
              onChange={(e) => setManualVariant(e.target.value as CardVariant | '')}
            >
              <option value="">Any</option>
              <option value="NORMAL">Normal</option>
              <option value="HOLOFOIL">Holo</option>
              <option value="REVERSE_HOLOFOIL">Reverse Holo</option>
              <option value="FULL_ART">Full Art</option>
              <option value="ALT_ART">Alt Art</option>
              <option value="SECRET">Secret</option>
              <option value="PROMO">Promo</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <button type="button" onClick={searchCards} style={{ height: 40, alignSelf: 'end' }}>
            {manualLoading ? 'Searching…' : 'Search'}
          </button>
        </div>

        {manualResults.length === 0 ? (
          <p style={{ marginTop: 10, opacity: 0.7 }}>No manual results yet.</p>
        ) : (
          <>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                marginTop: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {displayedManualResults.map((card) => (
                <li
                  key={card.id}
                  style={{
                    border: '1px solid #eee',
                    borderRadius: 10,
                    padding: 10,
                    background: manualSelected?.id === card.id ? '#f7f7ff' : 'white',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <div
                        style={{
                          width: 64,
                          height: 88,
                          borderRadius: 8,
                          border: '1px solid #eee',
                          background: '#fafafa',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          overflow: 'hidden',
                          color: '#999',
                          fontSize: 11,
                        }}
                      >
                        {card.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={card.imageUrl}
                            alt={card.name}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          'No image'
                        )}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600 }}>{card.name}</div>
                        <div style={{ opacity: 0.75, fontSize: 12 }}>
                          {card.language} / {card.setCode} / {card.collectorNumber} / {card.variant}
                        </div>
                        {card.setName && (
                          <div style={{ opacity: 0.7, fontSize: 12 }}>{card.setName}</div>
                        )}
                      </div>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        alignItems: 'end',
                      }}
                    >
                      <button
                        onClick={() => {
                          setManualSelected(card);
                          setPrice(null);
                        }}
                        style={{ height: 30 }}
                      >
                        Select
                      </button>
                      <button onClick={() => fetchPrice(card.id)} style={{ height: 30 }}>
                        Get Price
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {manualResults.length > 5 && (
              <button
                type="button"
                onClick={() => setShowAllManualResults((current) => !current)}
                style={{ marginTop: 8, height: 32 }}
              >
                {showAllManualResults ? 'Show top 5' : 'Show all'}
              </button>
            )}
          </>
        )}
      </section>

      <section style={{ marginTop: 16, border: '1px solid #ddd', borderRadius: 12, padding: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Price</h2>
        {!price ? (
          <p style={{ opacity: 0.7, marginTop: 10 }}>Select a candidate and click Get Price.</p>
        ) : (
          <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ border: '1px solid #eee', borderRadius: 10, padding: 10 }}>
              <div style={{ opacity: 0.75, fontSize: 12 }}>Low ({price.source})</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>
                {price.low == null ? '-' : `${price.currency} ${price.low}`}
              </div>
            </div>
            <div style={{ border: '1px solid #eee', borderRadius: 10, padding: 10 }}>
              <div style={{ opacity: 0.75, fontSize: 12 }}>High ({price.source})</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>
                {price.high == null ? '-' : `${price.currency} ${price.high}`}
              </div>
            </div>
            <div style={{ gridColumn: '1 / -1', opacity: 0.75, fontSize: 12 }}>
              fetchedAt: {price.fetchedAt}
            </div>
          </div>
        )}
      </section>

      <footer style={{ marginTop: 24, opacity: 0.7, fontSize: 12 }}>
        Tip: Replace API stubs with real OCR + embedding search + TCGplayer integration.
      </footer>
    </main>
  );
}
