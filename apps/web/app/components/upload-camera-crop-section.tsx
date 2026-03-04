'use client';

import type { Language, Market } from '@pokecard/shared';
import { useEffect, useRef, useState } from 'react';
import {
  MAX_CROP_PREVIEW,
  autoCropImage,
  clamp,
  evaluateImageQuality,
  fileToDataUrl,
  loadImage,
  type CropRect,
  type ImageMeta,
} from '../utils/image-preprocess';

type UploadCameraCropSectionProps = {
  market: Market;
  language: Language;
  loading: boolean;
  onMarketChange: (market: Market) => void;
  onLanguageChange: (language: Language) => void;
  onRecognize: (preview: string) => Promise<void> | void;
  onResetFlow: () => void;
};

export function UploadCameraCropSection({
  market,
  language,
  loading,
  onMarketChange,
  onLanguageChange,
  onRecognize,
  onResetFlow,
}: UploadCameraCropSectionProps) {
  const marketSelectId = 'market-select';
  const languageSelectId = 'language-select';
  const imageInputId = 'image-input';
  const cameraErrorId = 'camera-error';
  const qualityWarningId = 'quality-warning';
  const cropMessageId = 'crop-message';

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isDraggingCrop = useRef(false);
  const cropStart = useRef<{ x: number; y: number } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [selectedFileName, setSelectedFileName] = useState('');

  const canUseDirectCamera =
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    !!navigator.mediaDevices?.getUserMedia;

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
      setSelectedFileName('');
      return;
    }
    setSelectedFileName(file.name);
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
    setSelectedFileName('camera-capture.jpg');
    setCropMode(false);
    setCropRect(null);
    setCropScale(null);
    setCropMessage(null);
    setAutoCropFailed(false);
    const quality = await evaluateImageQuality(dataUrl);
    setImageMeta(quality.meta);
    setQualityWarning(quality.warning);
  }

  function handleToggleCamera() {
    if (cameraActive) {
      setCameraActive(false);
      return;
    }

    if (!canUseDirectCamera) {
      setCameraError('Direct camera requires HTTPS on mobile Chrome. Use "Choose Image" to open camera.');
      fileInputRef.current?.click();
      return;
    }

    setCameraError(null);
    setCameraActive(true);
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
      <section className="panel" style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <label
          htmlFor={marketSelectId}
          style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          Market
          <select
            id={marketSelectId}
            value={market}
            onChange={(e) => onMarketChange(e.target.value as Market)}
          >
            <option value="US">US</option>
            <option value="JP">JP</option>
            <option value="KR">KR</option>
          </select>
        </label>

        <label
          htmlFor={languageSelectId}
          style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          Card Language
          <select
            id={languageSelectId}
            value={language}
            onChange={(e) => onLanguageChange(e.target.value as Language)}
          >
            <option value="EN">EN</option>
            <option value="JA">JA</option>
            <option value="KO">KO</option>
          </select>
        </label>

        <label htmlFor={imageInputId} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          Image
          <div className="file-picker">
            <input
              id={imageInputId}
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              className="secondary file-picker-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              Choose Image
            </button>
            <span className={`file-picker-name ${selectedFileName ? '' : 'placeholder'}`}>
              {selectedFileName || 'No file selected'}
            </span>
          </div>
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
              onClick={handleToggleCamera}
              style={{ height: 40 }}
              type="button"
              aria-pressed={cameraActive}
              aria-describedby={cameraError ? cameraErrorId : undefined}
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
          {cameraError && (
            <div id={cameraErrorId} role="alert" style={{ color: 'crimson', fontSize: 12 }}>
              {cameraError}
            </div>
          )}
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

      {loading && (
        <p
          className="muted"
          role="status"
          aria-live="polite"
          style={{ marginTop: 8, fontSize: 12 }}
        >
          Processing image. This can take a few seconds; long requests are timed out automatically.
        </p>
      )}

      {qualityWarning && (
        <p
          id={qualityWarningId}
          className="warn-text"
          role="alert"
          style={{ marginTop: 8, fontSize: 12 }}
        >
          Quality check: {qualityWarning}
        </p>
      )}
      {imageMeta && (
        <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
          Image size: {imageMeta.width} x {imageMeta.height}
        </p>
      )}

      {cameraActive && (
        <section style={{ marginTop: 12 }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ width: '100%', maxWidth: 520, borderRadius: 12, border: '1px solid #ddd' }}
          />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </section>
      )}

      {cropMode && preview && (
        <section className="panel" style={{ marginTop: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Manual Crop</h2>
          <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
            Drag to select the card area. Then apply crop.
          </p>
          <canvas
            ref={cropCanvasRef}
            onPointerDown={onCropPointerDown}
            onPointerMove={onCropPointerMove}
            onPointerUp={onCropPointerUp}
            onPointerLeave={onCropPointerUp}
            aria-label="Manual crop canvas"
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
          {cropMessage && (
            <div
              id={cropMessageId}
              role="status"
              aria-live="polite"
              style={{ marginTop: 6, fontSize: 12 }}
            >
              {cropMessage}
            </div>
          )}
          {autoCropFailed && (
            <div role="alert" style={{ marginTop: 6, color: '#a04500', fontSize: 12 }}>
              Auto crop failed. Manual crop recommended.
            </div>
          )}
        </section>
      )}

      <section className="panel">
        <h2 style={{ margin: 0, fontSize: 16 }}>Preview</h2>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="preview"
            style={{ width: '100%', marginTop: 10, borderRadius: 10 }}
          />
        ) : (
          <p className="muted" style={{ marginTop: 10 }}>
            Pick an image to preview.
          </p>
        )}
      </section>
    </>
  );
}
