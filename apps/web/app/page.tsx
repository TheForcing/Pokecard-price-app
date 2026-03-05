'use client';

import type { Language, Market } from '@pokecard/shared';
import { useState } from 'react';
import { CandidatesSection } from './components/candidates-section';
import { ManualSearchPriceSection } from './components/manual-search-price-section';
import { UploadCameraCropSection } from './components/upload-camera-crop-section';
import { useCardSearch } from './hooks/use-card-search';
import { usePrice } from './hooks/use-price';
import { useRecognize } from './hooks/use-recognize';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000';

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

  const recognize = useRecognize({ apiBase: API_BASE, lowConfidenceThreshold: 0.5 });
  const price = usePrice({ apiBase: API_BASE });
  const cardSearch = useCardSearch({ apiBase: API_BASE });

  const error = recognize.error ?? price.error ?? cardSearch.error;
  const userError = error ? toUserErrorMessage(error) : null;
  const hasRecognition = recognize.candidates.length > 0;
  const hasManualActivity = cardSearch.hasSearched || cardSearch.manualResults.length > 0;
  const hasPrice = !!price.price;

  async function handleRecognize(preview: string) {
    price.clearPrice();
    await recognize.recognize(preview, market, language);
  }

  async function handleGetPrice(cardId: string) {
    await price.fetchPrice(cardId, market);
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
        displayedCandidates={recognize.displayedCandidates}
        selected={recognize.selected}
        isLowConfidence={recognize.isLowConfidence}
        showAllCandidates={recognize.showAllCandidates}
        onToggleShowAll={() => recognize.setShowAllCandidates(!recognize.showAllCandidates)}
        onSelect={(candidate) => {
          recognize.selectCandidate(candidate);
          price.clearPrice();
        }}
        onGetPrice={handleGetPrice}
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
        onGetPrice={handleGetPrice}
      />

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
