import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Header,
  Post,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { CardIdentity as PrismaCardIdentity } from '@prisma/client';
import type {
  CandidateCard,
  Language,
  RecognizeRequest,
  RecognizeResponse,
} from '@pokecard/shared';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import Tesseract, { createWorker, type RecognizeResult } from 'tesseract.js';
import { CardService } from '../services/card.service.js';
import {
  OCR_MAX_LINES,
  OCR_MIN_CHARACTERS,
  bestLineScore,
  buildCandidatesFromLines,
  buildQueryVariants,
  extractCandidateLinesFromOcr,
  extractCandidateLines,
  hasHangul,
  normalizeText,
  selectBestOcr,
  similarityScore,
  type OcrResult,
} from './recognize.text.js';

const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const DEFAULT_TOP_K = 10;
const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.35;
const OCR_NAME_OFFSET_RATIO = 0.12;
const OCR_NAME_HEIGHT_RATIO = 0.22;
const OCR_NAME_LEFT_WIDTH_RATIO = 0.65;
const OCR_NAME_MIN_LEFT_WIDTH = 140;
const OCR_NAME_BANDS = [
  { offsetRatio: 0.02, heightRatio: 0.12 },
  { offsetRatio: 0.05, heightRatio: 0.14 },
  { offsetRatio: 0.09, heightRatio: 0.16 },
  { offsetRatio: 0.13, heightRatio: 0.18 },
];

const OCR_LANGUAGE_MAP: Record<Language, string> = {
  EN: 'eng',
  JA: 'jpn+eng',
  KO: 'kor+eng',
};

const EASYOCR_LANGUAGE_MAP: Record<Language, string> = {
  EN: 'en',
  JA: 'ja',
  KO: 'ko',
};

type OcrPreprocessProfile = 'aggressive' | 'fast';
type OcrNameBandMode = 'always' | 'when-low-confidence' | 'off';
type OcrEnginePolicy = 'easy-first' | 'tesseract-first' | 'tesseract-only';

const EASY_OCR_ACCEPT_CONFIDENCE = 0.42;
const EASY_OCR_ACCEPT_LINE_SCORE = 0.58;
const DEFAULT_OCR_FALLBACK_LOW_CONFIDENCE = 0.38;
const DEFAULT_OCR_FALLBACK_LOW_LINE_SCORE = 0.4;
const DEFAULT_RECOGNITION_CANDIDATE_WEIGHT = 0.75;
const DEFAULT_OCR_CALIBRATION_CONFIDENCE_WEIGHT = 0.45;
const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const POKEMON_SPECIES_ENDPOINT = 'https://pokeapi.co/api/v2/pokemon-species?limit=2000';
const POKEMON_LEXICON_REQUEST_TIMEOUT_MS = 1500;
const POKEMON_LEXICON_MIN_MATCH_SCORE = 0.74;
const GITHUB_SET_BASE_URL =
  'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/cards/en';
const GITHUB_SET_REQUEST_TIMEOUT_MS = 2500;
const COLLECTOR_TOTAL_TO_SET_FILE: Record<number, string> = {
  102: 'base1',
};
const POKEMON_NAME_FALLBACK = [
  'pikachu',
  'charizard',
  'blastoise',
  'venusaur',
  'mew',
  'mewtwo',
  'eevee',
  'snorlax',
  'lucario',
  'gengar',
  'dragonite',
  'rapidash',
];

type TesseractWorkerInstance = Awaited<ReturnType<typeof createWorker>>;
type TesseractRecognizeOptions = {
  rectangle?: OcrRectangle;
};
const tesseractWorkerCache = new Map<string, Promise<TesseractWorkerInstance>>();
const tesseractWorkerQueue = new Map<string, Promise<void>>();

function getTesseractWorker(lang: string): Promise<TesseractWorkerInstance> {
  const cached = tesseractWorkerCache.get(lang);
  if (cached) return cached;
  const created = createWorker(lang);
  tesseractWorkerCache.set(lang, created);
  return created;
}

async function invalidateTesseractWorker(lang: string): Promise<void> {
  const cached = tesseractWorkerCache.get(lang);
  tesseractWorkerCache.delete(lang);
  if (!cached) return;
  try {
    const worker = await cached;
    await worker.terminate();
  } catch (error) {
    return;
  }
}

