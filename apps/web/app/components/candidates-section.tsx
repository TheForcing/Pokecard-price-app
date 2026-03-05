'use client';

import type { CandidateCard } from '@pokecard/shared';

type CandidatesSectionProps = {
  candidates: CandidateCard[];
  displayedCandidates: CandidateCard[];
  selected: CandidateCard | null;
  isLowConfidence: boolean;
  showAllCandidates: boolean;
  onToggleShowAll: () => void;
  onSelect: (candidate: CandidateCard) => void;
  onGetPrice: (cardId: string) => void;
};

export function CandidatesSection({
  candidates,
  displayedCandidates,
  selected,
  isLowConfidence,
  showAllCandidates,
  onToggleShowAll,
  onSelect,
  onGetPrice,
}: CandidatesSectionProps) {
  return (
    <section className="panel">
      <h2>Candidates</h2>
      {isLowConfidence && (
        <p className="warn-text" style={{ marginTop: 8, fontSize: 12 }}>
          Low confidence. Please verify the candidate.
        </p>
      )}
      {candidates.length === 0 ? (
        <p className="muted" style={{ marginTop: 10 }}>
          Run recognize to see candidates.
        </p>
      ) : (
        <>
          <ul className="card-list">
            {displayedCandidates.map((candidate) => (
              <li
                key={candidate.cardId}
                className={`entity-card ${selected?.cardId === candidate.cardId ? 'selected' : ''}`}
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
                      {candidate.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={candidate.imageUrl}
                          alt={candidate.name}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        'No image'
                      )}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600 }}>{candidate.name}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {candidate.setCode ?? '-'} / {candidate.number ?? '-'} /{' '}
                        {candidate.language ?? '-'}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        confidence: {candidate.confidence.toFixed(2)}
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      alignItems: 'end',
                      marginLeft: 'auto',
                    }}
                  >
                    <button
                      className="secondary"
                      onClick={() => {
                        onSelect(candidate);
                      }}
                    >
                      Select
                    </button>
                    <button
                      onClick={() => onGetPrice(candidate.identityId ?? candidate.cardId)}
                    >
                      Get Price
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {candidates.length > 5 && (
            <button
              className="ghost"
              type="button"
              onClick={onToggleShowAll}
              style={{ marginTop: 8 }}
              aria-expanded={showAllCandidates}
            >
              {showAllCandidates ? 'Show top 5' : 'Show all'}
            </button>
          )}
        </>
      )}
    </section>
  );
}
