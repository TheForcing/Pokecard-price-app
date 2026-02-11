import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePrice } from '../app/hooks/use-price';

describe('usePrice', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches price and stores response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        cardId: 'c1',
        market: 'US',
        currency: 'USD',
        low: 10,
        high: 20,
        source: 'TCGPLAYER',
        fetchedAt: '2026-01-01T00:00:00.000Z',
      }),
    } as Response);

    const { result } = renderHook(() => usePrice({ apiBase: 'http://localhost:4000' }));

    await act(async () => {
      await result.current.fetchPrice('c1', 'US');
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.price?.cardId).toBe('c1');
      expect(result.current.price?.low).toBe(10);
    });
  });

  it('sets error when price request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404 } as Response);

    const { result } = renderHook(() => usePrice({ apiBase: 'http://localhost:4000' }));

    await act(async () => {
      await result.current.fetchPrice('missing', 'US');
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toContain('price failed: 404');
    });
  });
});
