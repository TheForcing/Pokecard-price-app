'use client';

import type { Language, Market } from '@pokecard/shared';
import type { CandidateCard, CardIdentity, PriceResponse } from '@pokecard/shared';
import { useEffect, useState } from 'react';
import { CandidatesSection } from './components/candidates-section';
import { ManualSearchPriceSection } from './components/manual-search-price-section';
import { UploadCameraCropSection } from './components/upload-camera-crop-section';
import { useCardSearch } from './hooks/use-card-search';
import { usePrice } from './hooks/use-price';
import { useRecognize } from './hooks/use-recognize';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000';
const WATCHLIST_STORAGE_KEY = 'pokecard:watchlist:v1';
const RECENT_STORAGE_KEY = 'pokecard:recent:v1';
const RECENT_LIMIT = 10;

type SavedCard = {
  lookupId: string;
  name: string;
  market: Market;
  language?: Language;
  setCode?: string;
  number?: string;
  variant?: string;
  imageUrl?: string;
  viewedAt: string;
  lastPrice?: {
    currency: string;
    low: number | null;
    high: number | null;
    source: string;
    fetchedAt: string;
  };
};

function parseSavedCards(raw: string | null): SavedCard[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SavedCard =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as SavedCard).lookupId === 'string' &&
        typeof (item as SavedCard).name === 'string' &&
        typeof (item as SavedCard).market === 'string' &&
        typeof (item as SavedCard).viewedAt === 'string',
    );
  } catch {
    return [];
  }
}

function toSavedCardFromCandidate(candidate: CandidateCard, market: Market): SavedCard {
  return {
    lookupId: candidate.identityId ?? candidate.cardId,
    name: candidate.name,
    market,
    language: candidate.language,
    setCode: candidate.setCode,
    number: candidate.number,
    variant: candidate.variant,
    imageUrl: candidate.imageUrl,
    viewedAt: new Date().toISOString(),
  };
}

function toSavedCardFromIdentity(card: CardIdentity, market: Market): SavedCard {
  return {
    lookupId: card.id,
    name: card.name,
    market,
    language: card.language,
    setCode: card.setCode,
    number: card.collectorNumber,
    variant: card.variant,
    imageUrl: card.imageUrl,
    viewedAt: new Date().toISOString(),
  };
}

function withPrice(base: SavedCard, price: PriceResponse): SavedCard {
  return {
    ...base,
    viewedAt: new Date().toISOString(),
    lastPrice: {
      currency: price.currency,
      low: price.low,
      high: price.high,
      source: price.source,
      fetchedAt: price.fetchedAt,
    },
  };
}

function upsertByLookupId(items: SavedCard[], item: SavedCard, limit?: number): SavedCard[] {
  const next = [item, ...items.filter((saved) => saved.lookupId !== item.lookupId)];
  return limit ? next.slice(0, limit) : next;
}

function toUserErrorMessage(error: string): string {
  const lowered = error.toLowerCase();
  if (lowered.includes('failed to fetch') || lowered.includes('err_connection_refused')) {
    return 'Cannot reach server. Check internet or server status, then try again.';
  }
  if (lowered.includes('timed out')) {
    return 'Request timed out. Try a smaller image or retry in a few seconds.';
  }
  if (lowered.includes('recognize failed')) {
    return 'Card recognition failed. Please retake the photo with clearer card boundaries.';
  }
  if (lowered.includes('search failed')) {
    return 'Card search failed. Try name-only search first, then narrow with set/number.';
  }
  if (lowered.includes('price failed')) {
    return 'Price lookup failed. Select another candidate or retry after a moment.';
  }
  return `Something went wrong (${error}). Please retry.`;
}

