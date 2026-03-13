import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCardSearch } from '../app/hooks/use-card-search';

describe('useCardSearch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('searches cards with query params and stores results', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            id: 'id_1',
            name: 'Pikachu',
            language: 'EN',
            setCode: 'sv1',
            collectorNumber: '001',
            variant: 'NORMAL',
          },
        ],
      }),
    } as Response);

    const { result } = renderHook(() => useCardSearch({ apiBase: 'http://localhost:4000' }));

    await act(async () => {
      await result.current.searchCards({
        query: 'Pikachu',
        language: 'EN',
        setCode: 'sv1',
        collectorNumber: '001',
        variant: 'NORMAL',
      });
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.manualResults).toHaveLength(1);
      expect(result.current.manualResults[0].id).toBe('id_1');
    });

    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain('/cards/search?');
    expect(calledUrl).toContain('q=Pikachu');
    expect(calledUrl).toContain('language=EN');
    expect(calledUrl).toContain('setCode=sv1');
    expect(calledUrl).toContain('number=001');
    expect(calledUrl).toContain('variant=NORMAL');
    expect(calledUrl).toContain('limit=20');
  });

  it('sets error when card search request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 503 } as Response);

    const { result } = renderHook(() => useCardSearch({ apiBase: 'http://localhost:4000' }));

    await act(async () => {
      await result.current.searchCards({
        query: 'Pikachu',
        language: 'EN',
        setCode: '',
        collectorNumber: '',
        variant: '',
      });
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toContain('search failed: 503');
    });
  });

  it('fetches name suggestions for autocomplete', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            id: 'id_suggestion_1',
            name: 'Pikachu',
            language: 'EN',
            setCode: 'sv1',
            collectorNumber: '001',
            variant: 'NORMAL',
          },
        ],
      }),
    } as Response);

    const { result } = renderHook(() => useCardSearch({ apiBase: 'http://localhost:4000' }));

    await act(async () => {
      await result.current.fetchSuggestions('Pika', 'EN');
    });

    await waitFor(() => {
      expect(result.current.suggestionsLoading).toBe(false);
      expect(result.current.suggestions).toHaveLength(1);
      expect(result.current.suggestions[0].name).toBe('Pikachu');
    });

    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain('/cards/search?');
    expect(calledUrl).toContain('q=Pika');
    expect(calledUrl).toContain('language=EN');
    expect(calledUrl).toContain('limit=5');
  });

  it('clears suggestions when query is too short', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(() => useCardSearch({ apiBase: 'http://localhost:4000' }));

    await act(async () => {
      await result.current.fetchSuggestions('P', 'EN');
    });

    expect(result.current.suggestions).toEqual([]);
    expect(result.current.suggestionsLoading).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
