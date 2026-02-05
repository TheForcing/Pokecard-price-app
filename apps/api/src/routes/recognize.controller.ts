import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  CandidateCard,
  Language,
  RecognizeRequest,
  RecognizeResponse,
} from '@pokecard/shared';
import { createHash } from 'crypto';
import Tesseract, { type RecognizeResult } from 'tesseract.js';
import { CardService } from '../services/card.service.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const DEFAULT_TOP_K = 10;
const LOW_CONFIDENCE_THRESHOLD = 0.5;
const OCR_MAX_LINES = 24;
const OCR_MIN_CHARACTERS = 3;
const OCR_TOP_SMALL_RATIO = 0.28;
const OCR_TOP_LARGE_RATIO = 0.45;
const OCR_MID_RATIO = 0.25;

const OCR_LANGUAGE_MAP: Record<Language, string> = {
  EN: 'eng',
  JA: 'jpn+eng',
  KO: 'kor+eng',
};

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

type OcrResult = {
  text: string;
  rawText: string;
  rawLines: string[];
  lines: string[];
  confidence: number;
};

function decodeBase64Image(data: string): { buffer: Buffer; mime?: string } {
  const dataUrlMatch = data.match(/^data:(.+);base64,(.*)$/);
  const base64 = dataUrlMatch ? dataUrlMatch[2] : data;
  const mime = dataUrlMatch ? dataUrlMatch[1] : undefined;
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw new BadRequestException('imageBase64 is invalid');
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new BadRequestException('imageBase64 is too large');
  }
  return { buffer, mime };
}

