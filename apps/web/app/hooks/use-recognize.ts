'use client';

import type { CandidateCard, Language, Market, RecognizeResponse } from '@pokecard/shared';
import { useMemo, useState } from 'react';
import { fetchWithTimeout } from './fetch-with-timeout';

type UseRecognizeParams = {
  apiBase: string;
  lowConfidenceThreshold?: number;
};

export function useRecognize({ apiBase, lowConfidenceThreshold = 0.5 }: UseRecognizeParams) {
  const [recognizeRes, setRecognizeRes] = useState<RecognizeResponse | null>(null);
  const [selected, setSelected] = useState<CandidateCard | null>(null);
  const [lowConfidence, setLowConfidence] = useState(false);
  const [showAllCandidates, setShowAllCandidates] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(() => recognizeRes?.candidates ?? [], [recognizeRes]);
  const displayedCandidates = useMemo(
    () => (showAllCandidates ? candidates : candidates.slice(0, 5)),
    [candidates, showAllCandidates],
  );
  const isLowConfidence =
    (selected?.confidence != null && selected.confidence < lowConfidenceThreshold) || lowConfidence;

  async function recognize(preview: string, market: Market, language: Language) {
    setLoading(true);
    setError(null);
    setShowAllCandidates(false);
    try {
      const res = await fetchWithTimeout(`${apiBase}/recognize`, {
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
    setShowAllCandidates(false);
  }

  function clearError() {
    setError(null);
  }

  return {
    recognizeRes,
    selected,
    lowConfidence,
    showAllCandidates,
    loading,
    error,
    candidates,
    displayedCandidates,
    isLowConfidence,
    recognize,
    selectCandidate,
    setShowAllCandidates,
    reset,
    clearError,
  };
}
