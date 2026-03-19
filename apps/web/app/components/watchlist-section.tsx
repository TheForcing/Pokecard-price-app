'use client';

import type { SavedCard, WatchlistSort } from '../types/saved-card';

type WatchlistSectionProps = {
  watchlist: SavedCard[];
  sortedWatchlist: SavedCard[];
  watchlistSort: WatchlistSort;
  onWatchlistSortChange: (next: WatchlistSort) => void;
  onGetPrice: (item: SavedCard) => void;
  onToggleWatchlist: (item: SavedCard) => void;
  onSetGoalPrice: (lookupId: string, value: string) => void;
  getLowPriceDiff: (lastPrice?: SavedCard['lastPrice']) => number | null;
  formatLowPriceDiff: (diff: number) => string;
};

export function WatchlistSection({
  watchlist,
  sortedWatchlist,
  watchlistSort,
  onWatchlistSortChange,
  onGetPrice,
  onToggleWatchlist,
  onSetGoalPrice,
  getLowPriceDiff,
  formatLowPriceDiff,
}: WatchlistSectionProps) {
  return (
    <section className="panel" aria-labelledby="watchlist-heading">
      <div className="panel-header">
        <h2 id="watchlist-heading" className="panel-subtitle">
          Watchlist
        </h2>
        <span className="section-kicker">Tracking</span>
        <label className="inline-control">
          Sort
          <select
            value={watchlistSort}
            onChange={(event) => onWatchlistSortChange(event.target.value as WatchlistSort)}
            aria-label="Watchlist sort"
          >
            <option value="newest">Recently added</option>
            <option value="name-asc">Name (A-Z)</option>
          </select>
        </label>
      </div>
      {watchlist.length === 0 ? (
        <p className="muted empty-state-text">No cards in watchlist yet. Add cards from candidates or manual results.</p>
      ) : (
        <ul className="card-list">
          {sortedWatchlist.map((item) => {
            const lowDiff = getLowPriceDiff(item.lastPrice);
            const isTargetReached =
              typeof item.goalPrice === 'number' &&
              !!item.lastPrice &&
              item.lastPrice.low !== null &&
              item.lastPrice.low <= item.goalPrice;

            return (
              <li key={item.lookupId} className="entity-card">
                <div className="card-main-row">
                  <div className="card-main-col">
                    <div className="card-title">{item.name}</div>
                    <div className="meta-row">
                      <span className="meta-pill">{item.market}</span>
                      <span className="meta-pill">{item.language ?? '-'}</span>
                      <span className="meta-pill">{item.setCode ?? '-'}</span>
                      <span className="meta-pill">#{item.number ?? '-'}</span>
                      <span className="meta-pill">{item.variant ?? '-'}</span>
                    </div>
                    {item.lastPrice && (
                      <div className="panel-note-tight card-price-meta">
                        {item.lastPrice.currency} low {item.lastPrice.low ?? '-'} / high {item.lastPrice.high ?? '-'} (
                        {item.lastPrice.source})
                      </div>
                    )}
                    <div className="inline-meta-actions">
                      <label className="inline-control">
                        Target Price
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          inputMode="decimal"
                          defaultValue={item.goalPrice ?? ''}
                          onBlur={(event) => onSetGoalPrice(item.lookupId, event.target.value)}
                          aria-label={`Target price for ${item.name}`}
                          className="target-input"
                        />
                      </label>
                      {typeof item.goalPrice === 'number' && item.lastPrice && (
                        <span className={`status-pill ${isTargetReached ? 'good' : 'warn'}`}>
                          {isTargetReached ? 'Target reached' : 'Above target'}
                        </span>
                      )}
                      {lowDiff !== null && (
                        <span className={`status-pill ${lowDiff <= 0 ? 'good' : 'warn'}`}>
                          {formatLowPriceDiff(lowDiff)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="card-actions-row">
                    <button
                      type="button"
                      onClick={() => onGetPrice(item)}
                      aria-label={`Refresh price for ${item.name}`}
                    >
                      Refresh Price
                    </button>
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => onToggleWatchlist(item)}
                      aria-label={`Remove ${item.name} from watchlist`}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
