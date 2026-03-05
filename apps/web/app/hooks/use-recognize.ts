'use client';

import type { CandidateCard, Language, Market, RecognizeResponse } from '@pokecard/shared';
import { useMemo, useState } from 'react';
import { fetchWithCustomTimeout } from './fetch-with-timeout';

const DEFAULT_RECOGNIZE_TIMEOUT_MS = 240000;

function getRecognizeTimeoutMs(): number {
  const rawValue = process.env.NEXT_PUBLIC_RECOGNIZE_TIMEOUT_MS;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_RECOGNIZE_TIMEOUT_MS;
  }
  return Math.floor(parsed);
}

type UseRecognizeParams = {
  apiBase: string;
  lowConfidenceThreshold?: number;
};

export function useRecognize({ apiBase, lowConfidenceThreshold = 0.5 }: UseRecognizeParams) {
  const recognizeTimeoutMs = getRecognizeTimeoutMs();
  const [recognizeRes, setRecognizeRes] = useState<RecognizeResponse | null>(null);
  const [selected, setSelected] = useState<CandidateCard | null>(null);
  const [lowConfidence, setLowConfidence] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(() => recognizeRes?.candidates ?? [], [recognizeRes]);
  const topCandidates = useMemo(() => candidates.slice(0, 3), [candidates]);
  const isLowConfidence =
    (selected?.confidence != null && selected.confidence < lowConfidenceThreshold) || lowConfidence;

  async function recognize(preview: string, market: Market, language: Language) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithCustomTimeout(`${apiBase}/recognize`, recognizeTimeoutMs, {
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
        : !!bestCandidate && bestCandidate.confidence < lowConfidenceThreshold;
      setLowConfidence(low);
      setSelected(low ? null : bestCandidate);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  function selectCandidate(candidate: CandidateCard) {
    setSelected(candidate);
  }

  function reset() {
    setRecognizeRes(null);
    setSelected(null);
    setLowConfidence(false);
  }

  function clearError() {
    setError(null);
  }

  return {
    recognizeRes,
    selected,
    lowConfidence,
    loading,
    error,
    candidates,
    topCandidates,
    isLowConfidence,
    recognize,
    selectCandidate,
    reset,
    clearError,
  };
}