function normalizeText(value: string): string {
  return value
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
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

function clampRect(rect: OcrRectangle, size: ImageSize): OcrRectangle {
  const left = Math.max(0, Math.min(rect.left, size.width));
  const top = Math.max(0, Math.min(rect.top, size.height));
  const width = Math.max(1, Math.min(rect.width, size.width - left));
  const height = Math.max(1, Math.min(rect.height, size.height - top));
  return { left, top, width, height };
}

function countMatches(value: string, regex: RegExp): number {
  return value.match(regex)?.length ?? 0;
}

function hasLetter(value: string): boolean {
  return /\p{L}/u.test(value);
}

function hasHangul(value: string): boolean {
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
  if (trimmed.length > 30) score -= 0.1;
  if (/\b(hp|vstar|vmax|gx|ex|trainer|energy)\b/i.test(trimmed)) score -= 0.05;
  return score;
}

function rankCandidateLines(lines: string[]) {
  const scored = lines
    .map((line) => ({ line, score: scoreCandidateLine(line) }))
    .filter(({ line, score }) => hasLetter(line) && (isLikelyNameLine(line) || score >= 0.35))
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

function bestLineScore(lines: string[]): number {
  if (lines.length === 0) return -1;
  return Math.max(...lines.map((line) => scoreCandidateLine(line)));
}

function hashImage(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

async function runOcr(
  buffer: Buffer,
  language: Language,
  rectangle?: OcrRectangle,
): Promise<OcrResult> {
  const lang = OCR_LANGUAGE_MAP[language] ?? OCR_LANGUAGE_MAP.EN;
  let result: RecognizeResult;
  try {
    const options = rectangle
      ? ({ rectangle } as unknown as Parameters<typeof Tesseract.recognize>[2])
      : undefined;
    result = await Tesseract.recognize(buffer, lang, options);
  } catch (error) {
    throw new ServiceUnavailableException('ocr request failed');
  }

  const rawText = typeof result.data.text === 'string' ? result.data.text : '';
  const rawLines = (result.data.lines ?? [])
    .map((line: { text: string }) => (typeof line.text === 'string' ? line.text : ''))
    .filter((line: string) => line.length > 0);
  const lines = rawLines
    .map((line: string) => normalizeText(line))
    .filter((line: string) => line.length >= OCR_MIN_CHARACTERS)
    .slice(0, OCR_MAX_LINES);

  return {
    text: normalizeText(rawText),
    rawText,
    rawLines,
    lines,
    confidence: typeof result.data.confidence === 'number' ? result.data.confidence / 100 : 0,
  };
}

function extractCandidateLinesFromOcr(ocr: OcrResult) {
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

function extractCandidateLines(ocrs: OcrResult[]) {
  const combined: string[] = [];
  for (const ocr of ocrs) {
    const lines = extractCandidateLinesFromOcr(ocr);
    if (lines.length > 0) combined.push(...lines);
  }
  if (combined.length === 0) return ocrs[0]?.lines ?? [];
  return rankCandidateLines(combined).slice(0, OCR_MAX_LINES);
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
  const url = new URL('https://api.pokemontcg.io/v2/cards');
  url.searchParams.set('q', `name:"${query}"`);
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
    candidates.push({
      cardId: id,
      name,
      setCode: setCode ?? undefined,
      number: number ?? undefined,
      language,
      confidence: 0.6,
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

function buildCandidatesFromLines(lines: string[], language: Language, baseConfidence: number) {
  const seen = new Set<string>();
  const candidates: CandidateCard[] = [];
  for (const line of lines) {
    const normalized = normalizeText(line);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const cardId = `${language}:${normalized.replace(/\s+/g, '-').toLowerCase()}`;
    candidates.push({
      cardId,
      name: normalized,
      confidence: Math.min(0.9, Math.max(0.2, baseConfidence)),
      language,
    });
  }
  return candidates;
}

@Controller('/recognize')
export class RecognizeController {
  constructor(private readonly cardService: CardService) {}

  @Get('logs')
  getLogs(@Query('limit') limit?: string) {
    const parsed = Number(limit);
    const safeLimit = Number.isFinite(parsed) ? Math.max(1, Math.min(200, parsed)) : 50;
    return {
      count: recognitionLogs.length,
      items: recognitionLogs.slice(-safeLimit).reverse(),
    };
  }

  @Post()
  async recognize(@Body() body: RecognizeRequest): Promise<RecognizeResponse> {
    if (!body?.imageBase64 || typeof body.imageBase64 !== 'string') {
      throw new BadRequestException('imageBase64 is required');
    }
    const startedAt = Date.now();
    const { buffer, mime } = decodeBase64Image(body.imageBase64);
    const hint = body.hint ?? {};
    const language = hint.language ?? 'EN';
    const imageHash = hashImage(buffer);
    const imageSize = getImageSize(buffer);
    const ocr = await runOcr(buffer, language);
    const ocrTopSmall = imageSize
      ? await runOcr(
          buffer,
          language,
          clampRect(
            {
              left: 0,
              top: 0,
              width: imageSize.width,
              height: Math.round(imageSize.height * OCR_TOP_SMALL_RATIO),
            },
            imageSize,
          ),
        )
      : null;
    const ocrTopLarge = imageSize
      ? await runOcr(
          buffer,
          language,
          clampRect(
            {
              left: 0,
              top: 0,
              width: imageSize.width,
              height: Math.round(imageSize.height * OCR_TOP_LARGE_RATIO),
            },
            imageSize,
          ),
        )
      : null;
    const ocrMid = imageSize
      ? await runOcr(
          buffer,
          language,
          clampRect(
            {
              left: 0,
              top: Math.round(imageSize.height * 0.35),
              width: imageSize.width,
              height: Math.round(imageSize.height * OCR_MID_RATIO),
            },
            imageSize,
          ),
        )
      : null;

    const ocrResults = [ocrTopSmall, ocrTopLarge, ocrMid, ocr].filter(Boolean) as OcrResult[];
    let candidateLines = extractCandidateLines(ocrResults);
    let selectedLanguage = language;

    if (language === 'EN') {
      const enScore = bestLineScore(candidateLines);
      const shouldTryKorean = ocr.confidence < 0.35 || candidateLines.length === 0;
      if (shouldTryKorean) {
        const ocrKo = await runOcr(buffer, 'KO');
        const ocrKoTopSmall = imageSize
          ? await runOcr(
              buffer,
              'KO',
              clampRect(
                {
                  left: 0,
                  top: 0,
                  width: imageSize.width,
                  height: Math.round(imageSize.height * OCR_TOP_SMALL_RATIO),
                },
                imageSize,
              ),
            )
          : null;
        const ocrKoTopLarge = imageSize
          ? await runOcr(
              buffer,
              'KO',
              clampRect(
                {
                  left: 0,
                  top: 0,
                  width: imageSize.width,
                  height: Math.round(imageSize.height * OCR_TOP_LARGE_RATIO),
                },
                imageSize,
              ),
            )
          : null;
        const ocrKoMid = imageSize
          ? await runOcr(
              buffer,
              'KO',
              clampRect(
                {
                  left: 0,
                  top: Math.round(imageSize.height * 0.35),
                  width: imageSize.width,
                  height: Math.round(imageSize.height * OCR_MID_RATIO),
                },
                imageSize,
              ),
            )
          : null;
        const koResults = [ocrKoTopSmall, ocrKoTopLarge, ocrKoMid, ocrKo].filter(
          Boolean,
        ) as OcrResult[];
        const koCandidateLines = extractCandidateLines(koResults);
        const koScore = bestLineScore(koCandidateLines);
        const koHasHangul = koCandidateLines.some((line) => hasHangul(line));
        if (koCandidateLines.length > 0 && (koHasHangul || koScore > enScore + 0.05)) {
          candidateLines = koCandidateLines;
          selectedLanguage = 'KO';
        }
      }
    }

    let candidates: CandidateCard[] = [];
    if (selectedLanguage === 'EN' && candidateLines.length > 0) {
      const primaryQuery = candidateLines[0];
      try {
        const result = await fetchPokemonTcgCandidates(
          primaryQuery,
          DEFAULT_TOP_K,
          selectedLanguage,
        );
        if (result.cards.length > 0) {
          const cardMappings = await Promise.all(
            result.cards.map(async (card) => {
              const identity = await this.cardService.upsertFromPokemonTcg(card, selectedLanguage);
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
        } else {
          candidates = result.candidates;
        }
      } catch (error) {
        candidates = [];
      }
    }

    if (candidates.length === 0) {
      candidates = buildCandidatesFromLines(candidateLines, selectedLanguage, ocr.confidence);
    }

    const trimmedCandidates = candidates.slice(0, DEFAULT_TOP_K);

    const best = trimmedCandidates[0];
    const elapsedMs = Date.now() - startedAt;
    const logEntry: RecognitionLogEntry = {
      id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      imageBytes: buffer.length,
      predictedCardId: best?.cardId,
      candidates: trimmedCandidates.map((candidate) => ({
        cardId: candidate.cardId,
        confidence: candidate.confidence,
      })),
      confidence: best?.confidence ?? 0,
      elapsedMs,
      createdAt: new Date().toISOString(),
    };
    recognitionLogs.push(logEntry);

    return {
      best,
      candidates: trimmedCandidates,
      needsUserPick: logEntry.confidence < LOW_CONFIDENCE_THRESHOLD,
      debug: {
        note: 'decode + ocr + candidate search (tcgplayer for EN when available)',
        receivedBytes: body.imageBase64?.length ?? 0,
        decodedBytes: buffer.length,
        mime,
        hint,
        selectedLanguage,
        ocr,
        ocrTopSmall: ocrTopSmall ?? undefined,
        ocrTopLarge: ocrTopLarge ?? undefined,
        ocrMid: ocrMid ?? undefined,
        imageSize,
        candidateLines,
        embedding: {
          topK: trimmedCandidates.length,
          embeddingBytes: buffer.length,
          imageHash,
        },
        logId: logEntry.id,
        confidence: logEntry.confidence,
        isLowConfidence: logEntry.confidence < LOW_CONFIDENCE_THRESHOLD,
        steps: ['decode', 'size-check', 'ocr', 'candidate-search'],
        elapsedMs,
      },
    };
  }
}
