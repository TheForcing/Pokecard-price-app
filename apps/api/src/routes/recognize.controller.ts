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
import { createRequire } from 'module';
import sharp from 'sharp';
import Tesseract, { type RecognizeResult } from 'tesseract.js';
import { CardService } from '../services/card.service.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const DEFAULT_TOP_K = 10;
const LOW_CONFIDENCE_THRESHOLD = 0.5;
const OCR_MAX_LINES = 24;
const OCR_MIN_CHARACTERS = 3;
const OCR_NAME_OFFSET_RATIO = 0.12;
const OCR_NAME_HEIGHT_RATIO = 0.22;
const OCR_NAME_BANDS = [
  { offsetRatio: 0.08, heightRatio: 0.18 },
  { offsetRatio: 0.12, heightRatio: 0.22 },
  { offsetRatio: 0.16, heightRatio: 0.18 },
];

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

type OcrResult = {
  text: string;
  rawText: string;
  rawLines: string[];
  lines: string[];
  confidence: number;
};

type OcrNameBandSpec = {
  offsetRatio: number;
  heightRatio: number;
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

async function preprocessForOcr(buffer: Buffer): Promise<Buffer> {
  try {
    return await sharp(buffer).grayscale().normalize().sharpen().threshold(170).toBuffer();
  } catch (error) {
    return buffer;
  }
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
  return specs.map((spec) =>
    clampRect(
      {
        left: 0,
        top: Math.round(size.height * spec.offsetRatio),
        width: size.width,
        height: Math.round(size.height * spec.heightRatio),
      },
      size,
    ),
  );
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

function hasAlphaToken(value: string, minLength: number) {
  const tokens = value
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean);
  return tokens.some((token) => /[A-Za-z]/.test(token) && token.length >= minLength);
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
    .filter(
      ({ line, score }) =>
        hasLetter(line) && hasAlphaToken(line, 3) && (isLikelyNameLine(line) || score >= 0.35),
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

function selectBestOcr(ocrs: OcrResult[]): OcrResult | null {
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
    const ocrBuffer = await preprocessForOcr(cropResult.buffer);
    const ocrSize = cropResult.size ?? imageSize;
    const ocr = await runOcr(ocrBuffer, language);
    const nameBandRects = ocrSize ? buildNameBandRects(ocrSize) : [];
    const nameBandOcrs = nameBandRects.length
      ? await Promise.all(nameBandRects.map((rect) => runOcr(ocrBuffer, language, rect)))
      : [];
    const ocrNameBand = selectBestOcr(nameBandOcrs);
    const ocrResults = [ocrNameBand ?? ocr].filter(Boolean) as OcrResult[];
    let candidateLines = extractCandidateLines(ocrResults);
    let selectedLanguage = language;

    if (language === 'EN' && allowLanguageFallback) {
      const enScore = bestLineScore(candidateLines);
      const shouldTryKorean = ocr.confidence < 0.35 || candidateLines.length === 0;
      if (shouldTryKorean) {
        const ocrKo = await runOcr(ocrBuffer, 'KO');
        const koNameBandRects = ocrSize ? buildNameBandRects(ocrSize) : [];
        const koNameBandOcrs = koNameBandRects.length
          ? await Promise.all(koNameBandRects.map((rect) => runOcr(ocrBuffer, 'KO', rect)))
          : [];
        const ocrKoNameBand = selectBestOcr(koNameBandOcrs);
        const koResults = [ocrKoNameBand ?? ocrKo].filter(Boolean) as OcrResult[];
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
        confidence: logEntry.confidence,
        isLowConfidence: logEntry.confidence < LOW_CONFIDENCE_THRESHOLD,
        steps: ['decode', 'size-check', 'crop', 'ocr', 'candidate-search'],
        elapsedMs,
      },
    };
  }
}
