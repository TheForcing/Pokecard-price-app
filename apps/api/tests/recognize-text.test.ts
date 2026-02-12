import { describe, expect, it } from 'vitest';
import {
  buildCandidatesFromLines,
  buildQueryVariants,
  extractCandidateLines,
  hasHangul,
  normalizeText,
  selectBestOcr,
  similarityScore,
  type OcrResult,
} from '../src/routes/recognize.text.js';

function makeOcr(input: Partial<OcrResult>): OcrResult {
  return {
    text: input.text ?? '',
    rawText: input.rawText ?? '',
    rawLines: input.rawLines ?? [],
    lines: input.lines ?? [],
    confidence: input.confidence ?? 0,
  };
}

describe('recognize text helpers', () => {
  it('normalizes noisy OCR text', () => {
    expect(normalizeText('  Pikachu!!!  ex  ')).toBe('Pikachu ex');
  });

  it('builds query variants with normalized and tokenized forms', () => {
    const variants = buildQueryVariants('Pikachu VMAX', 'EN');
    expect(variants).toContain('pikachu vmax');
    expect(variants).toContain('pikachu');
  });

  it('scores similar names higher than unrelated names', () => {
    const close = similarityScore('Pikachu', 'Pikachu ex', 'EN');
    const far = similarityScore('Pikachu', 'Bulbasaur', 'EN');
    expect(close).toBeGreaterThan(far);
    expect(close).toBeGreaterThan(0.2);
  });

  it('extracts and ranks likely card-name lines', () => {
    const lines = extractCandidateLines([
      makeOcr({
        rawText: 'Pikachu HP 60',
        rawLines: ['HP 60', 'Pikachu', 'Thunder Jolt'],
        lines: ['HP 60', 'Pikachu', 'Thunder Jolt'],
        confidence: 0.7,
      }),
    ]);
    expect(lines).toContain('Pikachu');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines).not.toContain('HP 60');
  });

  it('selects better OCR result by line quality then confidence', () => {
    const best = selectBestOcr([
      makeOcr({ lines: ['HP 60', 'Energy'], confidence: 0.95 }),
      makeOcr({ lines: ['Pikachu', 'Thunder Jolt'], confidence: 0.6 }),
    ]);
    expect(best?.lines).toContain('Pikachu');
  });

  it('builds deduplicated candidates from lines', () => {
    const candidates = buildCandidatesFromLines(['Pikachu', 'Pikachu', 'Charizard'], 'EN', 0.8);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].cardId.startsWith('EN:')).toBe(true);
  });

  it('detects Hangul presence', () => {
    expect(hasHangul('피카츄')).toBe(true);
    expect(hasHangul('Pikachu')).toBe(false);
  });
});
