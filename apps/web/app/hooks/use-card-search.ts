'use client';

import type { CardIdentity, CardVariant, Language } from '@pokecard/shared';
import { useMemo, useState } from 'react';

type UseCardSearchParams = {
  apiBase: string;
};

export type CardSearchInput = {
  query: string;
  setCode: string;
  collectorNumber: string;
  variant: CardVariant | '';
  language: Language;
};

export function useCardSearch({ apiBase }: UseCardSearchParams) {
  const [manualResults, setManualResults] = useState<CardIdentity[]>([]);
  const [manualSelected, setManualSelected] = useState<CardIdentity | null>(null);
  const [showAllManualResults, setShowAllManualResults] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayedManualResults = useMemo(
    () => (showAllManualResults ? manualResults : manualResults.slice(0, 5)),
    [manualResults, showAllManualResults],
  );

  async function searchCards(input: CardSearchInput) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (input.query.trim()) params.set('q', input.query.trim());
      params.set('language', input.language);
      if (input.setCode.trim()) params.set('setCode', input.setCode.trim());
      if (input.collectorNumber.trim()) params.set('number', input.collectorNumber.trim());
      if (input.variant) params.set('variant', input.variant);
      params.set('limit', '20');

      const res = await fetch(`${apiBase}/cards/search?${params.toString()}`);
      if (!res.ok) throw new Error(`search failed: ${res.status}`);

      const data = (await res.json()) as { items: CardIdentity[] };
      setManualResults(data.items ?? []);
      setShowAllManualResults(false);
      setManualSelected(null);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  function clearError() {
    setError(null);
  }

  return {
    manualResults,
    displayedManualResults,
    manualSelected,
    showAllManualResults,
    loading,
    error,
    searchCards,
    setManualSelected,
    setShowAllManualResults,
    clearError,
  };
}
