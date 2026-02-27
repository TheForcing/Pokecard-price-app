import type { CandidateCard, Language } from '@pokecard/shared';

export const OCR_MAX_LINES = 24;
export const OCR_MIN_CHARACTERS = 3;

const OCR_STOPWORDS: Record<Language, Set<string>> = {
  EN: new Set([
    'hp',
    'basic',
    'stage',
    'vstar',
    'vmax',
    'ex',
    'gx',
    'trainer',
    'energy',
    'pokemon',
    'card',
    'rapid',
    'strike',
    'single',
    'fusion',
  ]),
  JA: new Set(['hp', 'vstar', 'vmax', 'ex', 'gx']),
  KO: new Set(['hp', 'vstar', 'vmax', 'ex', 'gx']),
};

export type OcrResult = {
  text: string;
  rawText: string;
  rawLines: string[];
  lines: string[];
  confidence: number;
};

export function normalizeText(value: string): string {
  return value
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeForMatch(value: string, language: Language): string[] {
  const stopwords = OCR_STOPWORDS[language] ?? OCR_STOPWORDS.EN;
  return normalizeForMatch(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !stopwords.has(token));
}

export function buildQueryVariants(value: string, language: Language): string[] {
  const normalized = normalizeForMatch(value);
  if (!normalized) return [];
  const tokens = tokenizeForMatch(value, language);
  const tokenQuery = tokens.join(' ');
  const variants = new Set<string>();
  if (normalized.length >= 3) variants.add(normalized);
  if (tokenQuery.length >= 3) variants.add(tokenQuery);
  return Array.from(variants);
}

function jaccardScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function similarityScore(query: string, candidate: string, language: Language): number {
  if (!query || !candidate) return 0;
  const queryNorm = normalizeForMatch(query);
  const candidateNorm = normalizeForMatch(candidate);
  if (!queryNorm || !candidateNorm) return 0;
  const queryTokens = tokenizeForMatch(queryNorm, language);
  const candidateTokens = tokenizeForMatch(candidateNorm, language);
  let score = jaccardScore(queryTokens, candidateTokens);
  if (candidateNorm.startsWith(queryNorm)) score += 0.18;
  else if (candidateNorm.includes(queryNorm)) score += 0.1;
  const lengthDelta =
    Math.abs(candidateNorm.length - queryNorm.length) /
    Math.max(candidateNorm.length, queryNorm.length);
  score -= Math.min(0.18, lengthDelta * 0.18);
  return Math.max(0, Math.min(1, score));
}

function countMatches(value: string, regex: RegExp): number {
  return value.match(regex)?.length ?? 0;
}

function hasLetter(value: string): boolean {
  return /\p{L}/u.test(value);
}

export function hasHangul(value: string): boolean {
  return /[\u3131-\u318E\uAC00-\uD7A3]/u.test(value);
}

function isLikelyNameLine(value: string): boolean {
  const letters = countMatches(value, /\p{L}/gu);
  const digits = countMatches(value, /\p{N}/gu);
  const total = letters + digits;
  if (!total) return false;
  if (letters < 2) return false;
  return letters / total >= 0.4;
}

function isStatLine(value: string): boolean {
  const normalized = normalizeForMatch(value);
  if (!normalized) return false;
  return /^hp\s*\d{1,4}$/i.test(normalized);
}

function isDescriptionLine(value: string): boolean {
  const normalized = normalizeForMatch(value);
  if (!normalized) return false;
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length < 6) return false;
  const commonWords = new Set([
    'the',
    'this',
    'that',
    'with',
    'from',
    'into',
    'when',
    'your',
    'it',
    'its',
    'can',
    'is',
    'are',
    'of',
    'to',
    'in',
    'for',
    'on',
  ]);
  const commonCount = tokens.filter((token) => commonWords.has(token)).length;
  return commonCount >= 3;
}

function hasLetterToken(value: string, minLength: number): boolean {
  const tokens = value
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean);
  return tokens.some((token) => /\p{L}/u.test(token) && token.length >= minLength);
}

