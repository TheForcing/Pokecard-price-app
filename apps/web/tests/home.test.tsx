import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HomePage from '../app/page';

const WATCHLIST_STORAGE_KEY = 'pokecard:watchlist:v1';
const RECENT_STORAGE_KEY = 'pokecard:recent:v1';
const COMPARE_STORAGE_KEY = 'pokecard:compare:v1';
const SEARCH_PRESETS_STORAGE_KEY = 'pokecard:search-presets:v1';

describe('HomePage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders the title', () => {
    render(<HomePage />);

    expect(screen.getByRole('heading', { name: /price finder/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /watchlist sort/i })).toBeInTheDocument();
  });

  it('renders target price input for watchlist items', () => {
    window.localStorage.setItem(
      WATCHLIST_STORAGE_KEY,
      JSON.stringify([
        {
          lookupId: 'card-123',
          name: 'Pikachu',
          market: 'US',
          viewedAt: '2026-03-08T00:00:00.000Z',
          goalPrice: 12.5,
        },
      ]),
    );

    render(<HomePage />);

    expect(screen.getByLabelText(/target price for pikachu/i)).toBeInTheDocument();
  });

  it('renders low price change badge in watchlist and recent sections', () => {
    window.localStorage.setItem(
      WATCHLIST_STORAGE_KEY,
      JSON.stringify([
        {
          lookupId: 'card-123',
          name: 'Pikachu',
          market: 'US',
          viewedAt: '2026-03-09T00:00:00.000Z',
          lastPrice: {
            currency: 'USD',
            low: 8,
            high: 12,
            source: 'TCGPLAYER',
            fetchedAt: '2026-03-09T00:00:00.000Z',
            previousLow: 10,
          },
        },
      ]),
    );
    window.localStorage.setItem(
      RECENT_STORAGE_KEY,
      JSON.stringify([
        {
          lookupId: 'card-123',
          name: 'Pikachu',
          market: 'US',
          viewedAt: '2026-03-09T00:00:00.000Z',
          lastPrice: {
            currency: 'USD',
            low: 8,
            high: 12,
            source: 'TCGPLAYER',
            fetchedAt: '2026-03-09T00:00:00.000Z',
            previousLow: 10,
          },
        },
      ]),
    );

    render(<HomePage />);

    expect(screen.getAllByText('Low -2.00')).toHaveLength(2);
  });

  it('renders compare cards section from local storage', () => {
    window.localStorage.setItem(
      COMPARE_STORAGE_KEY,
      JSON.stringify([
        {
          lookupId: 'card-1',
          name: 'Pikachu',
          market: 'US',
          viewedAt: '2026-03-09T00:00:00.000Z',
          lastPrice: {
            currency: 'USD',
            low: 10,
            high: 14,
            source: 'TCGPLAYER',
            fetchedAt: '2026-03-09T00:00:00.000Z',
          },
        },
        {
          lookupId: 'card-2',
          name: 'Charizard',
          market: 'US',
          viewedAt: '2026-03-09T00:00:00.000Z',
        },
      ]),
    );

    render(<HomePage />);

    expect(screen.getByRole('heading', { name: /compare cards/i })).toBeInTheDocument();
    expect(screen.getByText('Pikachu')).toBeInTheDocument();
    expect(screen.getByText('Charizard')).toBeInTheDocument();
  });

  it('adds descriptive aria labels to card action buttons', () => {
    window.localStorage.setItem(
      WATCHLIST_STORAGE_KEY,
      JSON.stringify([
        {
          lookupId: 'watch-1',
          name: 'Pikachu',
          market: 'US',
          viewedAt: '2026-03-09T00:00:00.000Z',
          lastPrice: {
            currency: 'USD',
            low: 8,
            high: 12,
            source: 'TCGPLAYER',
            fetchedAt: '2026-03-09T00:00:00.000Z',
          },
        },
      ]),
    );
    window.localStorage.setItem(
      RECENT_STORAGE_KEY,
      JSON.stringify([
        {
          lookupId: 'recent-1',
          name: 'Snorlax',
          market: 'US',
          viewedAt: '2026-03-09T00:00:00.000Z',
        },
      ]),
    );
    window.localStorage.setItem(
      COMPARE_STORAGE_KEY,
      JSON.stringify([
        {
          lookupId: 'compare-1',
          name: 'Charizard',
          market: 'US',
          viewedAt: '2026-03-09T00:00:00.000Z',
        },
      ]),
    );

    render(<HomePage />);

    expect(screen.getByRole('button', { name: 'Refresh price for Pikachu' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Pikachu from watchlist' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recheck price for Snorlax' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Snorlax to watchlist' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh price for Charizard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Charizard from compare list' })).toBeInTheDocument();
  });

  it('keeps card actions keyboard-focusable', () => {
    window.localStorage.setItem(
      WATCHLIST_STORAGE_KEY,
      JSON.stringify([
        {
          lookupId: 'watch-1',
          name: 'Pikachu',
          market: 'US',
          viewedAt: '2026-03-09T00:00:00.000Z',
        },
      ]),
    );
    window.localStorage.setItem(
      RECENT_STORAGE_KEY,
      JSON.stringify([
        {
          lookupId: 'recent-1',
          name: 'Snorlax',
          market: 'US',
          viewedAt: '2026-03-09T00:00:00.000Z',
        },
      ]),
    );
    window.localStorage.setItem(
      COMPARE_STORAGE_KEY,
      JSON.stringify([
        {
          lookupId: 'compare-1',
          name: 'Charizard',
          market: 'US',
          viewedAt: '2026-03-09T00:00:00.000Z',
        },
      ]),
    );

    render(<HomePage />);

    const watchlistRefresh = screen.getByRole('button', { name: 'Refresh price for Pikachu' });
    const watchlistRemove = screen.getByRole('button', { name: 'Remove Pikachu from watchlist' });
    const recentRecheck = screen.getByRole('button', { name: 'Recheck price for Snorlax' });
    const recentToggle = screen.getByRole('button', { name: 'Add Snorlax to watchlist' });
    const compareRefresh = screen.getByRole('button', { name: 'Refresh price for Charizard' });
    const compareRemove = screen.getByRole('button', { name: 'Remove Charizard from compare list' });

    watchlistRefresh.focus();
    expect(watchlistRefresh).toHaveFocus();
    watchlistRemove.focus();
    expect(watchlistRemove).toHaveFocus();
    recentRecheck.focus();
    expect(recentRecheck).toHaveFocus();
    recentToggle.focus();
    expect(recentToggle).toHaveFocus();
    compareRefresh.focus();
    expect(compareRefresh).toHaveFocus();
    compareRemove.focus();
    expect(compareRemove).toHaveFocus();
  });

  it('shows empty-state guidance for manual, compare, watchlist, and history sections', () => {
    render(<HomePage />);

    expect(screen.getByText('No manual results yet.')).toBeInTheDocument();
    expect(screen.getByText('No cards selected yet. Add cards from candidates or manual results.')).toBeInTheDocument();
    expect(screen.getByText('No cards in watchlist yet. Add cards from candidates or manual results.')).toBeInTheDocument();
    expect(
      screen.getByText('No recent checks yet. Price checks from candidates or manual results will appear here.'),
    ).toBeInTheDocument();
  });

  it('shows user-friendly alert when manual search request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Failed to fetch'));

    render(<HomePage />);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mew' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(screen.getByText('Search failed. Review filters and try again.')).toBeInTheDocument();
      expect(
        screen.getByText('Cannot reach server. Check internet or server status, then try again.'),
      ).toBeInTheDocument();
    });
  });

  it('clears manual filters and shows feedback toast', async () => {
    window.localStorage.setItem(
      SEARCH_PRESETS_STORAGE_KEY,
      JSON.stringify([
        {
          id: 'preset-1',
          name: 'KR Promo',
          market: 'KR',
          language: 'KO',
          manualQuery: 'Eevee',
          manualSetCode: 'sv1',
          manualNumber: '133',
          manualVariant: 'PROMO',
        },
      ]),
    );

    render(<HomePage />);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mew' } });
    fireEvent.change(screen.getByLabelText('Set Code'), { target: { value: 'sv2' } });
    fireEvent.change(screen.getByLabelText('Number'), { target: { value: '125' } });
    fireEvent.change(screen.getByLabelText('Variant'), { target: { value: 'HOLOFOIL' } });
    fireEvent.change(screen.getByLabelText('Preset Name'), { target: { value: 'My Preset' } });
    fireEvent.change(screen.getByLabelText('Saved Presets'), { target: { value: 'preset-1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Name')).toHaveValue('');
      expect(screen.getByLabelText('Set Code')).toHaveValue('');
      expect(screen.getByLabelText('Number')).toHaveValue('');
      expect(screen.getByLabelText('Variant')).toHaveValue('');
      expect(screen.getByLabelText('Preset Name')).toHaveValue('');
      expect(screen.getByLabelText('Saved Presets')).toHaveValue('');
      expect(screen.getByText('Manual filters cleared.')).toBeInTheDocument();
    });
  });

  it('disables manual form actions while search is loading', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => {}));

    render(<HomePage />);

    fireEvent.change(screen.getByLabelText('Preset Name'), { target: { value: 'Busy preset' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Charizard' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(screen.getByRole('button', { name: 'Searching…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save Preset' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear Filters' })).toBeDisabled();
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByLabelText('Set Code')).toBeDisabled();
    expect(screen.getByLabelText('Number')).toBeDisabled();
    expect(screen.getByLabelText('Variant')).toBeDisabled();
    expect(screen.getByText('Search in progress. Manual controls are temporarily locked.')).toBeInTheDocument();
    expect(screen.getByTestId('manual-loading-spinner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear Filters' })).toHaveAttribute(
      'title',
      'Search in progress. Please wait.',
    );
  });

  it('hydrates market/language/manual search inputs from URL query', () => {
    window.history.replaceState(
      {},
      '',
      '/?market=JP&language=JA&q=Mew&setCode=sv2&number=125&variant=HOLOFOIL',
    );

    render(<HomePage />);

    expect(screen.getByLabelText('Market')).toHaveValue('JP');
    expect(screen.getByLabelText('Card Language')).toHaveValue('JA');
    expect(screen.getByLabelText('Name')).toHaveValue('Mew');
    expect(screen.getByLabelText('Set Code')).toHaveValue('sv2');
    expect(screen.getByLabelText('Number')).toHaveValue('125');
    expect(screen.getByLabelText('Variant')).toHaveValue('HOLOFOIL');
  });

  it('syncs changed filters back to URL query', async () => {
    render(<HomePage />);

    fireEvent.change(screen.getByLabelText('Market'), { target: { value: 'KR' } });
    fireEvent.change(screen.getByLabelText('Card Language'), { target: { value: 'KO' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Eevee' } });
    fireEvent.change(screen.getByLabelText('Set Code'), { target: { value: 'sv1' } });
    fireEvent.change(screen.getByLabelText('Number'), { target: { value: '133' } });
    fireEvent.change(screen.getByLabelText('Variant'), { target: { value: 'PROMO' } });

    await waitFor(() => {
      const params = new URLSearchParams(window.location.search);
      expect(params.get('market')).toBe('KR');
      expect(params.get('language')).toBe('KO');
      expect(params.get('q')).toBe('Eevee');
      expect(params.get('setCode')).toBe('sv1');
      expect(params.get('number')).toBe('133');
      expect(params.get('variant')).toBe('PROMO');
    });
  });

  it('removes optional query params when manual filters are cleared', async () => {
    window.history.replaceState(
      {},
      '',
      '/?market=JP&language=JA&q=Mew&setCode=sv2&number=125&variant=HOLOFOIL',
    );

    render(<HomePage />);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Set Code'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Number'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Variant'), { target: { value: '' } });

    await waitFor(() => {
      const params = new URLSearchParams(window.location.search);
      expect(params.get('market')).toBe('JP');
      expect(params.get('language')).toBe('JA');
      expect(params.get('q')).toBeNull();
      expect(params.get('setCode')).toBeNull();
      expect(params.get('number')).toBeNull();
      expect(params.get('variant')).toBeNull();
    });
  });

  it('saves current filters as a preset', async () => {
    render(<HomePage />);

    fireEvent.change(screen.getByLabelText('Market'), { target: { value: 'JP' } });
    fireEvent.change(screen.getByLabelText('Card Language'), { target: { value: 'JA' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mew' } });
    fireEvent.change(screen.getByLabelText('Set Code'), { target: { value: 'sv2' } });
    fireEvent.change(screen.getByLabelText('Number'), { target: { value: '125' } });
    fireEvent.change(screen.getByLabelText('Variant'), { target: { value: 'HOLOFOIL' } });
    fireEvent.change(screen.getByLabelText('Preset Name'), { target: { value: 'JP Mew Holo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Preset' }));

    await waitFor(() => {
      const raw = window.localStorage.getItem(SEARCH_PRESETS_STORAGE_KEY);
      expect(raw).toBeTruthy();
      const presets = JSON.parse(raw ?? '[]') as Array<Record<string, string>>;
      expect(presets).toHaveLength(1);
      expect(presets[0].name).toBe('JP Mew Holo');
      expect(presets[0].market).toBe('JP');
      expect(presets[0].language).toBe('JA');
      expect(presets[0].manualQuery).toBe('Mew');
      expect(presets[0].manualSetCode).toBe('sv2');
      expect(presets[0].manualNumber).toBe('125');
      expect(presets[0].manualVariant).toBe('HOLOFOIL');
    });
  });

  it('keeps preset apply/delete actions disabled when no preset is selected', () => {
    render(<HomePage />);

    expect(screen.getByRole('button', { name: 'Apply Preset' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete Preset' })).toBeDisabled();
  });

  it('updates an existing preset when saving with the same name', async () => {
    window.localStorage.setItem(
      SEARCH_PRESETS_STORAGE_KEY,
      JSON.stringify([
        {
          id: 'preset-1',
          name: 'JP Mew Holo',
          market: 'JP',
          language: 'JA',
          manualQuery: 'Mew',
          manualSetCode: 'sv2',
          manualNumber: '125',
          manualVariant: 'HOLOFOIL',
        },
      ]),
    );

    render(<HomePage />);

    fireEvent.change(screen.getByLabelText('Market'), { target: { value: 'KR' } });
    fireEvent.change(screen.getByLabelText('Card Language'), { target: { value: 'KO' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Eevee' } });
    fireEvent.change(screen.getByLabelText('Set Code'), { target: { value: 'sv1' } });
    fireEvent.change(screen.getByLabelText('Number'), { target: { value: '133' } });
    fireEvent.change(screen.getByLabelText('Variant'), { target: { value: 'PROMO' } });
    fireEvent.change(screen.getByLabelText('Preset Name'), { target: { value: 'jp mew holo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Preset' }));

    await waitFor(() => {
      const raw = window.localStorage.getItem(SEARCH_PRESETS_STORAGE_KEY);
      expect(raw).toBeTruthy();
      const presets = JSON.parse(raw ?? '[]') as Array<{
        id: string;
        name: string;
        market: string;
        language: string;
        manualQuery: string;
        manualSetCode: string;
        manualNumber: string;
        manualVariant: string;
      }>;
      expect(presets).toHaveLength(1);
      expect(presets[0].id).toBe('preset-1');
      expect(presets[0].name).toBe('jp mew holo');
      expect(presets[0].market).toBe('KR');
      expect(presets[0].language).toBe('KO');
      expect(presets[0].manualQuery).toBe('Eevee');
      expect(presets[0].manualSetCode).toBe('sv1');
      expect(presets[0].manualNumber).toBe('133');
      expect(presets[0].manualVariant).toBe('PROMO');
    });
  });

  it('applies a saved preset to filters', async () => {
    window.localStorage.setItem(
      SEARCH_PRESETS_STORAGE_KEY,
      JSON.stringify([
        {
          id: 'preset-1',
          name: 'KR Promo',
          market: 'KR',
          language: 'KO',
          manualQuery: 'Eevee',
          manualSetCode: 'sv1',
          manualNumber: '133',
          manualVariant: 'PROMO',
        },
      ]),
    );

    render(<HomePage />);

    fireEvent.change(screen.getByLabelText('Saved Presets'), { target: { value: 'preset-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Preset' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Market')).toHaveValue('KR');
      expect(screen.getByLabelText('Card Language')).toHaveValue('KO');
      expect(screen.getByLabelText('Name')).toHaveValue('Eevee');
      expect(screen.getByLabelText('Set Code')).toHaveValue('sv1');
      expect(screen.getByLabelText('Number')).toHaveValue('133');
      expect(screen.getByLabelText('Variant')).toHaveValue('PROMO');
    });
  });

  it('deletes a selected preset from storage and resets selector', async () => {
    window.localStorage.setItem(
      SEARCH_PRESETS_STORAGE_KEY,
      JSON.stringify([
        {
          id: 'preset-1',
          name: 'KR Promo',
          market: 'KR',
          language: 'KO',
          manualQuery: 'Eevee',
          manualSetCode: 'sv1',
          manualNumber: '133',
          manualVariant: 'PROMO',
        },
      ]),
    );

    render(<HomePage />);

    fireEvent.change(screen.getByLabelText('Saved Presets'), { target: { value: 'preset-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete Preset' }));

    await waitFor(() => {
      const raw = window.localStorage.getItem(SEARCH_PRESETS_STORAGE_KEY);
      expect(raw).toBeTruthy();
      const presets = JSON.parse(raw ?? '[]') as Array<{ id: string }>;
      expect(presets).toHaveLength(0);
      expect(screen.getByLabelText('Saved Presets')).toHaveValue('');
    });
  });

  it('shows manual search skeleton while search is loading', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => {}));

    render(<HomePage />);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Charizard' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(screen.getByLabelText('Manual search loading skeleton')).toBeInTheDocument();
  });

  it('requests autocomplete suggestions while typing name', async () => {
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

    render(<HomePage />);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Pika' } });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    }, { timeout: 2000 });

    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain('/cards/search?');
    expect(calledUrl).toContain('q=Pika');
    expect(calledUrl).toContain('limit=5');
  });
});
