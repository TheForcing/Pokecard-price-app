'use client';

import type { Market, PriceResponse } from '@pokecard/shared';
import { useState } from 'react';
import { fetchWithTimeout } from './fetch-with-timeout';

type UsePriceParams = {
  apiBase: string;
};

export function usePrice({ apiBase }: UsePriceParams) {
  const [price, setPrice] = useState<PriceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchPrice(cardId: string, market: Market) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithTimeout(
        `${apiBase}/cards/${encodeURIComponent(cardId)}/prices?market=${market}`,
      );
      if (!res.ok) throw new Error(`price failed: ${res.status}`);
      const data = (await res.json()) as PriceResponse;
      setPrice(data);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  function clearPrice() {
    setPrice(null);
  }

  function clearError() {
    setError(null);
  }

  return {
    price,
    loading,
    error,
    fetchPrice,
    clearPrice,
    clearError,
  };
}
