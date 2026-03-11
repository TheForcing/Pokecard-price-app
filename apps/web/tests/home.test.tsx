import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import HomePage from '../app/page';

const WATCHLIST_STORAGE_KEY = 'pokecard:watchlist:v1';
const RECENT_STORAGE_KEY = 'pokecard:recent:v1';
const COMPARE_STORAGE_KEY = 'pokecard:compare:v1';

describe('HomePage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
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
});
