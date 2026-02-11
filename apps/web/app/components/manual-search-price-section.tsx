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
  const [manualQuery, setManualQuery] = useState('');
  const [manualSetCode, setManualSetCode] = useState('');
  const [manualNumber, setManualNumber] = useState('');
  const [manualVariant, setManualVariant] = useState<CardVariant | ''>('');

  return (
    <>
      <section style={{ marginTop: 16, border: '1px solid #ddd', borderRadius: 12, padding: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Manual Search</h2>
        <p style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
          Use this when OCR is uncertain. Search by name + set/number + variant.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            Name
            <input
              value={manualQuery}
              onChange={(event) => setManualQuery(event.target.value)}
              placeholder="Pikachu"
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            Set Code
            <input
              value={manualSetCode}
              onChange={(event) => setManualSetCode(event.target.value)}
              placeholder="swsh4"
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            Number
            <input
              value={manualNumber}
              onChange={(event) => setManualNumber(event.target.value)}
              placeholder="043"
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            Variant
            <select
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
          <p style={{ marginTop: 10, opacity: 0.7 }}>No manual results yet.</p>
        ) : (
          <>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                marginTop: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {displayedManualResults.map((card) => (
                <li
                  key={card.id}
                  style={{
                    border: '1px solid #eee',
                    borderRadius: 10,
                    padding: 10,
                    background: manualSelected?.id === card.id ? '#f7f7ff' : 'white',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <div
                        style={{
                          width: 64,
                          height: 88,
                          borderRadius: 8,
                          border: '1px solid #eee',
                          background: '#fafafa',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          overflow: 'hidden',
                          color: '#999',
                          fontSize: 11,
                        }}
                      >
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
                        <div style={{ opacity: 0.75, fontSize: 12 }}>
                          {card.language} / {card.setCode} / {card.collectorNumber} / {card.variant}
                        </div>
                        {card.setName && (
                          <div style={{ opacity: 0.7, fontSize: 12 }}>{card.setName}</div>
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
                type="button"
                onClick={onToggleShowAllManual}
                style={{ marginTop: 8, height: 32 }}
              >
                {showAllManualResults ? 'Show top 5' : 'Show all'}
              </button>
            )}
          </>
        )}
      </section>

      <section style={{ marginTop: 16, border: '1px solid #ddd', borderRadius: 12, padding: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Price</h2>
        {!price ? (
          <p style={{ opacity: 0.7, marginTop: 10 }}>Select a candidate and click Get Price.</p>
        ) : (
          <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ border: '1px solid #eee', borderRadius: 10, padding: 10 }}>
              <div style={{ opacity: 0.75, fontSize: 12 }}>Low ({price.source})</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>
                {price.low == null ? '-' : `${price.currency} ${price.low}`}
              </div>
            </div>
            <div style={{ border: '1px solid #eee', borderRadius: 10, padding: 10 }}>
              <div style={{ opacity: 0.75, fontSize: 12 }}>High ({price.source})</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>
                {price.high == null ? '-' : `${price.currency} ${price.high}`}
              </div>
            </div>
            <div style={{ gridColumn: '1 / -1', opacity: 0.75, fontSize: 12 }}>
              fetchedAt: {price.fetchedAt}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
