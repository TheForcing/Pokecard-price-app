import type { Language, Market } from '@pokecard/shared';

export type WatchlistSort = 'newest' | 'name-asc';

export type SavedCard = {
  lookupId: string;
  name: string;
  market: Market;
  language?: Language;
  setCode?: string;
  number?: string;
  variant?: string;
  imageUrl?: string;
  viewedAt: string;
  goalPrice?: number;
  lastPrice?: {
    currency: string;
    low: number | null;
    high: number | null;
    source: string;
    fetchedAt: string;
    previousLow?: number | null;
  };
};
