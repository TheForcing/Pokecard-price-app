'use client';

import type { SavedCard } from '../types/saved-card';

type RecentHistorySectionProps = {
  recentHistory: SavedCard[];
  isWatchlistedById: (lookupId: string) => boolean;
  onGetPrice: (item: SavedCard) => void;
  onToggleWatchlist: (item: SavedCard) => void;
  getLowPriceDiff: (lastPrice?: SavedCard['lastPrice']) => number | null;
  formatLowPriceDiff: (diff: number) => string;
};

export function RecentHistorySection({
  recentHistory,
  isWatchlistedById,
  onGetPrice,
  onToggleWatchlist,
  getLowPriceDiff,
  formatLowPriceDiff,
}: RecentHistorySectionProps) {
  return (
    <section className="panel" aria-labelledby="recent-history-heading">
      <div className="panel-header">
        <h2 id="recent-history-heading" className="panel-subtitle">
          Recent Price Checks
        </h2>
        <span className="section-kicker">History</span>
      </div>
      {recentHistory.length === 0 ? (
        <p className="muted empty-state-text">
          No recent checks yet. Price checks from candidates or manual results will appear here.
        </p>
      ) : (
        <ul className="card-list">
          {recentHistory.map((item) => {
            const lowDiff = getLowPriceDiff(item.lastPrice);
            const isWatchlisted = isWatchlistedById(item.lookupId);
            const watchlistActionLabel = `${isWatchlisted ? 'Remove' : 'Add'} ${item.name} ${isWatchlisted ? 'from' : 'to'} watchlist`;
            return (
              <li key={item.lookupId} className="entity-card">
                <div className="card-main-row">
                  <div className="card-main-col">
                    <div className="card-title">{item.name}</div>
                    <div className="muted text-xs">Last checked at {item.viewedAt}</div>
                    {item.lastPrice && (
                      <div className="muted text-xs card-price-meta">
                        {item.lastPrice.currency} low {item.lastPrice.low ?? '-'} / high{' '}
                        {item.lastPrice.high ?? '-'} ({item.lastPrice.source})
                      </div>
                    )}
                    {lowDiff !== null && (
                      <div className={`status-pill ${lowDiff <= 0 ? 'good' : 'warn'}`}>
                        {formatLowPriceDiff(lowDiff)}
                      </div>
                    )}
                  </div>
                  <div className="card-actions-row">
                    <button
                      type="button"
                      onClick={() => onGetPrice(item)}
                      aria-label={`Recheck price for ${item.name}`}
                    >
                      Recheck Price
                    </button>
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => onToggleWatchlist(item)}
                      aria-label={watchlistActionLabel}
                    >
                      {isWatchlisted ? 'Remove Watchlist' : 'Add Watchlist'}
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
