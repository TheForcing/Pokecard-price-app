'use client';

import type { CardVariant, Language, Market } from '@pokecard/shared';
import type { CandidateCard, CardIdentity, PriceResponse } from '@pokecard/shared';
import { useEffect, useMemo, useState } from 'react';
import { CandidatesSection } from './components/candidates-section';
import { ManualSearchPriceSection } from './components/manual-search-price-section';
import { UploadCameraCropSection } from './components/upload-camera-crop-section';
import { useCardSearch } from './hooks/use-card-search';
import { usePrice } from './hooks/use-price';
import { useRecognize } from './hooks/use-recognize';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000';
const WATCHLIST_STORAGE_KEY = 'pokecard:watchlist:v1';
const RECENT_STORAGE_KEY = 'pokecard:recent:v1';
const COMPARE_STORAGE_KEY = 'pokecard:compare:v1';
const RECENT_LIMIT = 10;
const COMPARE_LIMIT = 3;
const MANUAL_VARIANTS: readonly CardVariant[] = [
  'NORMAL',
  'HOLOFOIL',
  'REVERSE_HOLOFOIL',
  'FULL_ART',
  'ALT_ART',
  'SECRET',
  'PROMO',
  'OTHER',
];

type WatchlistSort = 'newest' | 'name-asc';

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

function withPrice(base: SavedCard, price: PriceResponse, previousLow?: number | null): SavedCard {
  return {
    ...base,
    viewedAt: new Date().toISOString(),
    lastPrice: {
      currency: price.currency,
      low: price.low,
      high: price.high,
      source: price.source,
      fetchedAt: price.fetchedAt,
      previousLow,
    },
  };
}

function upsertByLookupId(items: SavedCard[], item: SavedCard, limit?: number): SavedCard[] {
  const next = [item, ...items.filter((saved) => saved.lookupId !== item.lookupId)];
  return limit ? next.slice(0, limit) : next;
}

function replaceByLookupId(items: SavedCard[], item: SavedCard): SavedCard[] {
  return items.map((saved) => (saved.lookupId === item.lookupId ? item : saved));
}

function parseGoalPriceInput(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const next = Number(trimmed);
  if (!Number.isFinite(next) || next < 0) return undefined;
  return next;
}

function getLowPriceDiff(lastPrice?: SavedCard['lastPrice']): number | null {
  if (!lastPrice) return null;
  if (lastPrice.low === null) return null;
  if (typeof lastPrice.previousLow !== 'number') return null;
  return lastPrice.low - lastPrice.previousLow;
}