async function runTesseractJob(
  lang: string,
  job: (worker: TesseractWorkerInstance) => Promise<RecognizeResult>,
): Promise<RecognizeResult> {
  const prev = tesseractWorkerQueue.get(lang) ?? Promise.resolve();
  let release = () => {};
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  tesseractWorkerQueue.set(lang, prev.then(() => next));

  await prev;
  try {
    const worker = await getTesseractWorker(lang);
    return await job(worker);
  } catch (error) {
    await invalidateTesseractWorker(lang);
    throw error;
  } finally {
    release();
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function scoreOcrQuality(ocr: OcrResult): { lineScore: number; calibratedConfidence: number } {
  const lineScore = bestLineScore(extractCandidateLinesFromOcr(ocr));
  const normalizedLineScore = clamp01(lineScore);
  const calibratedConfidence = clamp01(
    ocr.confidence * OCR_CALIBRATION_CONFIDENCE_WEIGHT +
      normalizedLineScore * OCR_CALIBRATION_LINE_WEIGHT,
  );
  return { lineScore, calibratedConfidence };
}

function computeRecognitionConfidence(
  bestCandidateConfidence: number | undefined,
  ocrCalibratedConfidence: number,
): number {
  if (typeof bestCandidateConfidence !== 'number' || !Number.isFinite(bestCandidateConfidence)) {
    return clamp01(ocrCalibratedConfidence);
  }
  return clamp01(
    bestCandidateConfidence * RECOGNITION_CANDIDATE_WEIGHT +
      ocrCalibratedConfidence * RECOGNITION_OCR_WEIGHT,
  );
}

function calibrateRecognitionConfidence(
  rawConfidence: number,
  bestCandidate: CandidateCard | undefined,
  normalizedLineScore: number,
  candidateLineCount: number,
  hasNameSignal: boolean,
): number {
  let adjusted = clamp01(rawConfidence);
  const hasIdentity = Boolean(bestCandidate?.identityId);

  if (!bestCandidate) {
    adjusted *= 0.8;
  }

  if (!hasIdentity) {
    const cap = normalizedLineScore >= 0.65 ? 0.55 : 0.45;
    adjusted = Math.min(adjusted, cap);
  }

  if (!hasIdentity && !hasNameSignal) {
    adjusted = Math.min(adjusted, 0.34);
  }

  if (candidateLineCount === 0) {
    adjusted = Math.min(adjusted, 0.3);
  }

  if (hasIdentity && normalizedLineScore >= 0.55) {
    adjusted = clamp01(adjusted + 0.08);
  }

  if (!hasIdentity && hasNameSignal) {
    adjusted = clamp01(adjusted + 0.04);
  }

  return adjusted;
}

function parseConfidenceThreshold(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp01(parsed);
}

function getLowConfidenceThreshold(): number {
  return parseConfidenceThreshold(
    process.env.RECOGNIZE_LOW_CONFIDENCE_THRESHOLD,
    DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  );
}

function getRecognitionCandidateWeight(): number {
  return parseConfidenceThreshold(
    process.env.RECOGNIZE_CANDIDATE_WEIGHT,
    DEFAULT_RECOGNITION_CANDIDATE_WEIGHT,
  );
}

function getOcrCalibrationConfidenceWeight(): number {
  return parseConfidenceThreshold(
    process.env.OCR_CALIBRATION_CONFIDENCE_WEIGHT,
    DEFAULT_OCR_CALIBRATION_CONFIDENCE_WEIGHT,
  );
}

function getPreprocessProfile(): OcrPreprocessProfile {
  const value = process.env.OCR_PREPROCESS_PROFILE;
  if (value === 'fast') return 'fast';
  return 'aggressive';
}

function getNameBandMode(): OcrNameBandMode {
  const value = process.env.OCR_NAME_BAND_MODE;
  if (value === 'off' || value === 'when-low-confidence') return value;
  return 'always';
}

function getNameBandMaxRects(): number {
  const parsed = Number(process.env.OCR_NAME_BAND_MAX_RECTS);
  if (!Number.isFinite(parsed) || parsed < 1) return 4;
  return Math.max(1, Math.min(6, Math.floor(parsed)));
}

function getEnginePolicy(): OcrEnginePolicy {
  const value = process.env.OCR_ENGINE_POLICY;
  if (value === 'tesseract-first' || value === 'tesseract-only') return value;
  return 'easy-first';
}

function getFallbackLowConfidence(): number {
  return parseConfidenceThreshold(
    process.env.OCR_FALLBACK_LOW_CONFIDENCE,
    DEFAULT_OCR_FALLBACK_LOW_CONFIDENCE,
  );
}

function getFallbackLowLineScore(): number {
  return parseConfidenceThreshold(
    process.env.OCR_FALLBACK_LOW_LINE_SCORE,
    DEFAULT_OCR_FALLBACK_LOW_LINE_SCORE,
  );
}

const OCR_PREPROCESS_PROFILE = getPreprocessProfile();
const OCR_NAME_BAND_MODE = getNameBandMode();
const OCR_NAME_BAND_MAX_RECTS = getNameBandMaxRects();
const OCR_ENGINE_POLICY = getEnginePolicy();
const LOW_CONFIDENCE_THRESHOLD = getLowConfidenceThreshold();
const RECOGNITION_CANDIDATE_WEIGHT = getRecognitionCandidateWeight();
const RECOGNITION_OCR_WEIGHT = 1 - RECOGNITION_CANDIDATE_WEIGHT;
const OCR_CALIBRATION_CONFIDENCE_WEIGHT = getOcrCalibrationConfidenceWeight();
const OCR_CALIBRATION_LINE_WEIGHT = 1 - OCR_CALIBRATION_CONFIDENCE_WEIGHT;
const OCR_FALLBACK_LOW_CONFIDENCE = getFallbackLowConfidence();
const OCR_FALLBACK_LOW_LINE_SCORE = getFallbackLowLineScore();
const MAX_IMAGE_BYTES = parsePositiveInt(process.env.API_MAX_IMAGE_BYTES, DEFAULT_MAX_IMAGE_BYTES);

type RecognitionLogEntry = {
  id: string;
  imageBytes: number;
  predictedCardId?: string;
  candidates: { cardId: string; confidence: number }[];
  confidence: number;
  elapsedMs: number;
  createdAt: string;
};

const recognitionLogs: RecognitionLogEntry[] = [];

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  const safeIndex = Math.max(0, Math.min(sorted.length - 1, index));
  return sorted[safeIndex];
}

function buildConfidenceHistogram(logs: RecognitionLogEntry[]) {
  const buckets = {
    '0.0-0.2': 0,
    '0.2-0.4': 0,
    '0.4-0.6': 0,
    '0.6-0.8': 0,
    '0.8-1.0': 0,
  };
  for (const entry of logs) {
    const confidence = Math.max(0, Math.min(1, entry.confidence));
    if (confidence < 0.2) buckets['0.0-0.2'] += 1;
    else if (confidence < 0.4) buckets['0.2-0.4'] += 1;
    else if (confidence < 0.6) buckets['0.4-0.6'] += 1;
    else if (confidence < 0.8) buckets['0.6-0.8'] += 1;
    else buckets['0.8-1.0'] += 1;
  }
  return buckets;
}

function formatRecognizePrometheusMetrics(logs: RecognitionLogEntry[]): string {
  const elapsed = logs.map((entry) => entry.elapsedMs);
  const count = elapsed.length;
  const avgElapsedMs = count ? elapsed.reduce((acc, value) => acc + value, 0) / count : 0;
  const histogram = buildConfidenceHistogram(logs);
  const lowConfidenceCount = logs.filter(
    (entry) => entry.confidence < LOW_CONFIDENCE_THRESHOLD,
  ).length;
  const lines: string[] = [];

  lines.push('# HELP pokecard_recognize_requests_total Total recognize requests processed');
  lines.push('# TYPE pokecard_recognize_requests_total counter');
  lines.push(`pokecard_recognize_requests_total ${count}`);

  lines.push('# HELP pokecard_recognize_low_confidence_total Low-confidence recognize results');
  lines.push('# TYPE pokecard_recognize_low_confidence_total counter');
  lines.push(`pokecard_recognize_low_confidence_total ${lowConfidenceCount}`);

  lines.push('# HELP pokecard_ocr_confidence_bucket OCR confidence histogram buckets');
  lines.push('# TYPE pokecard_ocr_confidence_bucket gauge');
  for (const [bucket, value] of Object.entries(histogram)) {
    lines.push(`pokecard_ocr_confidence_bucket{bucket="${bucket}"} ${value}`);
  }

  lines.push('# HELP pokecard_recognize_latency_ms Recognition latency summary in milliseconds');
  lines.push('# TYPE pokecard_recognize_latency_ms gauge');
  lines.push(`pokecard_recognize_latency_ms{stat="avg"} ${avgElapsedMs}`);
  lines.push(`pokecard_recognize_latency_ms{stat="p95"} ${percentile(elapsed, 95)}`);
  lines.push(`pokecard_recognize_latency_ms{stat="p99"} ${percentile(elapsed, 99)}`);
  lines.push(`pokecard_recognize_latency_ms{stat="max"} ${count ? Math.max(...elapsed) : 0}`);

  return `${lines.join('\n')}\n`;
}

type ImageSize = {
  width: number;
  height: number;
};

type OcrRectangle = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type CropResult = {
  buffer: Buffer;
  size: ImageSize | null;
  rect?: OcrRectangle;
  method: 'none' | 'auto' | 'contour' | 'perspective';
};

type Point2 = { x: number; y: number };
type CvSize = { width: number; height: number };
type CvContour = {
  area: number;
  arcLength: (closed: boolean) => number;
  approxPolyDP: (epsilon: number, closed: boolean) => CvContour;
  getPoints: () => Point2[];
};
type CvMat = {
  bgrToGray: () => CvMat;
  gaussianBlur: (size: CvSize, sigma: number) => CvMat;
  canny: (threshold1: number, threshold2: number) => CvMat;
  findContours: (mode: number, method: number) => CvContour[];
  warpPerspective: (transform: CvMat, size: CvSize) => CvMat;
};
type OpenCvLike = {
  RETR_EXTERNAL: number;
  CHAIN_APPROX_SIMPLE: number;
  Size: new (width: number, height: number) => CvSize;
  Point2: new (x: number, y: number) => Point2;
  imdecode: (buffer: Buffer) => CvMat;
  imencode: (ext: string, mat: CvMat) => Buffer;
  getPerspectiveTransform: (src: Point2[], dst: Point2[]) => CvMat;
};

const require = createRequire(import.meta.url);

type OcrNameBandSpec = {
  offsetRatio: number;
  heightRatio: number;
};

let pokemonNameLexiconPromise: Promise<string[]> | null = null;
const githubSetCardsCache = new Map<string, Promise<{ id: string; name: string; number?: string }[]>>();

function toDisplayPokemonName(name: string): string {
  return name
    .split('-')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

function getFallbackPokemonLexicon(): string[] {
  return POKEMON_NAME_FALLBACK.map((name) => toDisplayPokemonName(name));
}

async function loadPokemonNameLexicon(): Promise<string[]> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), POKEMON_LEXICON_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(POKEMON_SPECIES_ENDPOINT, {
      headers: { Accept: 'application/json' },
      signal: abortController.signal,
    });
    if (!response.ok) return getFallbackPokemonLexicon();

    const payload = (await response.json()) as unknown;
    if (!payload || typeof payload !== 'object') return getFallbackPokemonLexicon();
    const record = payload as Record<string, unknown>;
    const results = Array.isArray(record.results) ? record.results : [];
    const names = results
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const name = (entry as Record<string, unknown>).name;
        return typeof name === 'string' ? name : null;
      })
      .filter((name): name is string => Boolean(name))
      .map((name) => toDisplayPokemonName(name));

    if (names.length === 0) return getFallbackPokemonLexicon();
    return Array.from(new Set(names));
  } catch (error) {
    return getFallbackPokemonLexicon();
  } finally {
    clearTimeout(timeout);
  }
}

