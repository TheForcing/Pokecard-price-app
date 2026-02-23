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

export default function HomePage() {
  const [market, setMarket] = useState<Market>('US');
  const [language, setLanguage] = useState<Language>('EN');

  const recognize = useRecognize({ apiBase: API_BASE, lowConfidenceThreshold: 0.5 });
  const price = usePrice({ apiBase: API_BASE });
  const cardSearch = useCardSearch({ apiBase: API_BASE });

  const error = recognize.error ?? price.error ?? cardSearch.error;
  const timeoutHint =
    error && error.includes('timed out')
      ? 'Try a smaller image, check network status, or retry after a few seconds.'
      : null;

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
        <p className="error-text">
          Error: {error}
          {timeoutHint ? ` (${timeoutHint})` : ''}
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
    </main>
  );
}
