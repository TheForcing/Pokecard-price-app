'use client';

import type { CardIdentity, CardVariant, Language, Market, PriceResponse } from '@pokecard/shared';
import type { CardSearchInput } from '../hooks/use-card-search';

type ManualSearchPriceSectionProps = {
  language: Language;
  manualResults: CardIdentity[];
  displayedManualResults: CardIdentity[];
  manualSelected: CardIdentity | null;
  showAllManualResults: boolean;
  hasSearched: boolean;
  manualLoading: boolean;
  price: PriceResponse | null;
  manualQuery: string;
  manualSetCode: string;
  manualNumber: string;
  manualVariant: CardVariant | '';
  suggestions: CardIdentity[];
  suggestionsLoading: boolean;
  presetNameInput: string;
  selectedPresetId: string;
  savedPresets: SearchPreset[];
  onManualQueryChange: (value: string) => void;
  onManualSetCodeChange: (value: string) => void;
  onManualNumberChange: (value: string) => void;
  onManualVariantChange: (value: CardVariant | '') => void;
  onPresetNameInputChange: (value: string) => void;
  onSelectedPresetIdChange: (value: string) => void;
  onSavePreset: () => void;
  onApplyPreset: () => void;
  onDeletePreset: () => void;
  onSearch: (input: CardSearchInput) => Promise<void> | void;
  onSelectManual: (card: CardIdentity) => void;
  onToggleShowAllManual: () => void;
  isWatchlisted: (card: CardIdentity) => boolean;
  onToggleWatchlist: (card: CardIdentity) => void;
  onGetPrice: (card: CardIdentity) => void;
};

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

export function ManualSearchPriceSection({
  language,
  manualResults,
  displayedManualResults,
  manualSelected,
  showAllManualResults,
  hasSearched,
  manualLoading,
  price,
  manualQuery,
  manualSetCode,
  manualNumber,
  manualVariant,
  suggestions,
  suggestionsLoading,
  presetNameInput,
  selectedPresetId,
  savedPresets,
  onManualQueryChange,
  onManualSetCodeChange,
  onManualNumberChange,
  onManualVariantChange,
  onPresetNameInputChange,
  onSelectedPresetIdChange,
  onSavePreset,
  onApplyPreset,
  onDeletePreset,
  onSearch,
  onSelectManual,
  onToggleShowAllManual,
  isWatchlisted,
  onToggleWatchlist,
  onGetPrice,
}: ManualSearchPriceSectionProps) {
  const manualNameId = 'manual-name';
  const manualSetCodeId = 'manual-set-code';
  const manualNumberId = 'manual-number';
  const manualVariantId = 'manual-variant';
  const manualNameSuggestionId = 'manual-name-suggestions';

  function formatPrice(value: number): string {
    return `${price?.currency ?? ''} ${value}`.trim();
  }

  return (
    <>
      <section className="panel">
        <h2>Manual Search</h2>
        <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          Use this when OCR is uncertain. Search by name + set/number + variant.
        </p>
        <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
          Tip: same Pokemon name can have different prices per variant (Normal/Holo/Reverse Holo).
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10, alignItems: 'end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            Preset Name
            <input
              value={presetNameInput}
              onChange={(event) => onPresetNameInputChange(event.target.value)}
              placeholder="e.g. JP Holo"
            />
          </label>
          <button type="button" className="secondary" onClick={onSavePreset} disabled={!presetNameInput.trim()}>
            Save Preset
          </button>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            Saved Presets
            <select
              value={selectedPresetId}
              onChange={(event) => onSelectedPresetIdChange(event.target.value)}
              aria-label="Saved Presets"
            >
              <option value="">Select preset</option>
              {savedPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name} ({preset.market}/{preset.language})
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={onApplyPreset} disabled={!selectedPresetId}>
            Apply Preset
          </button>
          <button type="button" className="ghost" onClick={onDeletePreset} disabled={!selectedPresetId}>
            Delete Preset
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
          <label
            htmlFor={manualNameId}
            style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            Name
            <input
              id={manualNameId}
              value={manualQuery}
              onChange={(event) => onManualQueryChange(event.target.value)}
              placeholder="Pikachu"
              autoComplete="off"
              list={manualNameSuggestionId}
              aria-describedby={suggestionsLoading ? 'manual-name-suggestion-loading' : undefined}
            />
            <datalist id={manualNameSuggestionId}>
              {suggestions.map((suggestion) => (
                <option
                  key={suggestion.id}
                  value={suggestion.name}
                  label={`${suggestion.name} (${suggestion.setCode} #${suggestion.collectorNumber}, ${suggestion.variant})`}
                />
              ))}
            </datalist>
            {suggestionsLoading && (
              <span id="manual-name-suggestion-loading" className="muted" style={{ fontSize: 12 }}>
                Loading suggestions...
              </span>
            )}
          </label>
          <label
            htmlFor={manualSetCodeId}
            style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            Set Code
            <input
              id={manualSetCodeId}
              value={manualSetCode}
              onChange={(event) => onManualSetCodeChange(event.target.value)}
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
              onChange={(event) => onManualNumberChange(event.target.value)}
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
              onChange={(event) => onManualVariantChange(event.target.value as CardVariant | '')}
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
            style={{ alignSelf: 'end' }}
          >
            {manualLoading ? 'Searching…' : 'Search'}
          </button>
        </div>

        {manualLoading ? (
          <ul className="card-list" aria-label="Manual search loading skeleton" aria-busy="true">
            {Array.from({ length: 3 }).map((_, index) => (
              <li key={index} className="entity-card skeleton-row">
                <div className="skeleton-block skeleton-title" />
                <div className="skeleton-block" />
                <div className="skeleton-block skeleton-short" />
              </li>
            ))}
          </ul>
        ) : manualResults.length === 0 ? (
          <p className="muted" style={{ marginTop: 10 }}>
            {hasSearched
              ? 'No matching cards found. Try name-only search first, then add set/number.'
              : 'No manual results yet.'}
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
                      >
                        Select
                      </button>
                      <button onClick={() => onGetPrice(card)}>
                        Get Price
                      </button>
                      <button
                        className="ghost"
                        type="button"
                        onClick={() => onToggleWatchlist(card)}
                      >
                        {isWatchlisted(card) ? 'Remove Watchlist' : 'Add Watchlist'}
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
                style={{ marginTop: 8 }}
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
                  Lowest Top 3 ({price.source})
                </div>
                {((price.lowTop3 ?? []).length > 0 || price.low != null) && (
                  <ol style={{ margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.5 }}>
                    {(price.lowTop3 ?? (price.low == null ? [] : [price.low])).map((value, index) => (
                      <li key={`${value}-${index}`}>{formatPrice(value)}</li>
                    ))}
                  </ol>
                )}
                {(price.lowTop3 ?? []).length === 0 && price.low == null && <div className="price-value">-</div>}
              </div>
              <div className="price-card">
                <div className="muted" style={{ fontSize: 12 }}>
                  Highest Top 3 ({price.source})
                </div>
                {((price.highTop3 ?? []).length > 0 || price.high != null || price.low != null) && (
                  <ol style={{ margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.5 }}>
                    {(price.highTop3 ??
                      (price.high == null ? (price.low == null ? [] : [price.low]) : [price.high])
                    ).map((value, index) => (
                      <li key={`${value}-${index}`}>{formatPrice(value)}</li>
                    ))}
                  </ol>
                )}
                {(price.highTop3 ?? []).length === 0 && price.high == null && price.low == null && (
                  <div className="price-value">-</div>
                )}
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
