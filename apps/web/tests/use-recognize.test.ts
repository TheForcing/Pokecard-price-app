import type { RecognizeResponse } from '@pokecard/shared';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRecognize } from '../app/hooks/use-recognize';

describe('useRecognize', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores recognition result and best candidate', async () => {
    const payload: RecognizeResponse = {
      best: { cardId: 'c1', name: 'Pikachu', confidence: 0.9, language: 'EN' },
      candidates: [
        { cardId: 'c1', name: 'Pikachu', confidence: 0.9, language: 'EN' },
        { cardId: 'c2', name: 'Raichu', confidence: 0.4, language: 'EN' },
      ],
      needsUserPick: false,
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => payload,
    } as Response);

    const { result } = renderHook(() => useRecognize({ apiBase: 'http://localhost:4000' }));

    await act(async () => {
      await result.current.recognize('data:image/jpeg;base64,a', 'US', 'EN');
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.candidates).toHaveLength(2);
      expect(result.current.selected?.cardId).toBe('c1');
      expect(result.current.isLowConfidence).toBe(false);
    });
  });

  it('sets error when recognize request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500 } as Response);

    const { result } = renderHook(() => useRecognize({ apiBase: 'http://localhost:4000' }));

    await act(async () => {
      await result.current.recognize('data:image/jpeg;base64,a', 'US', 'EN');
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toContain('recognize failed: 500');
    });
  });
});
