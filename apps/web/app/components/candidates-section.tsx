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
    <section style={{ marginTop: 16, border: '1px solid #ddd', borderRadius: 12, padding: 12 }}>
      <h2 style={{ margin: 0, fontSize: 16 }}>Candidates</h2>
      {isLowConfidence && (
        <p style={{ marginTop: 8, color: '#a04500', fontSize: 12 }}>
          Low confidence. Please verify the candidate.
        </p>
      )}
      {candidates.length === 0 ? (
        <p style={{ opacity: 0.7, marginTop: 10 }}>Run recognize to see candidates.</p>
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
            {displayedCandidates.map((candidate) => (
              <li
                key={candidate.cardId}
                style={{
                  border: '1px solid #eee',
                  borderRadius: 10,
                  padding: 10,
                  background: selected?.cardId === candidate.cardId ? '#f7f7ff' : 'white',
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
                      <div style={{ opacity: 0.75, fontSize: 12 }}>
                        {candidate.setCode ?? '-'} / {candidate.number ?? '-'} /{' '}
                        {candidate.language ?? '-'}
                      </div>
                      <div style={{ opacity: 0.75, fontSize: 12 }}>
                        confidence: {candidate.confidence.toFixed(2)}
                      </div>
                    </div>
                  </div>
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'end' }}
                  >
                    <button
                      onClick={() => {
                        onSelect(candidate);
                      }}
                      style={{ height: 30 }}
                    >
                      Select
                    </button>
                    <button
                      onClick={() => onGetPrice(candidate.identityId ?? candidate.cardId)}
                      style={{ height: 30 }}
                    >
                      Get Price
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {candidates.length > 5 && (
            <button type="button" onClick={onToggleShowAll} style={{ marginTop: 8, height: 32 }}>
              {showAllCandidates ? 'Show top 5' : 'Show all'}
            </button>
          )}
        </>
      )}
    </section>
  );
}
