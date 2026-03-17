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
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-subtitle">Recent Price Checks</h2>
        <span className="section-kicker">History</span>
      </div>
      {recentHistory.length === 0 ? (
        <p className="muted empty-state-text">
          No recent checks yet. Prices fetched from candidates/manual search will appear here.
        </p>
      ) : (
        <ul className="card-list">
          {recentHistory.map((item) => {
            const lowDiff = getLowPriceDiff(item.lastPrice);
            return (
              <li key={item.lookupId} className="entity-card">
                <div className="card-main-row">
                  <div className="card-main-col">
                    <div className="card-title">{item.name}</div>
                    <div className="muted text-xs">Last checked: {item.viewedAt}</div>
                    {item.lastPrice && (
                      <div className="muted text-xs">
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
                    <button type="button" onClick={() => onGetPrice(item)}>
                      Recheck Price
                    </button>
                    <button className="ghost" type="button" onClick={() => onToggleWatchlist(item)}>
                      {isWatchlistedById(item.lookupId) ? 'Remove Watchlist' : 'Add Watchlist'}
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
