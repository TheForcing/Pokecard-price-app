'use client';

import type { SavedCard } from '../types/saved-card';

type CompareCardsSectionProps = {
  compareCards: SavedCard[];
  onGetPrice: (item: SavedCard) => void;
  onRemove: (lookupId: string) => void;
};

export function CompareCardsSection({ compareCards, onGetPrice, onRemove }: CompareCardsSectionProps) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-subtitle">Compare Cards (up to 3)</h2>
        <span className="section-kicker">Quick compare</span>
      </div>
      {compareCards.length === 0 ? (
        <p className="muted empty-state-text">Select a candidate or manual result, then add it to compare.</p>
      ) : (
        <div className="compare-grid">
          {compareCards.map((item) => (
            <article key={item.lookupId} className="entity-card">
              <div className="card-title">{item.name}</div>
              <div className="meta-row">
                <span className="meta-pill">{item.market}</span>
                <span className="meta-pill">{item.language ?? '-'}</span>
                <span className="meta-pill">{item.setCode ?? '-'}</span>
                <span className="meta-pill">#{item.number ?? '-'}</span>
                <span className="meta-pill">{item.variant ?? '-'}</span>
              </div>
              {item.lastPrice ? (
                <div className="top-gap-sm text-xs">
                  <div>
                    {item.lastPrice.currency} low {item.lastPrice.low ?? '-'} / high {item.lastPrice.high ?? '-'}
                  </div>
                  <div className="muted">{item.lastPrice.source}</div>
                </div>
              ) : (
                <div className="muted top-gap-sm text-xs">Price not loaded yet.</div>
              )}
              <div className="card-actions-wrap">
                <button type="button" onClick={() => onGetPrice(item)}>
                  Get Price
                </button>
                <button className="ghost" type="button" onClick={() => onRemove(item.lookupId)}>
                  Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
