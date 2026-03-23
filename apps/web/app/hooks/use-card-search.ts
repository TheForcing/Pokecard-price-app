'use client';

import type { CardIdentity, CardVariant, Language } from '@pokecard/shared';
import { useCallback, useMemo, useState } from 'react';
import { fetchWithTimeout } from './fetch-with-timeout';

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
  const [suggestions, setSuggestions] = useState<CardIdentity[]>([]);
  const [manualSelected, setManualSelected] = useState<CardIdentity | null>(null);
  const [showAllManualResults, setShowAllManualResults] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayedManualResults = useMemo(
    () => (showAllManualResults ? manualResults : manualResults.slice(0, 5)),
    [manualResults, showAllManualResults],
  );

  const searchCards = useCallback(async (input: CardSearchInput) => {
    setLoading(true);
    setError(null);
    setHasSearched(true);
    try {
      const params = new URLSearchParams();
      if (input.query.trim()) params.set('q', input.query.trim());
      params.set('language', input.language);
      if (input.setCode.trim()) params.set('setCode', input.setCode.trim());
      if (input.collectorNumber.trim()) params.set('number', input.collectorNumber.trim());
      if (input.variant) params.set('variant', input.variant);
      params.set('limit', '20');

      const res = await fetchWithTimeout(`${apiBase}/cards/search?${params.toString()}`);
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
  }, [apiBase]);

  const fetchSuggestions = useCallback(async (query: string, language: Language) => {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 2) {
      setSuggestions([]);
      setSuggestionsLoading(false);
      return;
    }
    setSuggestionsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('q', trimmedQuery);
      params.set('language', language);
      params.set('limit', '5');

      const res = await fetchWithTimeout(`${apiBase}/cards/search?${params.toString()}`);
      if (!res.ok) throw new Error(`search failed: ${res.status}`);

      const data = (await res.json()) as { items: CardIdentity[] };
      setSuggestions(data.items ?? []);
    } catch {
      setSuggestions([]);
    } finally {
      setSuggestionsLoading(false);
    }
  }, [apiBase]);

  const clearSuggestions = useCallback(() => {
    setSuggestions([]);
    setSuggestionsLoading(false);
  }, []);

  const resetManualSearch = useCallback(() => {
    setManualResults([]);
    setManualSelected(null);
    setShowAllManualResults(false);
    setHasSearched(false);
    setLoading(false);
    setError(null);
  }, []);

  function clearError() {
    setError(null);
  }

  return {
    manualResults,
    displayedManualResults,
    manualSelected,
    showAllManualResults,
    hasSearched,
    loading,
    suggestions,
    suggestionsLoading,
    error,
    searchCards,
    fetchSuggestions,
    clearSuggestions,
    resetManualSearch,
    setManualSelected,
    setShowAllManualResults,
    clearError,
  };
}
