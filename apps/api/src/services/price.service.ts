import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Market, PriceResponse } from '@pokecard/shared';
import {
  ExternalProvider,
  Market as PrismaMarket,
  Prisma,
  PriceType,
  type CardIdentity,
  type ExternalProductMap,
} from '@prisma/client';
import { PrismaService } from './prisma.service.js';

const PRICE_CACHE_TTL_MS = 2 * 60 * 60 * 1000;

type PriceSnapshot = PriceResponse & {
  cachedAt: string;
};

function getEnvValue(name: string): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

type TcgplayerToken = {
  value: string;
  expiresAt: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

@Injectable()
export class PriceService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly priceCache = new Map<string, { data: PriceResponse; expiresAt: number }>();
  private readonly snapshots: PriceSnapshot[] = [];
  private tcgplayerToken?: TcgplayerToken;

  private async fetchJson(url: string, init: RequestInit, message: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      throw new ServiceUnavailableException(message);
    }

    if (!response.ok) {
      throw new BadGatewayException(`${message}: ${response.status}`);
    }

    return (await response.json()) as unknown;
  }

  private getStubPrice(cardId: string, market: Market): PriceResponse {
    const currency = market === 'JP' ? 'JPY' : market === 'KR' ? 'KRW' : 'USD';
    const low = market === 'JP' ? 1200 : market === 'KR' ? 1500 : 12.5;
    const high = market === 'JP' ? 9800 : market === 'KR' ? 12000 : 210.0;
    const source = market === 'JP' ? 'JP_STUB' : market === 'KR' ? 'KR_STUB' : 'US_STUB';
    return {
      cardId,
      market,
      currency,
      low,
      high,
      source,
      fetchedAt: new Date().toISOString(),
    };
  }

  private async getTcgplayerToken(): Promise<string | null> {
    const clientId = getEnvValue('PRICE_PROVIDER_US_CLIENT_ID');
    const clientSecret = getEnvValue('PRICE_PROVIDER_US_CLIENT_SECRET');
    if (!clientId || !clientSecret) return null;

    if (this.tcgplayerToken && this.tcgplayerToken.expiresAt > Date.now()) {
      return this.tcgplayerToken.value;
    }

    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });

    const payload = await this.fetchJson(
      'https://api.tcgplayer.com/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      },
      'tcgplayer auth failed',
    );

    if (!isRecord(payload)) {
      throw new BadGatewayException('tcgplayer auth returned invalid data');
    }

    const tokenValue = payload.access_token;
    const expiresIn = payload.expires_in;
    if (typeof tokenValue !== 'string' || typeof expiresIn !== 'number') {
      throw new BadGatewayException('tcgplayer auth missing access token');
    }

    this.tcgplayerToken = {
      value: tokenValue,
      expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
    };

    return tokenValue;
  }

  private async fetchTcgplayerProductId(cardQuery: string): Promise<number | null> {
    const token = await this.getTcgplayerToken();
    if (!token) return null;

    const categoryId = getEnvValue('PRICE_PROVIDER_US_CATEGORY_ID') ?? '3';
    const searchUrl = new URL('https://api.tcgplayer.com/catalog/products');
    searchUrl.searchParams.set('categoryId', categoryId);
    searchUrl.searchParams.set('productName', cardQuery);
    searchUrl.searchParams.set('getExtendedFields', 'false');

    const searchPayload = await this.fetchJson(
      searchUrl.toString(),
      { headers: { Accept: 'application/json', Authorization: `bearer ${token}` } },
      'tcgplayer search failed',
    );

    if (!isRecord(searchPayload) || !Array.isArray(searchPayload.results)) {
      throw new BadGatewayException('tcgplayer search returned invalid data');
    }

    const product = searchPayload.results[0];
    if (!isRecord(product)) return null;

    const productIdValue = product.productId;
    const productId = typeof productIdValue === 'number' ? productIdValue : Number(productIdValue);
    return Number.isFinite(productId) ? productId : null;
  }

  private async fetchTcgplayerPriceByProductId(
    productId: number,
    cardQuery: string,
  ): Promise<PriceResponse> {
    const token = await this.getTcgplayerToken();
    if (!token) {
      return this.getStubPrice(cardQuery, 'US');
    }

    const pricingUrl = `https://api.tcgplayer.com/pricing/product/${productId}`;
    const pricingPayload = await this.fetchJson(
      pricingUrl,
      { headers: { Accept: 'application/json', Authorization: `bearer ${token}` } },
      'tcgplayer pricing failed',
    );

    if (!isRecord(pricingPayload) || !Array.isArray(pricingPayload.results)) {
      throw new BadGatewayException('tcgplayer pricing returned invalid data');
    }

    const pricing = pricingPayload.results[0];
    const low = isRecord(pricing)
      ? (toNumber(pricing.lowPrice) ?? toNumber(pricing.marketPrice))
      : null;
    const high = isRecord(pricing) ? (toNumber(pricing.highPrice) ?? low) : null;

    return {
      cardId: cardQuery,
      market: 'US',
      currency: 'USD',
      low,
      high,
      source: getEnvValue('PRICE_PROVIDER_US_SOURCE') ?? 'TCGPLAYER',
      priceType: 'LISTING',
      capturedAt: new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
    };
  }

  private async fetchTcgplayerPrice(cardQuery: string): Promise<PriceResponse> {
    const token = await this.getTcgplayerToken();
    if (!token) {
      return this.getStubPrice(cardQuery, 'US');
    }

    const productId = await this.fetchTcgplayerProductId(cardQuery);
    if (!productId) {
      return {
        cardId: cardQuery,
        market: 'US',
        currency: 'USD',
        low: null,
        high: null,
        source: getEnvValue('PRICE_PROVIDER_US_SOURCE') ?? 'TCGPLAYER',
        priceType: 'LISTING',
        capturedAt: new Date().toISOString(),
        fetchedAt: new Date().toISOString(),
      };
    }

    return this.fetchTcgplayerPriceByProductId(productId, cardQuery);
  }

  private async fetchRakutenPrice(cardQuery: string): Promise<PriceResponse> {
    const appId = getEnvValue('PRICE_PROVIDER_JP_APP_ID');
    if (!appId) {
      return this.getStubPrice(cardQuery, 'JP');
    }

    const url = new URL('https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706');
    url.searchParams.set('applicationId', appId);
    url.searchParams.set('keyword', cardQuery);
    url.searchParams.set('hits', '20');
    url.searchParams.set('format', 'json');

    const payload = await this.fetchJson(
      url.toString(),
      { headers: { Accept: 'application/json' } },
      'rakuten search failed',
    );

    if (!isRecord(payload) || !Array.isArray(payload.Items)) {
      throw new BadGatewayException('rakuten search returned invalid data');
    }

    const prices = payload.Items.map((entry) => {
      if (!isRecord(entry)) return null;
      const item = entry.Item;
      return isRecord(item) ? toNumber(item.itemPrice) : null;
    }).filter((value): value is number => value != null);

    const low = prices.length ? Math.min(...prices) : null;
    const high = prices.length ? Math.max(...prices) : null;

    return {
      cardId: cardQuery,
      market: 'JP',
      currency: 'JPY',
      low,
      high,
      source: getEnvValue('PRICE_PROVIDER_JP_SOURCE') ?? 'RAKUTEN',
      priceType: 'LISTING',
      capturedAt: new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
    };
  }

  private async fetchNaverPrice(cardQuery: string): Promise<PriceResponse> {
    const clientId = getEnvValue('PRICE_PROVIDER_KR_CLIENT_ID');
    const clientSecret = getEnvValue('PRICE_PROVIDER_KR_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      return this.getStubPrice(cardQuery, 'KR');
    }

    const url = new URL('https://openapi.naver.com/v1/search/shop.json');
    url.searchParams.set('query', cardQuery);
    url.searchParams.set('display', '20');

    const payload = await this.fetchJson(
      url.toString(),
      {
        headers: {
          Accept: 'application/json',
          'X-Naver-Client-Id': clientId,
          'X-Naver-Client-Secret': clientSecret,
        },
      },
      'naver search failed',
    );

    if (!isRecord(payload) || !Array.isArray(payload.items)) {
      throw new BadGatewayException('naver search returned invalid data');
    }

    const prices = payload.items
      .map((item) => (isRecord(item) ? toNumber(item.lprice) : null))
      .filter((value): value is number => value != null);
    const highs = payload.items
      .map((item) => (isRecord(item) ? toNumber(item.hprice) : null))
      .filter((value): value is number => value != null);

    const low = prices.length ? Math.min(...prices) : null;
    const high = highs.length ? Math.max(...highs) : low;

    return {
      cardId: cardQuery,
      market: 'KR',
      currency: 'KRW',
      low,
      high,
      source: getEnvValue('PRICE_PROVIDER_KR_SOURCE') ?? 'NAVER',
      priceType: 'LISTING',
      capturedAt: new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
    };
  }

  private async fetchFromProvider(cardQuery: string, market: Market): Promise<PriceResponse> {
    if (market === 'US') {
      return this.fetchTcgplayerPrice(cardQuery);
    }

    if (market === 'JP') {
      return this.fetchRakutenPrice(cardQuery);
    }

    if (market === 'KR') {
      return this.fetchNaverPrice(cardQuery);
    }

    return this.getStubPrice(cardQuery, market);
  }

  private getProviderByMarket(market: Market): ExternalProvider {
    if (market === 'JP') return ExternalProvider.RAKUTEN;
    if (market === 'KR') return ExternalProvider.NAVER;
    return ExternalProvider.TCGPLAYER;
  }

  private buildQueryFromCard(card: CardIdentity): string {
    const parts = [card.name, card.setCode, card.collectorNumber].filter(Boolean);
    return parts.join(' ');
  }

  private async getOrCreateExternalMap(
    card: CardIdentity,
    market: Market,
  ): Promise<ExternalProductMap> {
    const provider = this.getProviderByMarket(market);
    const existing = await this.prisma.externalProductMap.findFirst({
      where: {
        cardIdentityId: card.id,
        provider,
        market: market as PrismaMarket,
        active: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (existing) return existing;

    const query = this.buildQueryFromCard(card);

    if (provider === ExternalProvider.TCGPLAYER) {
      const productId = await this.fetchTcgplayerProductId(query);
      if (productId) {
        return this.prisma.externalProductMap.create({
          data: {
            cardIdentityId: card.id,
            provider,
            market: market as PrismaMarket,
            externalId: String(productId),
            matchMethod: 'search',
            matchConfidence: 0.6,
            meta: { query },
          },
        });
      }
    }

    return this.prisma.externalProductMap.create({
      data: {
        cardIdentityId: card.id,
        provider,
        market: market as PrismaMarket,
        externalId: `query:${query}`,
        matchMethod: 'query',
        matchConfidence: 0.3,
        meta: { query },
      },
    });
  }

  private async storeSnapshot(map: ExternalProductMap, price: PriceResponse): Promise<void> {
    await this.prisma.priceSnapshot.create({
      data: {
        externalProductMapId: map.id,
        market: map.market,
        currency: price.currency,
        source: map.provider,
        priceType: (price.priceType ?? 'LISTING') as PriceType,
        low: price.low,
        high: price.high,
        capturedAt: price.capturedAt ? new Date(price.capturedAt) : new Date(),
        raw: price as unknown as Prisma.JsonObject,
      },
    });
  }

  async getPrice(cardId: string, market: Market): Promise<PriceResponse> {
    if (!cardId) {
      throw new BadRequestException('cardId is required');
    }

    const cacheKey = `${cardId}:${market}`;
    const cached = this.priceCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const card = await this.prisma.cardIdentity.findUnique({ where: { id: cardId } });
    if (!card) {
      throw new BadRequestException('card identity not found');
    }

    const map = await this.getOrCreateExternalMap(card, market);
    const query = map.externalId.startsWith('query:')
      ? map.externalId.replace('query:', '')
      : this.buildQueryFromCard(card);

    let response: PriceResponse;
    if (map.provider === ExternalProvider.TCGPLAYER && !map.externalId.startsWith('query:')) {
      const productId = Number(map.externalId);
      response = Number.isFinite(productId)
        ? await this.fetchTcgplayerPriceByProductId(productId, query)
        : await this.fetchTcgplayerPrice(query);
    } else {
      response = await this.fetchFromProvider(query, market);
    }

    response = {
      ...response,
      cardId: card.id,
      source: map.provider,
      priceType: response.priceType ?? 'LISTING',
      capturedAt: response.capturedAt ?? new Date().toISOString(),
    };

    await this.storeSnapshot(map, response);
    this.priceCache.set(cacheKey, { data: response, expiresAt: Date.now() + PRICE_CACHE_TTL_MS });
    this.snapshots.push({ ...response, cachedAt: new Date().toISOString() });
    return response;
  }
}
