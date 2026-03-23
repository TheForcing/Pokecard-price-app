'use client';

import type { CardVariant, Language, Market } from '@pokecard/shared';
import type { CandidateCard, CardIdentity, PriceResponse } from '@pokecard/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CompareCardsSection } from './components/compare-cards-section';
import { CandidatesSection } from './components/candidates-section';
import { ManualSearchPriceSection } from './components/manual-search-price-section';
import { RecentHistorySection } from './components/recent-history-section';
import { UploadCameraCropSection } from './components/upload-camera-crop-section';
import { WatchlistSection } from './components/watchlist-section';
import { useCardSearch } from './hooks/use-card-search';
import { usePrice } from './hooks/use-price';
import { useRecognize } from './hooks/use-recognize';
import type { SavedCard, WatchlistSort } from './types/saved-card';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000';
const WATCHLIST_STORAGE_KEY = 'pokecard:watchlist:v1';
const RECENT_STORAGE_KEY = 'pokecard:recent:v1';
const COMPARE_STORAGE_KEY = 'pokecard:compare:v1';
const SEARCH_PRESETS_STORAGE_KEY = 'pokecard:search-presets:v1';
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

type SearchPreset = {
  id: string;
  name: string;
  market: Market;
  language: Language;
  manualQuery: string;
  manualSetCode: string;
  manualNumber: string;
  manualVariant: CardVariant | '';
};