export default function HomePage() {
  const [market, setMarket] = useState<Market>('US');
  const [language, setLanguage] = useState<Language>('EN');
  const [watchlist, setWatchlist] = useState<SavedCard[]>([]);
  const [recentHistory, setRecentHistory] = useState<SavedCard[]>([]);

  const recognize = useRecognize({ apiBase: API_BASE, lowConfidenceThreshold: 0.5 });
  const price = usePrice({ apiBase: API_BASE });
  const cardSearch = useCardSearch({ apiBase: API_BASE });

  const error = recognize.error ?? price.error ?? cardSearch.error;
  const userError = error ? toUserErrorMessage(error) : null;
  const hasRecognition = recognize.candidates.length > 0;
  const hasManualActivity = cardSearch.hasSearched || cardSearch.manualResults.length > 0;
  const hasPrice = !!price.price;

  useEffect(() => {
    try {
      const storedWatchlist = parseSavedCards(globalThis.localStorage.getItem(WATCHLIST_STORAGE_KEY));
      const storedRecent = parseSavedCards(globalThis.localStorage.getItem(RECENT_STORAGE_KEY));
      setWatchlist(storedWatchlist);
      setRecentHistory(storedRecent);
    } catch {
      setWatchlist([]);
      setRecentHistory([]);
    }
  }, []);

  function persistWatchlist(next: SavedCard[]) {
    setWatchlist(next);
    try {
      globalThis.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // no-op: keep in-memory state when storage is unavailable
    }
  }

  function persistRecentHistory(next: SavedCard[]) {
    setRecentHistory(next);
    try {
      globalThis.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // no-op: keep in-memory state when storage is unavailable
    }
  }

  function isWatchlistedById(lookupId: string): boolean {
    return watchlist.some((saved) => saved.lookupId === lookupId);
  }

  function toggleWatchlist(item: SavedCard) {
    const exists = isWatchlistedById(item.lookupId);
    if (exists) {
      persistWatchlist(watchlist.filter((saved) => saved.lookupId !== item.lookupId));
      return;
    }
    persistWatchlist(upsertByLookupId(watchlist, item));
  }

  async function fetchAndTrackPrice(item: SavedCard) {
    const fetched = await price.fetchPrice(item.lookupId, market);
    if (!fetched) return;
    const nextRecent = upsertByLookupId(recentHistory, withPrice(item, fetched), RECENT_LIMIT);
    persistRecentHistory(nextRecent);
  }

  async function handleRecognize(preview: string) {
    price.clearPrice();
    await recognize.recognize(preview, market, language);
  }

  async function handleGetCandidatePrice(candidate: CandidateCard) {
    await fetchAndTrackPrice(toSavedCardFromCandidate(candidate, market));
  }

  async function handleGetManualCardPrice(card: CardIdentity) {
    await fetchAndTrackPrice(toSavedCardFromIdentity(card, market));
  }

  async function handleGetSavedCardPrice(item: SavedCard) {
    await fetchAndTrackPrice({ ...item, market });
  }

  return (
    <main className="app-shell">
      <section className="app-hero">
        <h1 style={{ fontSize: 34, margin: 0 }}>PokéCard Price Finder</h1>
        <p>Upload a card image, verify recognition, then check live low/high market price.</p>
        <ol className="hero-steps" aria-label="Recommended mobile flow">
          <li>Choose Image (or camera), then crop if needed.</li>
          <li>Tap Recognize and pick the best candidate.</li>
          <li>Tap Get Price. If OCR fails, use Manual Search.</li>
        </ol>
      </section>

      <section className="flow-strip" aria-label="Flow status">
        <div className={`flow-chip ${hasRecognition || hasManualActivity || hasPrice ? 'done' : 'current'}`}>
          <span className="flow-step">Step 1</span>
          <strong>Upload</strong>
        </div>
        <div className={`flow-chip ${hasRecognition || hasManualActivity || hasPrice ? 'current' : ''}`}>
          <span className="flow-step">Step 2</span>
          <strong>Pick Card</strong>
        </div>
        <div className={`flow-chip ${hasPrice ? 'done current' : ''}`}>
          <span className="flow-step">Step 3</span>
          <strong>View Price</strong>
        </div>
      </section>

      <UploadCameraCropSection
        market={market}
        language={language}
        loading={recognize.loading || price.loading}
        onMarketChange={setMarket}
        onLanguageChange={setLanguage}
        onRecognize={handleRecognize}
        onResetFlow={() => {
          recognize.reset();
          recognize.clearError();
          price.clearPrice();
          price.clearError();
        }}
      />

      {error && (
        <p className="error-text" role="alert" aria-live="assertive">
          {userError}
        </p>
      )}

      <CandidatesSection
        candidates={recognize.candidates}
        topCandidates={recognize.topCandidates}
        selected={recognize.selected}
        isLowConfidence={recognize.isLowConfidence}
        isWatchlisted={(candidate) => isWatchlistedById(candidate.identityId ?? candidate.cardId)}
        onToggleWatchlist={(candidate) => toggleWatchlist(toSavedCardFromCandidate(candidate, market))}
        onSelect={(candidate) => {
          recognize.selectCandidate(candidate);
          price.clearPrice();
        }}
        onGetPrice={handleGetCandidatePrice}
      />

      <ManualSearchPriceSection
        language={language}
        manualResults={cardSearch.manualResults}
        displayedManualResults={cardSearch.displayedManualResults}
        manualSelected={cardSearch.manualSelected}
        showAllManualResults={cardSearch.showAllManualResults}
        hasSearched={cardSearch.hasSearched}
        manualLoading={cardSearch.loading}
        price={price.price}
        onSearch={async (input) => {
          price.clearPrice();
          await cardSearch.searchCards(input);
        }}
        onSelectManual={(card) => {
          cardSearch.setManualSelected(card);
          price.clearPrice();
        }}
        onToggleShowAllManual={() =>
          cardSearch.setShowAllManualResults(!cardSearch.showAllManualResults)
        }
        isWatchlisted={(card) => isWatchlistedById(card.id)}
        onToggleWatchlist={(card) => toggleWatchlist(toSavedCardFromIdentity(card, market))}
        onGetPrice={handleGetManualCardPrice}
      />

      <section className="panel">
        <h2>Watchlist</h2>
        {watchlist.length === 0 ? (
          <p className="muted" style={{ marginTop: 10 }}>
            No cards in watchlist yet. Add cards from candidates or manual search.
          </p>
        ) : (
          <ul className="card-list">
            {watchlist.map((item) => (
              <li key={item.lookupId} className="entity-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 220 }}>
                    <div style={{ fontWeight: 600 }}>{item.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {item.market} / {item.language ?? '-'} / {item.setCode ?? '-'} / {item.number ?? '-'} /{' '}
                      {item.variant ?? '-'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
                    <button type="button" onClick={() => handleGetSavedCardPrice(item)}>
                      Get Price
                    </button>
                    <button className="ghost" type="button" onClick={() => toggleWatchlist(item)}>
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Recent Price Checks</h2>
        {recentHistory.length === 0 ? (
          <p className="muted" style={{ marginTop: 10 }}>
            No recent checks yet. Prices fetched from candidates/manual search will appear here.
          </p>
        ) : (
          <ul className="card-list">
            {recentHistory.map((item) => (
              <li key={item.lookupId} className="entity-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 220 }}>
                    <div style={{ fontWeight: 600 }}>{item.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Last checked: {item.viewedAt}
                    </div>
                    {item.lastPrice && (
                      <div className="muted" style={{ fontSize: 12 }}>
                        {item.lastPrice.currency} low {item.lastPrice.low ?? '-'} / high{' '}
                        {item.lastPrice.high ?? '-'} ({item.lastPrice.source})
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
                    <button type="button" onClick={() => handleGetSavedCardPrice(item)}>
                      Recheck Price
                    </button>
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => toggleWatchlist({ ...item, market })}
                    >
                      {isWatchlistedById(item.lookupId) ? 'Remove Watchlist' : 'Add Watchlist'}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="muted" style={{ marginTop: 24, fontSize: 12 }}>
        Tip: Better photos and clear card boundaries usually improve OCR confidence.
      </footer>

      <aside className="mobile-hint" role="status" aria-live="polite">
        {hasPrice
          ? 'Price loaded. Compare low/high and retry with another candidate if needed.'
          : hasRecognition || hasManualActivity
            ? 'Card candidates are ready. Select one and tap Get Price.'
            : 'Start with Choose Image for the fastest flow.'}
      </aside>
    </main>
  );
}