function formatLowPriceDiff(diff: number): string {
  if (diff === 0) return 'Low unchanged';
  const sign = diff > 0 ? '+' : '-';
  return `Low ${sign}${Math.abs(diff).toFixed(2)}`;
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

function parseMarketParam(value: string | null): Market | null {
  if (value === 'US' || value === 'JP' || value === 'KR') return value;
  return null;
}

function parseLanguageParam(value: string | null): Language | null {
  if (value === 'EN' || value === 'JA' || value === 'KO') return value;
  return null;
}

function parseVariantParam(value: string | null): CardVariant | '' {
  if (!value) return '';
  if (MANUAL_VARIANTS.includes(value as CardVariant)) return value as CardVariant;
  return '';
}

export default function HomePage() {
  const [market, setMarket] = useState<Market>('US');
  const [language, setLanguage] = useState<Language>('EN');
  const [watchlist, setWatchlist] = useState<SavedCard[]>([]);
  const [recentHistory, setRecentHistory] = useState<SavedCard[]>([]);
  const [compareCards, setCompareCards] = useState<SavedCard[]>([]);
  const [watchlistSort, setWatchlistSort] = useState<WatchlistSort>('newest');
  const [manualQuery, setManualQuery] = useState('');
  const [manualSetCode, setManualSetCode] = useState('');
  const [manualNumber, setManualNumber] = useState('');
  const [manualVariant, setManualVariant] = useState<CardVariant | ''>('NORMAL');
  const [isUrlStateInitialized, setIsUrlStateInitialized] = useState(false);

  const recognize = useRecognize({ apiBase: API_BASE, lowConfidenceThreshold: 0.5 });
  const price = usePrice({ apiBase: API_BASE });
  const cardSearch = useCardSearch({ apiBase: API_BASE });

  const error = recognize.error ?? price.error ?? cardSearch.error;
  const userError = error ? toUserErrorMessage(error) : null;
  const hasRecognition = recognize.candidates.length > 0;
  const hasManualActivity = cardSearch.hasSearched || cardSearch.manualResults.length > 0;
  const hasPrice = !!price.price;
  const selectedCandidate = recognize.selected;
  const selectedManualCard = cardSearch.manualSelected;
  const sortedWatchlist = useMemo(() => {
    const next = [...watchlist];
    if (watchlistSort === 'name-asc') {
      next.sort((a, b) => a.name.localeCompare(b.name));
      return next;
    }
    next.sort((a, b) => {
      const timeDiff = new Date(b.viewedAt).getTime() - new Date(a.viewedAt).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.name.localeCompare(b.name);
    });
    return next;
  }, [watchlist, watchlistSort]);

  useEffect(() => {
    const params = new URLSearchParams(globalThis.location.search);
    const initialMarket = parseMarketParam(params.get('market'));
    const initialLanguage = parseLanguageParam(params.get('language'));
    const initialQuery = params.get('q')?.trim() ?? '';
    const initialSetCode = params.get('setCode')?.trim() ?? '';
    const initialNumber = params.get('number')?.trim() ?? '';
    const initialVariant = parseVariantParam(params.get('variant'));

    if (initialMarket) setMarket(initialMarket);
    if (initialLanguage) setLanguage(initialLanguage);
    if (initialQuery) setManualQuery(initialQuery);
    if (initialSetCode) setManualSetCode(initialSetCode);
    if (initialNumber) setManualNumber(initialNumber);
    if (initialVariant) setManualVariant(initialVariant);

    setIsUrlStateInitialized(true);
  }, []);

  useEffect(() => {
    if (!isUrlStateInitialized) return;
    const params = new URLSearchParams(globalThis.location.search);
    params.set('market', market);
    params.set('language', language);

    if (manualQuery.trim()) params.set('q', manualQuery.trim());
    else params.delete('q');

    if (manualSetCode.trim()) params.set('setCode', manualSetCode.trim());
    else params.delete('setCode');

    if (manualNumber.trim()) params.set('number', manualNumber.trim());
    else params.delete('number');

    if (manualVariant) params.set('variant', manualVariant);
    else params.delete('variant');

    const nextSearch = params.toString();
    const currentSearch = globalThis.location.search.replace(/^\?/, '');
    if (nextSearch !== currentSearch) {
      const nextUrl = `${globalThis.location.pathname}${nextSearch ? `?${nextSearch}` : ''}`;
      globalThis.history.replaceState(null, '', nextUrl);
    }
  }, [isUrlStateInitialized, market, language, manualQuery, manualSetCode, manualNumber, manualVariant]);

  useEffect(() => {
    try {
      const storedWatchlist = parseSavedCards(globalThis.localStorage.getItem(WATCHLIST_STORAGE_KEY));
      const storedRecent = parseSavedCards(globalThis.localStorage.getItem(RECENT_STORAGE_KEY));
      const storedCompare = parseSavedCards(globalThis.localStorage.getItem(COMPARE_STORAGE_KEY));
      setWatchlist(storedWatchlist);
      setRecentHistory(storedRecent);
      setCompareCards(storedCompare.slice(0, COMPARE_LIMIT));
    } catch {
      setWatchlist([]);
      setRecentHistory([]);
      setCompareCards([]);
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

  function persistCompareCards(next: SavedCard[]) {
    const limited = next.slice(0, COMPARE_LIMIT);
    setCompareCards(limited);
    try {
      globalThis.localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(limited));
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

  function setWatchlistGoalPrice(lookupId: string, raw: string) {
    const goalPrice = parseGoalPriceInput(raw);
    const target = watchlist.find((saved) => saved.lookupId === lookupId);
    if (!target) return;
    const nextItem = { ...target, goalPrice };
    persistWatchlist(replaceByLookupId(watchlist, nextItem));
  }

  function addToCompare(item: SavedCard) {
    persistCompareCards(upsertByLookupId(compareCards, { ...item, market }, COMPARE_LIMIT));
  }

  function removeFromCompare(lookupId: string) {
    persistCompareCards(compareCards.filter((saved) => saved.lookupId !== lookupId));
  }

  async function fetchAndTrackPrice(item: SavedCard) {
    const fetched = await price.fetchPrice(item.lookupId, market);
    if (!fetched) return;
    const previousPrice =
      item.lastPrice ??
      recentHistory.find((saved) => saved.lookupId === item.lookupId)?.lastPrice ??
      watchlist.find((saved) => saved.lookupId === item.lookupId)?.lastPrice;
    const pricedItem = withPrice(item, fetched, previousPrice?.low ?? undefined);
    const nextRecent = upsertByLookupId(recentHistory, pricedItem, RECENT_LIMIT);
    persistRecentHistory(nextRecent);
    if (compareCards.some((saved) => saved.lookupId === item.lookupId)) {
      persistCompareCards(replaceByLookupId(compareCards, pricedItem));
    }
    if (isWatchlistedById(item.lookupId)) {
      persistWatchlist(replaceByLookupId(watchlist, pricedItem));
    }
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

      {selectedCandidate && (
        <section className="panel" style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span className="muted">Selected candidate: {selectedCandidate.name}</span>
            <button type="button" onClick={() => addToCompare(toSavedCardFromCandidate(selectedCandidate, market))}>
              Add Selected to Compare
            </button>
          </div>
        </section>
      )}

      <ManualSearchPriceSection
        language={language}
        manualResults={cardSearch.manualResults}
        displayedManualResults={cardSearch.displayedManualResults}
        manualSelected={cardSearch.manualSelected}
        showAllManualResults={cardSearch.showAllManualResults}
        hasSearched={cardSearch.hasSearched}
        manualLoading={cardSearch.loading}
        price={price.price}
        manualQuery={manualQuery}
        manualSetCode={manualSetCode}
        manualNumber={manualNumber}
        manualVariant={manualVariant}
        onManualQueryChange={setManualQuery}
        onManualSetCodeChange={setManualSetCode}
        onManualNumberChange={setManualNumber}
        onManualVariantChange={setManualVariant}
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

      {selectedManualCard && (
        <section className="panel" style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span className="muted">Selected manual card: {selectedManualCard.name}</span>
            <button type="button" onClick={() => addToCompare(toSavedCardFromIdentity(selectedManualCard, market))}>
              Add Manual Selection to Compare
            </button>
          </div>
        </section>
      )}

      <section className="panel">
        <h2>Compare Cards (up to 3)</h2>
        {compareCards.length === 0 ? (
          <p className="muted" style={{ marginTop: 10 }}>
            Select a candidate or manual result, then add it to compare.
          </p>
        ) : (
          <div
            style={{
              marginTop: 10,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12,
            }}
          >
            {compareCards.map((item) => (
              <article key={item.lookupId} className="entity-card">
                <div style={{ fontWeight: 600 }}>{item.name}</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {item.market} / {item.language ?? '-'} / {item.setCode ?? '-'} / {item.number ?? '-'} /{' '}
                  {item.variant ?? '-'}
                </div>
                {item.lastPrice ? (
                  <div style={{ marginTop: 8, fontSize: 12 }}>
                    <div>
                      {item.lastPrice.currency} low {item.lastPrice.low ?? '-'} / high {item.lastPrice.high ?? '-'}
                    </div>
                    <div className="muted">{item.lastPrice.source}</div>
                  </div>
                ) : (
                  <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                    Price not loaded yet.
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => handleGetSavedCardPrice(item)}>
                    Get Price
                  </button>
                  <button className="ghost" type="button" onClick={() => removeFromCompare(item.lookupId)}>
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>Watchlist</h2>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            Sort
            <select
              value={watchlistSort}
              onChange={(event) => setWatchlistSort(event.target.value as WatchlistSort)}
              aria-label="Watchlist sort"
            >
              <option value="newest">Recently added</option>
              <option value="name-asc">Name (A-Z)</option>
            </select>
          </label>
        </div>
        {watchlist.length === 0 ? (
          <p className="muted" style={{ marginTop: 10 }}>
            No cards in watchlist yet. Add cards from candidates or manual search.
          </p>
        ) : (
          <ul className="card-list">
            {sortedWatchlist.map((item) => (
              <li key={item.lookupId} className="entity-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 220 }}>
                    <div style={{ fontWeight: 600 }}>{item.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {item.market} / {item.language ?? '-'} / {item.setCode ?? '-'} / {item.number ?? '-'} /{' '}
                      {item.variant ?? '-'}
                    </div>
                    {item.lastPrice && (
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                        {item.lastPrice.currency} low {item.lastPrice.low ?? '-'} / high {item.lastPrice.high ?? '-'}
                        {' ('}
                        {item.lastPrice.source}
                        {')'}
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                        Target Price
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          inputMode="decimal"
                          defaultValue={item.goalPrice ?? ''}
                          onBlur={(event) => setWatchlistGoalPrice(item.lookupId, event.target.value)}
                          aria-label={`Target price for ${item.name}`}
                          style={{ width: 120 }}
                        />
                      </label>
                      {typeof item.goalPrice === 'number' && item.lastPrice && (
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: item.lastPrice.low !== null && item.lastPrice.low <= item.goalPrice ? '#0f5132' : '#7a2e0e',
                          }}
                        >
                          {item.lastPrice.low !== null && item.lastPrice.low <= item.goalPrice
                            ? 'Target reached'
                            : 'Above target'}
                        </span>
                      )}
                      {(() => {
                        const lowDiff = getLowPriceDiff(item.lastPrice);
                        if (lowDiff === null) return null;
                        return (
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              color: lowDiff <= 0 ? '#0f5132' : '#7a2e0e',
                            }}
                          >
                            {formatLowPriceDiff(lowDiff)}
                          </span>
                        );
                      })()}
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
                    {(() => {
                      const lowDiff = getLowPriceDiff(item.lastPrice);
                      if (lowDiff === null) return null;
                      return (
                        <div style={{ fontSize: 12, fontWeight: 600, color: lowDiff <= 0 ? '#0f5132' : '#7a2e0e' }}>
                          {formatLowPriceDiff(lowDiff)}
                        </div>
                      );
                    })()}
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
