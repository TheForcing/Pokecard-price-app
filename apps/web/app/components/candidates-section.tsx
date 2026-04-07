'use client';

import type { CandidateCard } from '@pokecard/shared';

type CandidatesSectionProps = {
  candidates: CandidateCard[];
  topCandidates: CandidateCard[];
  selected: CandidateCard | null;
  isLowConfidence: boolean;
  onSelect: (candidate: CandidateCard) => void;
  isWatchlisted: (candidate: CandidateCard) => boolean;
  onToggleWatchlist: (candidate: CandidateCard) => void;
  onGetPrice: (candidate: CandidateCard) => void;
};

export function CandidatesSection({
  candidates,
  topCandidates,
  selected,
  isLowConfidence,
  onSelect,
  isWatchlisted,
  onToggleWatchlist,
  onGetPrice,
}: CandidatesSectionProps) {
  return (
    <section className="panel" id="candidates-section" aria-labelledby="candidates-heading">
      <h2 id="candidates-heading">Candidates</h2>
      {isLowConfidence && (
        <p className="warn-text note-text">
          Low confidence. Please verify the candidate.
        </p>
      )}
      {candidates.length === 0 ? (
        <p className="muted empty-state-text">
          Run recognize to see candidates.
        </p>
      ) : (
        <>
          <p className="muted note-text">
            Showing top 3 similar names.
          </p>
          <ul className="card-list">
            {topCandidates.map((candidate, index) => (
              <li
                key={candidate.cardId}
                className={`entity-card ${selected?.cardId === candidate.cardId ? 'selected' : ''}`}
              >
                <div className="card-main-row">
                  <div className="card-main-col">
                    <div className="card-title">
                      {index + 1}. {candidate.name}
                    </div>
                  </div>
                  <div className="card-actions-col">
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => {
                        onSelect(candidate);
                      }}
                    >
                      Select
                    </button>
                    <button
                      type="button"
                      onClick={() => onGetPrice(candidate)}
                    >
                      Get Price
                    </button>
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => onToggleWatchlist(candidate)}
                    >
                      {isWatchlisted(candidate) ? 'Remove Watchlist' : 'Add Watchlist'}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
