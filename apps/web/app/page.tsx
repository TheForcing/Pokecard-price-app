'use client';

import type {
  CandidateCard,
  RecognizeResponse,
  PriceResponse,
  Market,
  Language,
} from '@pokecard/shared';
import { useEffect, useMemo, useRef, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000';

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function HomePage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [market, setMarket] = useState<Market>('US');
  const [language, setLanguage] = useState<Language>('EN');
  const [recognizeRes, setRecognizeRes] = useState<RecognizeResponse | null>(null);
  const [selected, setSelected] = useState<CandidateCard | null>(null);
  const [price, setPrice] = useState<PriceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const candidates = useMemo(() => recognizeRes?.candidates ?? [], [recognizeRes]);

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
    setFile(f);
    if (cameraActive) setCameraActive(false);
    if (!f) {
      setPreview(null);
      return;
    }
    setPreview(await fileToDataUrl(f));
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
    setRecognizeRes(null);
    setSelected(null);
    setPrice(null);
  }

  async function recognize() {
    if (!preview) return;
    setLoading(true);
    setError(null);
    setPrice(null);
    try {
      const res = await fetch(`${API_BASE}/recognize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: preview, hint: { market, language } }),
      });
      if (!res.ok) throw new Error(`recognize failed: ${res.status}`);
      const data = (await res.json()) as RecognizeResponse;
      setRecognizeRes(data);
      setSelected(data.best ?? data.candidates[0] ?? null);
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
          {candidates.length === 0 ? (
            <p style={{ opacity: 0.7, marginTop: 10 }}>Run recognize to see candidates.</p>
          ) : (
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
              {candidates.map((c) => (
                <li
                  key={c.cardId}
                  style={{
                    border: '1px solid #eee',
                    borderRadius: 10,
                    padding: 10,
                    background: selected?.cardId === c.cardId ? '#f7f7ff' : 'white',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{c.name}</div>
                      <div style={{ opacity: 0.75, fontSize: 12 }}>
                        {c.setCode ?? '-'} / {c.number ?? '-'} / {c.language ?? '-'}
                      </div>
                      <div style={{ opacity: 0.75, fontSize: 12 }}>
                        confidence: {c.confidence.toFixed(2)}
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
                      <button onClick={() => fetchPrice(c.cardId)} style={{ height: 30 }}>
                        Get Price
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
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
