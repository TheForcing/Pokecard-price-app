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
  actionToast: ActionToast | null;
  presetNameInput: string;
  selectedPresetId: string;
  savedPresets: SearchPreset[];
  onManualQueryChange: (value: string) => void;
  onManualSetCodeChange: (value: string) => void;
  onManualNumberChange: (value: string) => void;
  onManualVariantChange: (value: CardVariant | '') => void;
  onPresetNameInputChange: (value: string) => void;
  onSelectedPresetIdChange: (value: string) => void;
  onClearManualFilters: () => void;
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

type ActionToast = {
  kind: 'success' | 'error' | 'info';
  message: string;
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
  actionToast,
  presetNameInput,
  selectedPresetId,
  savedPresets,
  onManualQueryChange,
  onManualSetCodeChange,
  onManualNumberChange,
  onManualVariantChange,
  onPresetNameInputChange,
  onSelectedPresetIdChange,
  onClearManualFilters,
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

  const isBusy = manualLoading;
  const toastClassName =
    actionToast?.kind === 'error'
      ? 'danger-inline'
      : actionToast?.kind === 'success'
        ? 'inline-status'
        : 'inline-status muted';
  const canClearManualFilters =
    manualQuery.trim().length > 0 ||
    manualSetCode.trim().length > 0 ||
    manualNumber.trim().length > 0 ||
    manualVariant !== '' ||
    presetNameInput.trim().length > 0 ||
    selectedPresetId !== '' ||
    hasSearched;

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <h2>Manual Search</h2>
          <span className="section-kicker">Fallback flow</span>
        </div>
        <p className="panel-note">Use this when OCR is uncertain. Search by name + set/number + variant.</p>
        <p className="panel-note">Tip: the same Pokemon can have different prices per variant.</p>
        {actionToast && (
          <div
            role={actionToast.kind === 'error' ? 'alert' : 'status'}
            aria-live={actionToast.kind === 'error' ? 'assertive' : 'polite'}
            className={toastClassName}
          >
            {actionToast.message}
          </div>
        )}
        <div className="form-row-wrap form-row-wrap-end">
          <label className="field field-grow">
            Preset Name
            <input
              value={presetNameInput}
              onChange={(event) => onPresetNameInputChange(event.target.value)}
              placeholder="e.g. JP Holo"
              disabled={isBusy}
            />
          </label>
          <button
            type="button"
            className="secondary"
            onClick={onSavePreset}
            disabled={!presetNameInput.trim() || isBusy}
          >
            Save Preset
          </button>
          <label className="field field-grow">
            Saved Presets
            <select
              value={selectedPresetId}
              onChange={(event) => onSelectedPresetIdChange(event.target.value)}
              aria-label="Saved Presets"
              disabled={isBusy}
            >
              <option value="">Select preset</option>
              {savedPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name} ({preset.market}/{preset.language})
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={onApplyPreset} disabled={!selectedPresetId || isBusy}>
            Apply Preset
          </button>
          <button type="button" className="ghost" onClick={onDeletePreset} disabled={!selectedPresetId || isBusy}>
            Delete Preset
          </button>
        </div>
        <div className="form-row-wrap">
          <label htmlFor={manualNameId} className="field field-grow">
            Name
            <input
              id={manualNameId}
              value={manualQuery}
              onChange={(event) => onManualQueryChange(event.target.value)}
              placeholder="Pikachu"
              autoComplete="off"
              list={manualNameSuggestionId}
              aria-describedby={suggestionsLoading ? 'manual-name-suggestion-loading' : undefined}
              disabled={isBusy}
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
              <span id="manual-name-suggestion-loading" className="muted text-xs">
                Loading suggestions...
              </span>
            )}
          </label>
          <label htmlFor={manualSetCodeId} className="field field-sm">
            Set Code
            <input
              id={manualSetCodeId}
              value={manualSetCode}
              onChange={(event) => onManualSetCodeChange(event.target.value)}
              placeholder="swsh4"
              disabled={isBusy}
            />
          </label>
          <label htmlFor={manualNumberId} className="field field-sm">
            Number
            <input
              id={manualNumberId}
              value={manualNumber}
              onChange={(event) => onManualNumberChange(event.target.value)}
              placeholder="043"
              disabled={isBusy}
            />
          </label>
          <label htmlFor={manualVariantId} className="field field-md">
            Variant
            <select
              id={manualVariantId}
              value={manualVariant}
              onChange={(event) => onManualVariantChange(event.target.value as CardVariant | '')}
              disabled={isBusy}
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
            className="align-self-end"
            disabled={isBusy}
          >
            {manualLoading ? 'Searching…' : 'Search'}
          </button>
          <button
            type="button"
            className="ghost align-self-end"
            onClick={onClearManualFilters}
            disabled={!canClearManualFilters || isBusy}
          >
            Clear Filters
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
          <p className="muted empty-state-text">
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
                  <div className="card-main-row">
                    <div className="card-media-row">
                      <div className="thumb">
                        {card.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={card.imageUrl}
                            alt={card.name}
                            className="thumb-img"
                          />
                        ) : (
                          'No image'
                        )}
                      </div>
                      <div>
                        <div className="card-title">{card.name}</div>
                        <div className="meta-row">
                          <span className="meta-pill">{card.language}</span>
                          <span className="meta-pill">{card.setCode}</span>
                          <span className="meta-pill">#{card.collectorNumber}</span>
                          <span className="meta-pill">{card.variant}</span>
                        </div>
                        {card.setName && (
                          <div className="muted text-xs">
                            {card.setName}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="card-actions-col">
                      <button
                        className="secondary"
                        disabled={isBusy}
                        onClick={() => {
                          onSelectManual(card);
                        }}
                      >
                        Select
                      </button>
                      <button onClick={() => onGetPrice(card)} disabled={isBusy}>
                        Get Price
                      </button>
                      <button
                        className="ghost"
                        type="button"
                        disabled={isBusy}
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
                type="button"
                onClick={onToggleShowAllManual}
                className="ghost top-gap-sm"
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
            <p className="muted empty-state-text">
              Select a candidate and click Get Price.
            </p>
          ) : (
            <div className="price-grid">
              <div className="price-card">
                <div className="muted text-xs">
                  Lowest Top 3 ({price.source})
                </div>
                {((price.lowTop3 ?? []).length > 0 || price.low != null) && (
                  <ol className="top3-list">
                    {(price.lowTop3 ?? (price.low == null ? [] : [price.low])).map((value, index) => (
                      <li key={`${value}-${index}`}>{formatPrice(value)}</li>
                    ))}
                  </ol>
                )}
                {(price.lowTop3 ?? []).length === 0 && price.low == null && <div className="price-value">-</div>}
              </div>
              <div className="price-card">
                <div className="muted text-xs">
                  Highest Top 3 ({price.source})
                </div>
                {((price.highTop3 ?? []).length > 0 || price.high != null || price.low != null) && (
                  <ol className="top3-list">
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
              <div className="muted price-fetched-at">
                fetchedAt: {price.fetchedAt}
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