async function getPokemonNameLexicon(): Promise<string[]> {
  if (!pokemonNameLexiconPromise) {
    pokemonNameLexiconPromise = loadPokemonNameLexicon();
  }
  return pokemonNameLexiconPromise;
}

async function loadGitHubSetCards(setFile: string): Promise<{ id: string; name: string; number?: string }[]> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), GITHUB_SET_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${GITHUB_SET_BASE_URL}/${setFile}.json`, {
      headers: { Accept: 'application/json' },
      signal: abortController.signal,
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) return [];
    const cards: { id: string; name: string; number?: string }[] = [];
    for (const entry of payload) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id : null;
      const name = typeof record.name === 'string' ? record.name : null;
      const number = typeof record.number === 'string' ? record.number : undefined;
      if (!id || !name) continue;
      cards.push({ id, name, number });
    }
    return cards;
  } catch (error) {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function getGitHubSetCards(setFile: string): Promise<{ id: string; name: string; number?: string }[]> {
  const cached = githubSetCardsCache.get(setFile);
  if (cached) return cached;
  const promise = loadGitHubSetCards(setFile);
  githubSetCardsCache.set(setFile, promise);
  return promise;
}

function prioritizeCandidateLines(baseLines: string[], preferredLines: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const line of [...preferredLines, ...baseLines]) {
    const normalized = normalizeText(line);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(normalized);
  }
  return merged;
}

function applyPokemonLexiconToLines(
  lines: string[],
  lexicon: string[],
): { lines: string[]; matchedCount: number } {
  const suggestions = lines
    .slice(0, 8)
    .map((line) => {
      let bestName: string | null = null;
      let bestScore = 0;
      for (const name of lexicon) {
        const score = similarityScore(line, name, 'EN');
        if (score > bestScore) {
          bestScore = score;
          bestName = name;
        }
      }
      if (!bestName || bestScore < POKEMON_LEXICON_MIN_MATCH_SCORE) return null;
      return { name: bestName, score: bestScore };
    })
    .filter((entry): entry is { name: string; score: number } => Boolean(entry))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.name);

  return {
    lines: prioritizeCandidateLines(lines, suggestions),
    matchedCount: suggestions.length,
  };
}

type CollectorHint = { collectorNumber: string; collectorTotal?: number };

function extractCollectorHints(lines: string[]): CollectorHint[] {
  const hints: CollectorHint[] = [];
  const seen = new Set<string>();
  const pattern = /(\d{1,3})\s*\/\s*(\d{2,3})/g;
  for (const line of lines) {
    for (const match of line.matchAll(pattern)) {
      const collectorNumber = String(Number(match[1]));
      const collectorTotal = Number(match[2]);
      const key = `${collectorNumber}/${collectorTotal}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hints.push({ collectorNumber, collectorTotal });
    }
  }
  return hints;
}

async function buildCandidatesFromCollectorHints(
  hints: CollectorHint[],
  lines: string[],
  language: Language,
  cardService: CardService,
): Promise<CandidateCard[]> {
  if (hints.length === 0) return [];
  const scoredById = new Map<string, CandidateCard>();
  const lineQueries = lines.slice(0, 4);
  for (const hint of hints) {
    const matches = await cardService.searchCards({
      language,
      collectorNumber: hint.collectorNumber,
      limit: 50,
    });
    for (const card of matches) {
      if (
        typeof hint.collectorTotal === 'number' &&
        Number.isFinite(hint.collectorTotal) &&
        typeof card.collectorTotal === 'number' &&
        card.collectorTotal !== hint.collectorTotal
      ) {
        continue;
      }
      const bestLineScore =
        lineQueries.length > 0
          ? Math.max(...lineQueries.map((line) => similarityScore(line, card.nameNormalized, language)))
          : 0;
      const totalBonus =
        typeof hint.collectorTotal === 'number' &&
        Number.isFinite(hint.collectorTotal) &&
        typeof card.collectorTotal === 'number' &&
        card.collectorTotal === hint.collectorTotal
          ? 0.2
          : 0;
      const confidence = Math.min(0.96, Math.max(0.45, bestLineScore * 0.7 + totalBonus + 0.25));
      const candidate: CandidateCard = {
        cardId: card.id,
        identityId: card.id,
        name: card.name,
        setCode: card.setCode,
        number: card.collectorNumber,
        language,
        variant: card.variant,
        confidence,
        imageUrl: card.imageUrl ?? undefined,
      };
      const existing = scoredById.get(card.id);
      if (!existing || candidate.confidence > existing.confidence) {
        scoredById.set(card.id, candidate);
      }
    }
  }

  return Array.from(scoredById.values()).sort((a, b) => b.confidence - a.confidence);
}

