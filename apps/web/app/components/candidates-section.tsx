'use client';

import type { CandidateCard } from '@pokecard/shared';

type CandidatesSectionProps = {
  candidates: CandidateCard[];
  topCandidates: CandidateCard[];
  selected: CandidateCard | null;
  isLowConfidence: boolean;
  onSelect: (candidate: CandidateCard) => void;
  onGetPrice: (cardId: string) => void;
};

export function CandidatesSection({
  candidates,
  topCandidates,
  selected,
  isLowConfidence,
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
          <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            Showing top 3 similar names.
          </p>
          <ul className="card-list" style={{ marginTop: 10 }}>
            {topCandidates.map((candidate, index) => (
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
                  <div style={{ minWidth: 220 }}>
                    <div style={{ fontWeight: 600 }}>
                      {index + 1}. {candidate.name}
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
                      type="button"
                      onClick={() => {
                        onSelect(candidate);
                      }}
                    >
                      Select
                    </button>
                    <button
                      type="button"
                      onClick={() => onGetPrice(candidate.identityId ?? candidate.cardId)}
                    >
                      Get Price
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