function scoreCandidateLine(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return -1;
  const letters = countMatches(trimmed, /\p{L}/gu);
  const digits = countMatches(trimmed, /\p{N}/gu);
  const total = letters + digits;
  if (!total) return -1;
  const tokens = trimmed.split(' ').filter(Boolean);
  const shortTokens = tokens.filter((token) => token.length <= 2).length;
  const longTokens = tokens.filter((token) => token.length >= 4).length;
  const letterRatio = letters / total;
  let score = letterRatio;
  score += Math.min(0.3, longTokens * 0.08);
  score -= shortTokens * 0.05;
  score -= digits * 0.02;
  if (tokens.length >= 1 && tokens.length <= 4) score += 0.1;
  if (digits === 0 && tokens.length >= 1 && tokens.length <= 3) score += 0.08;
  if (tokens.length >= 7) score -= 0.25;
  if (trimmed.length > 30) score -= 0.1;
  if (/\b(hp|vstar|vmax|gx|ex|trainer|energy)\b/i.test(trimmed)) score -= 0.05;
  return score;
}

function rankCandidateLines(lines: string[]): string[] {
  const scored = lines
    .map((line) => ({ line, score: scoreCandidateLine(line) }))
    .filter(
      ({ line, score }) =>
        !isStatLine(line) &&
        !isDescriptionLine(line) &&
        hasLetter(line) &&
        hasLetterToken(line, 2) &&
        (isLikelyNameLine(line) || score >= 0.3),
    )
    .sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const ranked: string[] = [];
  for (const { line } of scored) {
    if (seen.has(line)) continue;
    seen.add(line);
    ranked.push(line);
  }
  return ranked;
}

export function bestLineScore(lines: string[]): number {
  if (lines.length === 0) return -1;
  return Math.max(...lines.map((line) => scoreCandidateLine(line)));
}

export function extractCandidateLinesFromOcr(ocr: OcrResult): string[] {
  const normalizedLines = ocr.lines
    .map((line) => normalizeText(line))
    .filter((line) => line.length >= OCR_MIN_CHARACTERS);
  const rankedLines = rankCandidateLines(normalizedLines);
  if (rankedLines.length > 0) return rankedLines.slice(0, OCR_MAX_LINES);

  const fallbackLines = ocr.rawLines
    .map((line) => normalizeText(line))
    .filter((line) => line.length >= OCR_MIN_CHARACTERS);
  const fallbackRankedLines = rankCandidateLines(fallbackLines);
  if (fallbackRankedLines.length > 0) return fallbackRankedLines.slice(0, OCR_MAX_LINES);

  const normalizedText = normalizeText(ocr.rawText);
  if (!normalizedText) return normalizedLines.slice(0, OCR_MAX_LINES);
  const tokenCandidates = normalizedText
    .split(' ')
    .filter((token) => token.length >= OCR_MIN_CHARACTERS)
    .filter((token) => hasLetter(token));
  const rankedTokens = rankCandidateLines(tokenCandidates);
  if (rankedTokens.length > 0) return rankedTokens.slice(0, OCR_MAX_LINES);

  return normalizedLines.slice(0, OCR_MAX_LINES);
}

export function selectBestOcr(ocrs: OcrResult[]): OcrResult | null {
  if (ocrs.length === 0) return null;
  let best = ocrs[0];
  let bestScore = bestLineScore(extractCandidateLinesFromOcr(best));
  let bestConfidence = best.confidence;
  for (const ocr of ocrs.slice(1)) {
    const score = bestLineScore(extractCandidateLinesFromOcr(ocr));
    if (
      score > bestScore + 0.01 ||
      (Math.abs(score - bestScore) <= 0.01 && ocr.confidence > bestConfidence)
    ) {
      best = ocr;
      bestScore = score;
      bestConfidence = ocr.confidence;
    }
  }
  return best;
}

export function extractCandidateLines(ocrs: OcrResult[]): string[] {
  const combined: string[] = [];
  for (const ocr of ocrs) {
    const lines = extractCandidateLinesFromOcr(ocr);
    if (lines.length > 0) combined.push(...lines);
  }
  if (combined.length === 0) return ocrs[0]?.lines ?? [];
  return rankCandidateLines(combined).slice(0, OCR_MAX_LINES);
}

export function buildCandidatesFromLines(
  lines: string[],
  language: Language,
  baseConfidence: number,
): CandidateCard[] {
  const seen = new Set<string>();
  const candidates: CandidateCard[] = [];
  let rank = 0;
  for (const line of lines) {
    const normalized = normalizeText(line);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const rankPenalty = Math.min(0.22, rank * 0.04);
    const confidence = Math.min(0.9, Math.max(0.2, baseConfidence - rankPenalty));
    const cardId = `${language}:${normalized.replace(/\s+/g, '-').toLowerCase()}`;
    candidates.push({
      cardId,
      name: normalized,
      confidence,
      language,
    });
    rank += 1;
  }
  return candidates;
}