async function buildCandidatesFromGitHubCollectorHints(
  hints: CollectorHint[],
  language: Language,
): Promise<CandidateCard[]> {
  if (language !== 'EN') return [];
  const candidates: CandidateCard[] = [];
  for (const hint of hints) {
    if (typeof hint.collectorTotal !== 'number' || !Number.isFinite(hint.collectorTotal)) continue;
    const setFile = COLLECTOR_TOTAL_TO_SET_FILE[hint.collectorTotal];
    if (!setFile) continue;
    const cards = await getGitHubSetCards(setFile);
    const match = cards.find((card) => {
      if (!card.number) return false;
      const normalizedCardNumber = String(Number(card.number));
      return normalizedCardNumber === hint.collectorNumber;
    });
    if (!match) continue;
    candidates.push({
      cardId: match.id,
      name: match.name,
      setCode: setFile,
      number: hint.collectorNumber,
      language,
      confidence: 0.88,
      imageUrl: `https://images.pokemontcg.io/${setFile}/${hint.collectorNumber}_hires.png`,
    });
  }

  return candidates;
}

function decodeBase64Image(data: string): { buffer: Buffer; mime?: string } {
  const dataUrlMatch = data.match(/^data:(.+);base64,(.*)$/);
  const base64 = dataUrlMatch ? dataUrlMatch[2] : data;
  const mime = dataUrlMatch ? dataUrlMatch[1] : undefined;
  if (mime && !SUPPORTED_IMAGE_MIME_TYPES.has(mime)) {
    throw new BadRequestException('unsupported image mime type');
  }
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw new BadRequestException('imageBase64 is invalid');
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new BadRequestException('imageBase64 is too large');
  }
  return { buffer, mime };
}

async function normalizeImageBuffer(buffer: Buffer): Promise<Buffer> {
  try {
    return await sharp(buffer).rotate().png({ compressionLevel: 9 }).toBuffer();
  } catch (error) {
    throw new BadRequestException('imageBase64 contains invalid image data');
  }
}

async function preprocessForOcr(buffer: Buffer): Promise<Buffer> {
  try {
    if (OCR_PREPROCESS_PROFILE === 'fast') {
      return await sharp(buffer).grayscale().normalize().toBuffer();
    }

    const stats = await sharp(buffer).grayscale().stats();
    const channel = stats.channels[0];
    const mean = channel?.mean ?? 140;
    const stdev = channel?.stdev ?? 45;
    const threshold = Math.round(Math.min(200, Math.max(110, mean + (stdev < 45 ? 5 : 15))));
    return await sharp(buffer)
      .grayscale()
      .normalize()
      .median(1)
      .sharpen()
      .threshold(threshold)
      .toBuffer();
  } catch (error) {
    return buffer;
  }
}

async function downscaleForOcr(buffer: Buffer, maxEdge = 960): Promise<Buffer> {
  try {
    const metadata = await sharp(buffer).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    const longest = Math.max(width, height);
    if (!longest || longest <= maxEdge) return buffer;
    return await sharp(buffer)
      .resize({
        width: width >= height ? maxEdge : undefined,
        height: height > width ? maxEdge : undefined,
        fit: 'inside',
        kernel: sharp.kernel.lanczos3,
      })
      .toBuffer();
  } catch (error) {
    return buffer;
  }
}

async function resolveEasyOcrScript(): Promise<string | null> {
  const fromCwd = path.resolve(process.cwd(), 'scripts', 'run-easyocr.py');
  try {
    await fs.access(fromCwd);
    return fromCwd;
  } catch (error) {
    const fallback = path.resolve(process.cwd(), '..', 'apps', 'api', 'scripts', 'run-easyocr.py');
    try {
      await fs.access(fallback);
      return fallback;
    } catch (fallbackError) {
      return null;
    }
  }
}

function buildOcrResult(rawText: string, rawLines: string[], confidence: number): OcrResult {
  const lines = rawLines
    .map((line: string) => normalizeText(line))
    .filter((line: string) => line.length >= OCR_MIN_CHARACTERS)
    .slice(0, OCR_MAX_LINES);
  return {
    text: normalizeText(rawText),
    rawText,
    rawLines,
    lines,
    confidence,
  };
}

async function runEasyOcr(
  buffer: Buffer,
  language: Language,
  rectangle?: OcrRectangle,
): Promise<OcrResult | null> {
  const python = process.env.EASYOCR_PYTHON;
  if (!python) return null;
  const scriptPath = await resolveEasyOcrScript();
  if (!scriptPath) return null;

  let sourceBuffer = buffer;
  if (rectangle) {
    sourceBuffer = await sharp(buffer)
      .extract({
        left: rectangle.left,
        top: rectangle.top,
        width: rectangle.width,
        height: rectangle.height,
      })
      .toBuffer();
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pokecard-ocr-'));
  const imagePath = path.join(tmpDir, `easyocr-${Date.now()}.png`);
  await fs.writeFile(imagePath, sourceBuffer);

  try {
    const lang = EASYOCR_LANGUAGE_MAP[language] ?? EASYOCR_LANGUAGE_MAP.EN;
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(python, [scriptPath, imagePath, '--lang', lang], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => reject(error));
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `easyocr failed with code ${code}`));
          return;
        }
        resolve(stdout.trim());
      });
    });

    const lines = output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) return null;
    const payload = JSON.parse(lines[lines.length - 1]) as {
      rawText?: string;
      rawLines?: string[];
      confidence?: number;
    };
    const rawText = typeof payload.rawText === 'string' ? payload.rawText : '';
    const rawLines = Array.isArray(payload.rawLines)
      ? payload.rawLines.filter((line) => typeof line === 'string')
      : [];
    const confidence =
      typeof payload.confidence === 'number' && Number.isFinite(payload.confidence)
        ? payload.confidence
        : 0;
    return buildOcrResult(rawText, rawLines, confidence);
  } catch (error) {
    return null;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

function readPngSize(buffer: Buffer): ImageSize | null {
  if (buffer.length < 24) return null;
  if (buffer.readUInt32BE(0) !== 0x89504e47) return null;
  if (buffer.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height) return null;
  return { width, height };
}

function readJpegSize(buffer: Buffer): ImageSize | null {
  if (buffer.length < 4) return null;
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2) return null;
    const isSofMarker =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSofMarker) {
      if (offset + 2 + segmentLength > buffer.length) return null;
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      if (!width || !height) return null;
      return { width, height };
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function getImageSize(buffer: Buffer): ImageSize | null {
  return readPngSize(buffer) ?? readJpegSize(buffer);
}

async function getImageSizeAsync(buffer: Buffer): Promise<ImageSize | null> {
  const known = getImageSize(buffer);
  if (known) return known;
  try {
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height) return null;
    return { width: meta.width, height: meta.height };
  } catch (error) {
    return null;
  }
}

