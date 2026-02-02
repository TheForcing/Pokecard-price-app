import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import type { Market, PriceResponse } from '@pokecard/shared';

const PRICE_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const priceCache = new Map<string, { data: PriceResponse; expiresAt: number }>();

@Controller('/cards')
export class PricesController {
  @Get(':cardId/prices')
  prices(@Param('cardId') cardId: string, @Query('market') marketQuery?: Market): PriceResponse {
    const allowedMarkets: Market[] = ['US', 'JP'];
    if (marketQuery && !allowedMarkets.includes(marketQuery)) {
      throw new BadRequestException('invalid market');
    }
    const market: Market = marketQuery ?? 'US';

    const cacheKey = `${cardId}:${market}`;
    const cached = priceCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    // TODO: Replace with real market integration (TCGplayer for US, JP strategy TBD)
    // Add Redis caching + persisted snapshots in Postgres.

    const response: PriceResponse = {
      cardId,
      market,
      currency: market === 'JP' ? 'JPY' : 'USD',
      low: market === 'JP' ? 1200 : 12.5,
      high: market === 'JP' ? 9800 : 210.0,
      source: market === 'JP' ? 'JP_STUB' : 'US_STUB',
      fetchedAt: new Date().toISOString(),
    };
    priceCache.set(cacheKey, { data: response, expiresAt: Date.now() + PRICE_CACHE_TTL_MS });
    return response;
  }
}
