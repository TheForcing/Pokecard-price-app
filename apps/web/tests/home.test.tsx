import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import HomePage from '../app/page';

const WATCHLIST_STORAGE_KEY = 'pokecard:watchlist:v1';
const RECENT_STORAGE_KEY = 'pokecard:recent:v1';

describe('HomePage', () => {
  beforeEach(() => {
    window.localStorage.clear();
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
});