function getOpenCv(): OpenCvLike | null {
  try {
    return require('opencv4nodejs') as OpenCvLike;
  } catch (error) {
    return null;
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getLuminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

async function autoCropCard(buffer: Buffer, size: ImageSize): Promise<CropResult> {
  const maxEdge = 360;
  const scale = Math.min(1, maxEdge / Math.max(size.width, size.height));
  const scaledWidth = Math.max(1, Math.round(size.width * scale));
  const scaledHeight = Math.max(1, Math.round(size.height * scale));
  try {
    const { data, info } = await sharp(buffer)
      .resize(scaledWidth, scaledHeight)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const channels = info.channels;
    let minX = scaledWidth;
    let minY = scaledHeight;
    let maxX = 0;
    let maxY = 0;
    let found = false;
    for (let y = 0; y < scaledHeight; y += 1) {
      for (let x = 0; x < scaledWidth; x += 1) {
        const offset = (y * scaledWidth + x) * channels;
        const r = data[offset] ?? 0;
        const g = data[offset + 1] ?? 0;
        const b = data[offset + 2] ?? 0;
        const lum = getLuminance(r, g, b);
        const saturation = Math.max(r, g, b) - Math.min(r, g, b);
        if (lum < 245 || saturation > 12) {
          found = true;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    if (!found) return { buffer, size, method: 'auto' };
    const boxWidth = maxX - minX;
    const boxHeight = maxY - minY;
    if (boxWidth / scaledWidth < 0.5 || boxHeight / scaledHeight < 0.5) {
      return { buffer, size, method: 'auto' };
    }
    const scaleBack = 1 / scale;
    const padding = Math.round(12 * scaleBack);
    const left = clampNumber(Math.round(minX * scaleBack) - padding, 0, size.width - 1);
    const top = clampNumber(Math.round(minY * scaleBack) - padding, 0, size.height - 1);
    const width = clampNumber(Math.round(boxWidth * scaleBack) + padding * 2, 1, size.width - left);
    const height = clampNumber(
      Math.round(boxHeight * scaleBack) + padding * 2,
      1,
      size.height - top,
    );
    const rect = { left, top, width, height };
    const cropped = await sharp(buffer).extract(rect).toBuffer();
    return { buffer: cropped, size: { width, height }, rect, method: 'auto' };
  } catch (error) {
    return { buffer, size, method: 'auto' };
  }
}

function orderPoints(points: Point2[]): Point2[] {
  const sums = points.map((p) => p.x + p.y);
  const diffs = points.map((p) => p.x - p.y);
  const topLeft = points[sums.indexOf(Math.min(...sums))];
  const bottomRight = points[sums.indexOf(Math.max(...sums))];
  const topRight = points[diffs.indexOf(Math.min(...diffs))];
  const bottomLeft = points[diffs.indexOf(Math.max(...diffs))];
  return [topLeft, topRight, bottomRight, bottomLeft];
}

function distance(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function boundingRectFromPoints(
  points: Point2[],
  size: ImageSize,
  padding: number,
): OcrRectangle | null {
  if (!points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  if (maxX <= minX || maxY <= minY) return null;
  const left = clampNumber(Math.round(minX) - padding, 0, size.width - 1);
  const top = clampNumber(Math.round(minY) - padding, 0, size.height - 1);
  const width = clampNumber(Math.round(maxX - minX) + padding * 2, 1, size.width - left);
  const height = clampNumber(Math.round(maxY - minY) + padding * 2, 1, size.height - top);
  return { left, top, width, height };
}

async function tryPerspectiveCrop(buffer: Buffer): Promise<CropResult | null> {
  const cv = getOpenCv();
  if (!cv) return null;
  try {
    const mat = cv.imdecode(buffer);
    const gray = mat.bgrToGray();
    const blurred = gray.gaussianBlur(new cv.Size(5, 5), 0);
    const edges = blurred.canny(75, 200);
    const contours = edges.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    if (!contours.length) return null;
    const sorted = [...contours].sort((a, b) => b.area - a.area).slice(0, 5);
    let bestQuad: Point2[] | null = null;
    for (const contour of sorted) {
      const peri = contour.arcLength(true);
      const approx = contour.approxPolyDP(peri * 0.02, true);
      const points = approx.getPoints();
      if (points.length === 4) {
        bestQuad = points;
        break;
      }
    }
    if (!bestQuad) return null;
    const [tl, tr, br, bl] = orderPoints(bestQuad);
    const width = Math.max(Math.round(distance(tl, tr)), Math.round(distance(bl, br)));
    const height = Math.max(Math.round(distance(tl, bl)), Math.round(distance(tr, br)));
    if (width < 50 || height < 50) return null;
    const dst = [
      new cv.Point2(0, 0),
      new cv.Point2(width - 1, 0),
      new cv.Point2(width - 1, height - 1),
      new cv.Point2(0, height - 1),
    ];
    const transform = cv.getPerspectiveTransform([tl, tr, br, bl], dst);
    const warped = mat.warpPerspective(transform, new cv.Size(width, height));
    const out = cv.imencode('.jpg', warped);
    return { buffer: out, size: { width, height }, method: 'perspective' };
  } catch (error) {
    return null;
  }
}

async function tryContourCrop(buffer: Buffer, size: ImageSize): Promise<CropResult | null> {
  const cv = getOpenCv();
  if (!cv) return null;
  try {
    const mat = cv.imdecode(buffer);
    const gray = mat.bgrToGray();
    const blurred = gray.gaussianBlur(new cv.Size(5, 5), 0);
    const edges = blurred.canny(75, 200);
    const contours = edges.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    if (!contours.length) return null;
    const sorted = [...contours].sort((a, b) => b.area - a.area).slice(0, 5);
    const padding = Math.round(Math.min(size.width, size.height) * 0.02);
    for (const contour of sorted) {
      const points = contour.getPoints();
      if (points.length < 4) continue;
      const rect = boundingRectFromPoints(points, size, padding);
      if (!rect) continue;
      const areaRatio = (rect.width * rect.height) / (size.width * size.height);
      if (areaRatio < 0.35) continue;
      if (rect.width < 60 || rect.height < 60) continue;
      const cropped = await sharp(buffer).extract(rect).toBuffer();
      return {
        buffer: cropped,
        size: { width: rect.width, height: rect.height },
        rect,
        method: 'contour',
      };
    }
    return null;
  } catch (error) {
    return null;
  }
}

function buildNameBandRects(size: ImageSize): OcrRectangle[] {
  const specs: OcrNameBandSpec[] = OCR_NAME_BANDS.length
    ? OCR_NAME_BANDS
    : [{ offsetRatio: OCR_NAME_OFFSET_RATIO, heightRatio: OCR_NAME_HEIGHT_RATIO }];
  const rects: OcrRectangle[] = [];
  for (const spec of specs) {
    const baseRect = clampRect(
      {
        left: 0,
        top: Math.round(size.height * spec.offsetRatio),
        width: size.width,
        height: Math.round(size.height * spec.heightRatio),
      },
      size,
    );
    rects.push(baseRect);

    const leftWidth = Math.max(
      OCR_NAME_MIN_LEFT_WIDTH,
      Math.round(size.width * OCR_NAME_LEFT_WIDTH_RATIO),
    );
    if (leftWidth < size.width) {
      rects.push(
        clampRect(
          {
            left: 0,
            top: baseRect.top,
            width: leftWidth,
            height: baseRect.height,
          },
          size,
        ),
      );
    }
  }
  return rects;
}

function clampRect(rect: OcrRectangle, size: ImageSize): OcrRectangle {
  const left = Math.max(0, Math.min(rect.left, size.width));
  const top = Math.max(0, Math.min(rect.top, size.height));
  const width = Math.max(1, Math.min(rect.width, size.width - left));
  const height = Math.max(1, Math.min(rect.height, size.height - top));
  return { left, top, width, height };
}

function hashImage(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

async function runOcr(
  buffer: Buffer,
  language: Language,
  rectangle?: OcrRectangle,
  sourceBuffer?: Buffer,
): Promise<OcrResult> {
  const lang = OCR_LANGUAGE_MAP[language] ?? OCR_LANGUAGE_MAP.EN;
  const runTesseract = async (): Promise<OcrResult> => {
    let result: RecognizeResult;
    const options: TesseractRecognizeOptions | undefined = rectangle ? { rectangle } : undefined;
    try {
      result = await runTesseractJob(lang, async (worker) => worker.recognize(buffer, options));
    } catch (error) {
      try {
        const fallbackOptions = options
          ? ({ rectangle: options.rectangle } as unknown as Parameters<typeof Tesseract.recognize>[2])
          : undefined;
        result = await Tesseract.recognize(buffer, lang, fallbackOptions);
      } catch (fallbackError) {
        throw new ServiceUnavailableException('ocr request failed');
      }
    }

    const rawText = typeof result.data.text === 'string' ? result.data.text : '';
    const rawLines = (result.data.lines ?? [])
      .map((line: { text: string }) => (typeof line.text === 'string' ? line.text : ''))
      .filter((line: string) => line.length > 0);
    const confidence =
      typeof result.data.confidence === 'number' ? result.data.confidence / 100 : 0;
    return buildOcrResult(rawText, rawLines, confidence);
  };

  if (OCR_ENGINE_POLICY === 'tesseract-only') {
    return runTesseract();
  }

  if (OCR_ENGINE_POLICY === 'tesseract-first') {
    try {
      return await runTesseract();
    } catch (error) {
      const easyFallback = await runEasyOcr(sourceBuffer ?? buffer, language, rectangle);
      if (easyFallback) return easyFallback;
      throw error;
    }
  }

  const easyResult = await runEasyOcr(sourceBuffer ?? buffer, language, rectangle);
  if (!easyResult) return runTesseract();

  const { lineScore: easyLineScore, calibratedConfidence: easyCalibratedConfidence } =
    scoreOcrQuality(easyResult);
  const isEasyResultReliable =
    easyCalibratedConfidence >= EASY_OCR_ACCEPT_CONFIDENCE ||
    easyLineScore >= EASY_OCR_ACCEPT_LINE_SCORE;

  if (isEasyResultReliable) return easyResult;

  const tesseractResult = await runTesseract();
  return selectBestOcr([easyResult, tesseractResult]) ?? tesseractResult;
}

type PokemonTcgCard = {
  id: string;
  name: string;
  number?: string;
  rarity?: string;
  set?: { id?: string; name?: string; printedTotal?: number | string };
  images?: { small?: string };
};

async function fetchPokemonTcgCandidates(query: string, topK: number, language: Language) {
  const normalizedQuery = normalizeText(query);
  const tokens = normalizedQuery
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  const searchQuery = tokens.length > 0 ? tokens.join(' ') : normalizedQuery;

  const url = new URL('https://api.pokemontcg.io/v2/cards');
  url.searchParams.set('q', `name:${searchQuery}`);
  url.searchParams.set('pageSize', String(topK));

  let response: Response;
  try {
    response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  } catch (error) {
    throw new ServiceUnavailableException('pokemon tcg api request failed');
  }

  if (!response.ok) {
    throw new BadGatewayException(`pokemon tcg api error: ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  if (!payload || typeof payload !== 'object') {
    throw new BadGatewayException('pokemon tcg api invalid response');
  }

  const record = payload as Record<string, unknown>;
  const data = Array.isArray(record.data) ? record.data : [];
  const candidates: CandidateCard[] = [];
  const cards: PokemonTcgCard[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const card = item as Record<string, unknown>;
    const id = typeof card.id === 'string' ? card.id : null;
    const name = typeof card.name === 'string' ? card.name : null;
    const number = typeof card.number === 'string' ? card.number : null;
    const set =
      card.set && typeof card.set === 'object' ? (card.set as Record<string, unknown>) : null;
    const setCode = set && typeof set.id === 'string' ? set.id : null;
    const images =
      card.images && typeof card.images === 'object'
        ? (card.images as Record<string, unknown>)
        : null;
    const imageUrl = images && typeof images.small === 'string' ? images.small : null;
    if (!id || !name) continue;
    const nameSimilarity = similarityScore(query, name, language);
    const candidateConfidence = Math.min(0.92, Math.max(0.35, 0.45 + nameSimilarity * 0.5));
    candidates.push({
      cardId: id,
      name,
      setCode: setCode ?? undefined,
      number: number ?? undefined,
      language,
      confidence: candidateConfidence,
      imageUrl: imageUrl ?? undefined,
    });
    cards.push({
      id,
      name,
      number: number ?? undefined,
      rarity: typeof card.rarity === 'string' ? card.rarity : undefined,
      set: set
        ? {
            id: typeof set.id === 'string' ? set.id : undefined,
            name: typeof set.name === 'string' ? set.name : undefined,
            printedTotal:
              typeof set.printedTotal === 'number' || typeof set.printedTotal === 'string'
                ? set.printedTotal
                : undefined,
          }
        : undefined,
      images: imageUrl ? { small: imageUrl } : undefined,
    });
  }
  return { candidates, cards };
}

type ScoredLocalCandidate = {
  candidate: CandidateCard;
  score: number;
};

async function buildPostProcessedCandidates(
  lines: string[],
  language: Language,
  cardService: CardService,
): Promise<CandidateCard[]> {
  const scoredById = new Map<string, ScoredLocalCandidate>();
  const lineSamples = lines.slice(0, 5);
  for (const line of lineSamples) {
    const queries = buildQueryVariants(line, language);
    for (const query of queries) {
      if (!query) continue;
      const matches: PrismaCardIdentity[] = await cardService.searchCards({
        query,
        language,
        limit: 8,
      });
      for (const card of matches) {
        const score = similarityScore(query, card.nameNormalized, language);
        if (score <= 0) continue;
        const confidence = Math.min(0.95, Math.max(0.35, score));
        const candidate: CandidateCard = {
          cardId: card.id,
          identityId: card.id,
          name: card.name,
          setCode: card.setCode,
          number: card.collectorNumber,
          language,
          variant: card.variant,
          confidence,
          imageUrl: card.imageUrl ?? undefined,
        };
        const existing = scoredById.get(card.id);
        if (!existing || confidence > existing.candidate.confidence) {
          scoredById.set(card.id, { candidate, score: confidence });
        }
      }
    }
  }
  return Array.from(scoredById.values())
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.candidate);
}

function mergeCandidates(primary: CandidateCard[], secondary: CandidateCard[]) {
  const merged = new Map<string, CandidateCard>();
  for (const candidate of [...primary, ...secondary]) {
    const key = candidate.identityId ?? candidate.cardId;
    const existing = merged.get(key);
    if (!existing || candidate.confidence > existing.confidence) {
      merged.set(key, candidate);
    }
  }
  return Array.from(merged.values()).sort((a, b) => b.confidence - a.confidence);
}

@Controller('/recognize')
export class RecognizeController {
  private readonly cardService: CardService;

  constructor(@Inject(CardService) cardService: CardService) {
    this.cardService = cardService;
  }

  @Get('logs')
  getLogs(@Query('limit') limit?: string) {
    const parsed = Number(limit);
    const safeLimit = Number.isFinite(parsed) ? Math.max(1, Math.min(200, parsed)) : 50;
    return {
      count: recognitionLogs.length,
      items: recognitionLogs.slice(-safeLimit).reverse(),
    };
  }

  @Get('metrics')
  getMetrics() {
    const elapsed = recognitionLogs.map((entry) => entry.elapsedMs);
    const count = elapsed.length;
    const avgElapsedMs = count ? elapsed.reduce((acc, value) => acc + value, 0) / count : 0;
    return {
      count,
      confidenceHistogram: buildConfidenceHistogram(recognitionLogs),
      elapsedMs: {
        avg: avgElapsedMs,
        p95: percentile(elapsed, 95),
        p99: percentile(elapsed, 99),
        max: count ? Math.max(...elapsed) : 0,
      },
      lowConfidenceCount: recognitionLogs.filter(
        (entry) => entry.confidence < LOW_CONFIDENCE_THRESHOLD,
      ).length,
    };
  }

  @Get('metrics/prometheus')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  getPrometheusMetrics() {
    return formatRecognizePrometheusMetrics(recognitionLogs);
  }

  @Post()
  async recognize(@Body() body: RecognizeRequest): Promise<RecognizeResponse> {
    if (!body?.imageBase64 || typeof body.imageBase64 !== 'string') {
      throw new BadRequestException('imageBase64 is required');
    }
    const startedAt = Date.now();
    const { buffer: decodedBuffer, mime } = decodeBase64Image(body.imageBase64);
    const buffer = await normalizeImageBuffer(decodedBuffer);
    const hint = body.hint ?? {};
    const language = hint.language ?? 'EN';
    const allowLanguageFallback = !hint.language;
    const imageHash = hashImage(buffer);
    const imageSize = await getImageSizeAsync(buffer);
    const perspective = await tryPerspectiveCrop(buffer);
    const contour = !perspective && imageSize ? await tryContourCrop(buffer, imageSize) : null;
    const cropResult: CropResult = perspective
      ? perspective
      : contour
        ? contour
        : imageSize
          ? await autoCropCard(buffer, imageSize)
          : { buffer, size: null, method: 'none' };
    const ocrSourceBuffer = await downscaleForOcr(cropResult.buffer);
    const ocrBuffer = await preprocessForOcr(ocrSourceBuffer);
    const OCR_ORIGINAL_RECHECK_CONFIDENCE = 0.55;
    const OCR_ORIGINAL_RECHECK_LINE_SCORE = 0.4;
    const runLanguageOcr = async (
      targetLanguage: Language,
      rectangle?: OcrRectangle,
    ): Promise<OcrResult> => {
      const preprocessed = await runOcr(ocrBuffer, targetLanguage, rectangle, ocrSourceBuffer);
      const preprocessedQuality = scoreOcrQuality(preprocessed);
      const shouldRecheckWithOriginal =
        preprocessedQuality.calibratedConfidence < OCR_ORIGINAL_RECHECK_CONFIDENCE ||
        preprocessedQuality.lineScore < OCR_ORIGINAL_RECHECK_LINE_SCORE;
      if (!shouldRecheckWithOriginal) return preprocessed;

      const original = await runOcr(ocrSourceBuffer, targetLanguage, rectangle, ocrSourceBuffer);
      return selectBestOcr([preprocessed, original]) ?? preprocessed;
    };
    const ocrSize = (await getImageSizeAsync(ocrSourceBuffer)) ?? cropResult.size ?? imageSize;
    const ocr = await runLanguageOcr(language);
    const ocrQuality = scoreOcrQuality(ocr);
    const shouldRunNameBand =
      OCR_NAME_BAND_MODE === 'always' ||
      (OCR_NAME_BAND_MODE === 'when-low-confidence' && ocrQuality.calibratedConfidence < 0.45);
    const nameBandRects =
      ocrSize && shouldRunNameBand
        ? buildNameBandRects(ocrSize).slice(0, OCR_NAME_BAND_MAX_RECTS)
        : [];
    const nameBandOcrs = nameBandRects.length
      ? await Promise.all(
          nameBandRects.map((rect) => runLanguageOcr(language, rect)),
        )
      : [];
    const ocrNameBand = selectBestOcr(nameBandOcrs);
    const ocrResults = [ocr, ...nameBandOcrs].filter(Boolean) as OcrResult[];
    const collectorSourceLines = Array.from(
      new Set(
        ocrResults
          .flatMap((entry) => [...entry.lines, ...entry.rawLines])
          .map((line) => normalizeText(line))
          .filter(Boolean),
      ),
    );
    const baseCandidateLines = extractCandidateLines(ocrResults);
    const preferredBandLines = nameBandOcrs.flatMap((entry) => extractCandidateLinesFromOcr(entry));
    let candidateLines = prioritizeCandidateLines(baseCandidateLines, preferredBandLines);
    let hasPokemonLexiconSignal = false;
    const primaryOcr = ocrNameBand ?? selectBestOcr(ocrResults) ?? ocr;
    const primaryOcrQuality = scoreOcrQuality(primaryOcr);
    let selectedLanguage = language;

    if (language === 'EN' && allowLanguageFallback) {
      const enScore = bestLineScore(candidateLines);
      const shouldTryKorean =
        primaryOcrQuality.calibratedConfidence < OCR_FALLBACK_LOW_CONFIDENCE ||
        enScore < OCR_FALLBACK_LOW_LINE_SCORE ||
        candidateLines.length === 0;
      if (shouldTryKorean) {
        const ocrKo = await runLanguageOcr('KO');
        const koNameBandRects =
          ocrSize && shouldRunNameBand
            ? buildNameBandRects(ocrSize).slice(0, OCR_NAME_BAND_MAX_RECTS)
            : [];
        const koNameBandOcrs = koNameBandRects.length
          ? await Promise.all(
              koNameBandRects.map((rect) => runLanguageOcr('KO', rect)),
            )
          : [];
        const koResults = [ocrKo, ...koNameBandOcrs].filter(Boolean) as OcrResult[];
        const koCandidateLines = extractCandidateLines(koResults);
        const koScore = bestLineScore(koCandidateLines);
        const koHasHangul = koCandidateLines.some((line) => hasHangul(line));
        if (koCandidateLines.length > 0 && (koHasHangul || koScore > enScore + 0.05)) {
          candidateLines = koCandidateLines;
          selectedLanguage = 'KO';
        }
      }

      const shouldTryJapanese =
        selectedLanguage === 'EN' &&
        (primaryOcrQuality.calibratedConfidence < OCR_FALLBACK_LOW_CONFIDENCE ||
          enScore < OCR_FALLBACK_LOW_LINE_SCORE ||
          candidateLines.length === 0);
      if (shouldTryJapanese) {
        const ocrJa = await runLanguageOcr('JA');
        const jaNameBandRects =
          ocrSize && shouldRunNameBand
            ? buildNameBandRects(ocrSize).slice(0, OCR_NAME_BAND_MAX_RECTS)
            : [];
        const jaNameBandOcrs = jaNameBandRects.length
          ? await Promise.all(
              jaNameBandRects.map((rect) => runLanguageOcr('JA', rect)),
            )
          : [];
        const jaResults = [ocrJa, ...jaNameBandOcrs].filter(Boolean) as OcrResult[];
        const jaCandidateLines = extractCandidateLines(jaResults);
        const jaScore = bestLineScore(jaCandidateLines);
        if (jaCandidateLines.length > 0 && jaScore > enScore + 0.03) {
          candidateLines = jaCandidateLines;
          selectedLanguage = 'JA';
        }
      }
    }

    if (selectedLanguage === 'EN' && candidateLines.length > 0) {
      const pokemonLexicon = await getPokemonNameLexicon();
      const lexiconResult = applyPokemonLexiconToLines(candidateLines, pokemonLexicon);
      candidateLines = lexiconResult.lines;
      hasPokemonLexiconSignal = lexiconResult.matchedCount > 0;
    }

    const collectorHints = extractCollectorHints(collectorSourceLines);

    let candidates: CandidateCard[] = [];
    if (selectedLanguage === 'EN' && collectorHints.length > 0) {
      candidates = await buildCandidatesFromCollectorHints(
        collectorHints,
        collectorSourceLines,
        selectedLanguage,
        this.cardService,
      );
      if (candidates.length === 0) {
        candidates = await buildCandidatesFromGitHubCollectorHints(collectorHints, selectedLanguage);
      }
    }

    if (selectedLanguage === 'EN' && candidateLines.length > 0 && candidates.length === 0) {
      const queries = candidateLines.slice(0, 3);
      for (const query of queries) {
        try {
          const result = await fetchPokemonTcgCandidates(query, DEFAULT_TOP_K, selectedLanguage);
          if (result.cards.length > 0) {
            const cardMappings = await Promise.all(
              result.cards.map(async (card) => {
                const identity = await this.cardService.upsertFromPokemonTcg(
                  card,
                  selectedLanguage,
                );
                await this.cardService.upsertPokemonTcgMap(card.id, identity.id);
                return { cardId: card.id, identityId: identity.id };
              }),
            );
            const mappingByCardId = new Map(
              cardMappings.map((entry) => [entry.cardId, entry.identityId]),
            );
            candidates = result.candidates.map((candidate) => ({
              ...candidate,
              identityId: mappingByCardId.get(candidate.cardId),
            }));
            break;
          }
          candidates = result.candidates;
        } catch (error) {
          candidates = [];
        }
        if (candidates.length > 0) break;
      }
    }

    if (candidates.length === 0) {
      candidates = buildCandidatesFromLines(
        candidateLines,
        selectedLanguage,
        primaryOcrQuality.calibratedConfidence,
      );
    }

    const postProcessed = await buildPostProcessedCandidates(
      candidateLines,
      selectedLanguage,
      this.cardService,
    );
    if (postProcessed.length > 0) {
      candidates = mergeCandidates(postProcessed, candidates);
    }

    const hasStrongSignal =
      hasPokemonLexiconSignal ||
      collectorHints.length > 0 ||
      candidates.some((candidate) => Boolean(candidate.identityId));
    if (!hasStrongSignal) {
      candidates = candidates.map((candidate, index) => ({
        ...candidate,
        confidence: Math.min(candidate.confidence, Math.max(0.22, 0.34 - index * 0.02)),
      }));
    }

    const trimmedCandidates = candidates.slice(0, DEFAULT_TOP_K);

    const best = trimmedCandidates[0];
    const normalizedLineScore = clamp01(primaryOcrQuality.lineScore);
    const rawRecognitionConfidence = computeRecognitionConfidence(
      best?.confidence,
      primaryOcrQuality.calibratedConfidence,
    );
    const recognitionConfidence = calibrateRecognitionConfidence(
      rawRecognitionConfidence,
      best,
      normalizedLineScore,
      candidateLines.length,
      hasPokemonLexiconSignal,
    );
    const isLowConfidence = recognitionConfidence < LOW_CONFIDENCE_THRESHOLD;
    const elapsedMs = Date.now() - startedAt;
    const logEntry: RecognitionLogEntry = {
      id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      imageBytes: buffer.length,
      predictedCardId: best?.cardId,
      candidates: trimmedCandidates.map((candidate) => ({
        cardId: candidate.cardId,
        confidence: candidate.confidence,
      })),
      confidence: recognitionConfidence,
      elapsedMs,
      createdAt: new Date().toISOString(),
    };
    recognitionLogs.push(logEntry);

    return {
      best,
      candidates: trimmedCandidates,
      needsUserPick: isLowConfidence,
      debug: {
        note: 'decode + ocr + candidate search (tcgplayer for EN when available)',
        receivedBytes: body.imageBase64?.length ?? 0,
        decodedBytes: buffer.length,
        mime,
        hint,
        selectedLanguage,
        ocr,
        ocrQuality,
        ocrNameBand: ocrNameBand ?? undefined,
        imageSize,
        cropRect: cropResult.rect ?? null,
        cropMethod: cropResult.method,
        ocrSize,
        candidateLines,
        embedding: {
          topK: trimmedCandidates.length,
          embeddingBytes: buffer.length,
          imageHash,
        },
        logId: logEntry.id,
        confidence: recognitionConfidence,
        rawConfidence: rawRecognitionConfidence,
        normalizedLineScore,
        isLowConfidence,
        steps: ['decode', 'size-check', 'crop', 'ocr', 'candidate-search'],
        runtimeConfig: {
          preprocessProfile: OCR_PREPROCESS_PROFILE,
          nameBandMode: OCR_NAME_BAND_MODE,
          nameBandMaxRects: OCR_NAME_BAND_MAX_RECTS,
          enginePolicy: OCR_ENGINE_POLICY,
          lowConfidenceThreshold: LOW_CONFIDENCE_THRESHOLD,
          recognizeCandidateWeight: RECOGNITION_CANDIDATE_WEIGHT,
          recognizeOcrWeight: RECOGNITION_OCR_WEIGHT,
          ocrCalibrationConfidenceWeight: OCR_CALIBRATION_CONFIDENCE_WEIGHT,
          ocrCalibrationLineWeight: OCR_CALIBRATION_LINE_WEIGHT,
          fallbackLowConfidence: OCR_FALLBACK_LOW_CONFIDENCE,
          fallbackLowLineScore: OCR_FALLBACK_LOW_LINE_SCORE,
        },
        elapsedMs,
      },
    };
  }
}