type ManualActionToast = {
  kind: 'success' | 'error' | 'info';
  message: string;
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

function parseSearchPresets(raw: string | null): SearchPreset[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SearchPreset =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as SearchPreset).id === 'string' &&
        typeof (item as SearchPreset).name === 'string' &&
        typeof (item as SearchPreset).market === 'string' &&
        typeof (item as SearchPreset).language === 'string' &&
        typeof (item as SearchPreset).manualQuery === 'string' &&
        typeof (item as SearchPreset).manualSetCode === 'string' &&
        typeof (item as SearchPreset).manualNumber === 'string' &&
        (typeof (item as SearchPreset).manualVariant === 'string' ||
          (item as SearchPreset).manualVariant === ''),
    );
  } catch {
    return [];
  }
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
  const [presetNameInput, setPresetNameInput] = useState('');
  const [savedPresets, setSavedPresets] = useState<SearchPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [isUrlStateInitialized, setIsUrlStateInitialized] = useState(false);
  const [manualActionToast, setManualActionToast] = useState<ManualActionToast | null>(null);
  const previousManualLoadingRef = useRef(false);

  const recognize = useRecognize({ apiBase: API_BASE, lowConfidenceThreshold: 0.5 });
  const price = usePrice({ apiBase: API_BASE });
  const cardSearch = useCardSearch({ apiBase: API_BASE });
  const fetchSuggestions = cardSearch.fetchSuggestions;
  const clearSuggestions = cardSearch.clearSuggestions;

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
    const trimmedQuery = manualQuery.trim();
    if (trimmedQuery.length < 2) {
      clearSuggestions();
      return;
    }

    const timeoutId = globalThis.setTimeout(() => {
      void fetchSuggestions(trimmedQuery, language);
    }, 250);

    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [manualQuery, language, fetchSuggestions, clearSuggestions]);

  useEffect(() => {
    const wasLoading = previousManualLoadingRef.current;

    if (!wasLoading && cardSearch.loading) {
      setManualActionToast({ kind: 'info', message: 'Searching cards with current filters...' });
    }

    if (wasLoading && !cardSearch.loading && cardSearch.hasSearched) {
      if (cardSearch.error) {
        setManualActionToast({ kind: 'error', message: 'Search failed. Review filters and try again.' });
      } else if (cardSearch.manualResults.length === 0) {
        setManualActionToast({ kind: 'info', message: 'No matching cards found. Try broader keywords.' });
      } else {
        setManualActionToast({
          kind: 'success',
          message: `Found ${cardSearch.manualResults.length} matching card(s). Select one to check price.`,
        });
      }
    }

    previousManualLoadingRef.current = cardSearch.loading;
  }, [cardSearch.error, cardSearch.hasSearched, cardSearch.loading, cardSearch.manualResults.length]);

  useEffect(() => {
    try {
      const storedWatchlist = parseSavedCards(globalThis.localStorage.getItem(WATCHLIST_STORAGE_KEY));
      const storedRecent = parseSavedCards(globalThis.localStorage.getItem(RECENT_STORAGE_KEY));
      const storedCompare = parseSavedCards(globalThis.localStorage.getItem(COMPARE_STORAGE_KEY));
      const storedSearchPresets = parseSearchPresets(globalThis.localStorage.getItem(SEARCH_PRESETS_STORAGE_KEY));
      setWatchlist(storedWatchlist);
      setRecentHistory(storedRecent);
      setCompareCards(storedCompare.slice(0, COMPARE_LIMIT));
      setSavedPresets(storedSearchPresets);
    } catch {
      setWatchlist([]);
      setRecentHistory([]);
      setCompareCards([]);
      setSavedPresets([]);
    }
  }, []);

  function persistSearchPresets(next: SearchPreset[]) {
    setSavedPresets(next);
    try {
      globalThis.localStorage.setItem(SEARCH_PRESETS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // no-op: keep in-memory state when storage is unavailable
    }
  }

  function saveCurrentPreset() {
    const trimmedName = presetNameInput.trim();
    if (!trimmedName) {
      setManualActionToast({ kind: 'error', message: 'Enter a preset name before saving.' });
      return;
    }
    const nextPreset: SearchPreset = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: trimmedName,
      market,
      language,
      manualQuery,
      manualSetCode,
      manualNumber,
      manualVariant,
    };
    const existingIndex = savedPresets.findIndex((preset) => preset.name.toLowerCase() === trimmedName.toLowerCase());
    let nextPresets = savedPresets;
    if (existingIndex >= 0) {
      nextPresets = [...savedPresets];
      nextPresets[existingIndex] = { ...nextPreset, id: savedPresets[existingIndex].id };
      setSelectedPresetId(savedPresets[existingIndex].id);
      setManualActionToast({ kind: 'success', message: `Updated preset "${trimmedName}".` });
    } else {
      nextPresets = [nextPreset, ...savedPresets];
      setSelectedPresetId(nextPreset.id);
      setManualActionToast({ kind: 'success', message: `Saved preset "${trimmedName}".` });
    }
    persistSearchPresets(nextPresets);
    setPresetNameInput('');
  }

  function applySelectedPreset() {
    if (!selectedPresetId) {
      setManualActionToast({ kind: 'error', message: 'Select a preset before applying.' });
      return;
    }
    const preset = savedPresets.find((item) => item.id === selectedPresetId);
    if (!preset) {
      setManualActionToast({ kind: 'error', message: 'Selected preset was not found.' });
      return;
    }
    setMarket(preset.market);
    setLanguage(preset.language);
    setManualQuery(preset.manualQuery);
    setManualSetCode(preset.manualSetCode);
    setManualNumber(preset.manualNumber);
    setManualVariant(preset.manualVariant);
    setManualActionToast({ kind: 'success', message: `Applied preset "${preset.name}".` });
  }

  function deleteSelectedPreset() {
    if (!selectedPresetId) {
      setManualActionToast({ kind: 'error', message: 'Select a preset before deleting.' });
      return;
    }
    const targetPreset = savedPresets.find((item) => item.id === selectedPresetId);
    const next = savedPresets.filter((item) => item.id !== selectedPresetId);
    persistSearchPresets(next);
    setSelectedPresetId('');
    if (targetPreset) {
      setManualActionToast({ kind: 'success', message: `Deleted preset "${targetPreset.name}".` });
      return;
    }
    setManualActionToast({ kind: 'info', message: 'Selected preset has already been removed.' });
  }

  function clearManualFilters() {
    setManualQuery('');
    setManualSetCode('');
    setManualNumber('');
    setManualVariant('');
    setPresetNameInput('');
    setSelectedPresetId('');
    cardSearch.resetManualSearch();
    clearSuggestions();
    price.clearPrice();
    setManualActionToast({ kind: 'info', message: 'Manual filters cleared.' });
  }

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
        <h1 className="hero-title">PokéCard Price Finder</h1>
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
        <section className="panel panel-top-gap">
          <div className="panel-header">
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
        suggestions={cardSearch.suggestions}
        suggestionsLoading={cardSearch.suggestionsLoading}
        actionToast={manualActionToast}
        presetNameInput={presetNameInput}
        selectedPresetId={selectedPresetId}
        savedPresets={savedPresets}
        onManualQueryChange={setManualQuery}
        onManualSetCodeChange={setManualSetCode}
        onManualNumberChange={setManualNumber}
        onManualVariantChange={setManualVariant}
        onPresetNameInputChange={setPresetNameInput}
        onSelectedPresetIdChange={setSelectedPresetId}
        onClearManualFilters={clearManualFilters}
        onSavePreset={saveCurrentPreset}
        onApplyPreset={applySelectedPreset}
        onDeletePreset={deleteSelectedPreset}
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
        <section className="panel panel-top-gap">
          <div className="panel-header">
            <span className="muted">Selected manual card: {selectedManualCard.name}</span>
            <button type="button" onClick={() => addToCompare(toSavedCardFromIdentity(selectedManualCard, market))}>
              Add Manual Selection to Compare
            </button>
          </div>
        </section>
      )}

      <CompareCardsSection
        compareCards={compareCards}
        onGetPrice={handleGetSavedCardPrice}
        onRemove={removeFromCompare}
      />

      <WatchlistSection
        watchlist={watchlist}
        sortedWatchlist={sortedWatchlist}
        watchlistSort={watchlistSort}
        onWatchlistSortChange={setWatchlistSort}
        onGetPrice={handleGetSavedCardPrice}
        onToggleWatchlist={toggleWatchlist}
        onSetGoalPrice={setWatchlistGoalPrice}
        getLowPriceDiff={getLowPriceDiff}
        formatLowPriceDiff={formatLowPriceDiff}
      />

      <RecentHistorySection
        recentHistory={recentHistory}
        isWatchlistedById={isWatchlistedById}
        onGetPrice={handleGetSavedCardPrice}
        onToggleWatchlist={toggleWatchlist}
        getLowPriceDiff={getLowPriceDiff}
        formatLowPriceDiff={formatLowPriceDiff}
      />

      <footer className="muted footer-tip">
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
