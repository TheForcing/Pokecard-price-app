import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import type {
  CardIdentity,
  CardSearchResponse,
  CardVariant,
  Language,
  Market,
  PriceResponse,
  PriceType,
  UpsertPriceRequest,
} from '@pokecard/shared';
import { CardService } from '../services/card.service.js';
import { PriceService } from '../services/price.service.js';

type CardIdentityRecord = NonNullable<Awaited<ReturnType<CardService['getCardIdentity']>>>;

const ALLOWED_MARKETS: Market[] = ['US', 'JP', 'KR'];
const ALLOWED_PRICE_TYPES: PriceType[] = ['LISTING', 'AGGREGATED', 'SOLD'];
const ALLOWED_SOURCES: UpsertPriceRequest['source'][] = [
  'POKEMONTCG',
  'TCGPLAYER',
  'RAKUTEN',
  'NAVER',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isValidIsoDateTimeString(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function parseUpsertPricePayload(body: unknown): UpsertPriceRequest {
  if (!isRecord(body)) {
    throw new BadRequestException('request body is required');
  }

  const { market, currency, low, high, source, priceType, capturedAt, externalId, externalUrl } =
    body;
  const matchMethod = body.matchMethod;
  const matchConfidence = body.matchConfidence;

  if (typeof market !== 'string' || !ALLOWED_MARKETS.includes(market as Market)) {
    throw new BadRequestException('invalid market');
  }
  if (
    typeof source !== 'string' ||
    !ALLOWED_SOURCES.includes(source as UpsertPriceRequest['source'])
  ) {
    throw new BadRequestException('source is required');
  }
  if (typeof currency !== 'string' || currency.trim().length === 0) {
    throw new BadRequestException('currency is required');
  }
  if (!isNullableNumber(low)) {
    throw new BadRequestException('low must be a number or null');
  }
  if (!isNullableNumber(high)) {
    throw new BadRequestException('high must be a number or null');
  }
  if (
    priceType != null &&
    (typeof priceType !== 'string' || !ALLOWED_PRICE_TYPES.includes(priceType as PriceType))
  ) {
    throw new BadRequestException('invalid priceType');
  }
  if (
    capturedAt != null &&
    (typeof capturedAt !== 'string' || !isValidIsoDateTimeString(capturedAt))
  ) {
    throw new BadRequestException('capturedAt must be a valid ISO datetime string');
  }
  if (externalId != null && typeof externalId !== 'string') {
    throw new BadRequestException('externalId must be a string');
  }
  if (externalUrl != null && typeof externalUrl !== 'string') {
    throw new BadRequestException('externalUrl must be a string');
  }
  if (matchMethod != null && typeof matchMethod !== 'string') {
    throw new BadRequestException('matchMethod must be a string');
  }
  if (
    matchConfidence != null &&
    (typeof matchConfidence !== 'number' ||
      !Number.isFinite(matchConfidence) ||
      matchConfidence < 0 ||
      matchConfidence > 1)
  ) {
    throw new BadRequestException('matchConfidence must be a number between 0 and 1');
  }

  return {
    market: market as Market,
    source: source as UpsertPriceRequest['source'],
    currency: currency.trim(),
    low,
    high,
    ...(priceType != null ? { priceType: priceType as PriceType } : {}),
    ...(capturedAt != null ? { capturedAt } : {}),
    ...(externalId != null ? { externalId } : {}),
    ...(externalUrl != null ? { externalUrl } : {}),
    ...(matchMethod != null ? { matchMethod } : {}),
    ...(matchConfidence != null ? { matchConfidence } : {}),
  };
}

function toCardIdentityDto(card: CardIdentityRecord): CardIdentity {
  return {
    id: card.id,
    name: card.name,
    language: card.language as CardIdentity['language'],
    setCode: card.setCode,
    setName: card.setName ?? undefined,
    collectorNumber: card.collectorNumber,
    collectorTotal: card.collectorTotal ?? undefined,
    variant: card.variant as CardIdentity['variant'],
    rarity: card.rarity ?? undefined,
    imageUrl: card.imageUrl ?? undefined,
  };
}

@Controller('/cards')
export class PricesController {
  private readonly priceService: PriceService;
  private readonly cardService: CardService;

  constructor(
    @Inject(PriceService) priceService: PriceService,
    @Inject(CardService) cardService: CardService,
  ) {
    this.priceService = priceService;
    this.cardService = cardService;
  }

  @Get('search')
  async search(
    @Query('q') query?: string,
    @Query('language') language?: Language,
    @Query('setCode') setCode?: string,
    @Query('number') collectorNumber?: string,
    @Query('variant') variant?: CardVariant,
    @Query('limit') limit?: string,
  ): Promise<CardSearchResponse> {
    const parsedLimit = Number(limit);
    const items = await this.cardService.searchCards({
      query,
      language,
      setCode,
      collectorNumber,
      variant,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    });
    return { items: items.map(toCardIdentityDto) };
  }

  @Get(':cardId/prices')
  async prices(
    @Param('cardId') cardId: string,
    @Query('market') marketQuery?: Market,
  ): Promise<PriceResponse> {
    if (marketQuery && !ALLOWED_MARKETS.includes(marketQuery)) {
      throw new BadRequestException('invalid market');
    }
    const market: Market = marketQuery ?? 'US';
    return this.priceService.getPrice(cardId, market);
  }

  @Post(':cardId/prices')
  async upsertPrice(
    @Param('cardId') cardId: string,
    @Body() body: unknown,
  ): Promise<PriceResponse> {
    const payload = parseUpsertPricePayload(body);
    return this.priceService.registerPrice(cardId, payload);
  }
}
