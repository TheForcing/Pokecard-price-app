'use client';

import type { CardIdentity, CardVariant, Language, PriceResponse } from '@pokecard/shared';
import { useState } from 'react';
import type { CardSearchInput } from '../hooks/use-card-search';

type ManualSearchPriceSectionProps = {
  language: Language;
  manualResults: CardIdentity[];
  displayedManualResults: CardIdentity[];
  manualSelected: CardIdentity | null;
  showAllManualResults: boolean;
  manualLoading: boolean;
  price: PriceResponse | null;
  onSearch: (input: CardSearchInput) => Promise<void> | void;
  onSelectManual: (card: CardIdentity) => void;
  onToggleShowAllManual: () => void;
  onGetPrice: (cardId: string) => void;
};

export function ManualSearchPriceSection({
  language,
  manualResults,
  displayedManualResults,
  manualSelected,
  showAllManualResults,
  manualLoading,
  price,
  onSearch,
  onSelectManual,
  onToggleShowAllManual,
  onGetPrice,
}: ManualSearchPriceSectionProps) {
  const manualNameId = 'manual-name';
  const manualSetCodeId = 'manual-set-code';
  const manualNumberId = 'manual-number';
  const manualVariantId = 'manual-variant';

  const [manualQuery, setManualQuery] = useState('');
  const [manualSetCode, setManualSetCode] = useState('');
  const [manualNumber, setManualNumber] = useState('');
  const [manualVariant, setManualVariant] = useState<CardVariant | ''>('');

  return (
    <>
      <section className="panel">
        <h2>Manual Search</h2>
        <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          Use this when OCR is uncertain. Search by name + set/number + variant.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
          <label
            htmlFor={manualNameId}
            style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            Name
            <input
              id={manualNameId}
              value={manualQuery}
              onChange={(event) => setManualQuery(event.target.value)}
              placeholder="Pikachu"
            />
          </label>
          <label
            htmlFor={manualSetCodeId}
            style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            Set Code
            <input
              id={manualSetCodeId}
              value={manualSetCode}
              onChange={(event) => setManualSetCode(event.target.value)}
              placeholder="swsh4"
            />
          </label>
          <label
            htmlFor={manualNumberId}
            style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            Number
            <input
              id={manualNumberId}
              value={manualNumber}
              onChange={(event) => setManualNumber(event.target.value)}
              placeholder="043"
            />
          </label>
          <label
            htmlFor={manualVariantId}
            style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            Variant
            <select
              id={manualVariantId}
              value={manualVariant}
              onChange={(event) => setManualVariant(event.target.value as CardVariant | '')}
            >
              <option value="">Any</option>
              <option value="NORMAL">Normal</option>
              <option value="HOLOFOIL">Holo</option>
              <option value="REVERSE_HOLOFOIL">Reverse Holo</option>
              <option value="FULL_ART">Full Art</option>
              <option value="ALT_ART">Alt Art</option>
              <option value="SECRET">Secret</option>
              <option value="PROMO">Promo</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() =>
              onSearch({
                query: manualQuery,
                setCode: manualSetCode,
                collectorNumber: manualNumber,
                variant: manualVariant,
                language,
              })
            }
            style={{ height: 40, alignSelf: 'end' }}
          >
            {manualLoading ? 'Searching…' : 'Search'}
          </button>
        </div>

        {manualResults.length === 0 ? (
          <p className="muted" style={{ marginTop: 10 }}>
            No manual results yet.
          </p>
        ) : (
          <>
            <ul className="card-list">
              {displayedManualResults.map((card) => (
                <li
                  key={card.id}
                  className={`entity-card ${manualSelected?.id === card.id ? 'selected' : ''}`}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 220 }}>
                      <div className="thumb">
                        {card.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={card.imageUrl}
                            alt={card.name}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          'No image'
                        )}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600 }}>{card.name}</div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {card.language} / {card.setCode} / {card.collectorNumber} / {card.variant}
                        </div>
                        {card.setName && (
                          <div className="muted" style={{ fontSize: 12 }}>
                            {card.setName}
                          </div>
                        )}
                      </div>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        alignItems: 'end',
                      }}
                    >
                      <button
                        className="secondary"
                        onClick={() => {
                          onSelectManual(card);
                        }}
                        style={{ height: 30 }}
                      >
                        Select
                      </button>
                      <button onClick={() => onGetPrice(card.id)} style={{ height: 30 }}>
                        Get Price
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {manualResults.length > 5 && (
              <button
                className="ghost"
                type="button"
                onClick={onToggleShowAllManual}
                style={{ marginTop: 8, height: 32 }}
                aria-expanded={showAllManualResults}
              >
                {showAllManualResults ? 'Show top 5' : 'Show all'}
              </button>
            )}
          </>
        )}
      </section>

      <section className="panel">
        <h2>Price</h2>
        <div aria-live="polite" aria-atomic="true">
          {!price ? (
            <p className="muted" style={{ marginTop: 10 }}>
              Select a candidate and click Get Price.
            </p>
          ) : (
            <div className="price-grid">
              <div className="price-card">
                <div className="muted" style={{ fontSize: 12 }}>
                  Low ({price.source})
                </div>
                <div className="price-value">
                  {price.low == null ? '-' : `${price.currency} ${price.low}`}
                </div>
              </div>
              <div className="price-card">
                <div className="muted" style={{ fontSize: 12 }}>
                  High ({price.source})
                </div>
                <div className="price-value">
                  {price.high == null ? '-' : `${price.currency} ${price.high}`}
                </div>
              </div>
              <div className="muted" style={{ gridColumn: '1 / -1', fontSize: 12 }}>
                fetchedAt: {price.fetchedAt}
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
