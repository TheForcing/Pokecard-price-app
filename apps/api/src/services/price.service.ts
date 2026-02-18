import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
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
import { createClient } from 'redis';
import { PrismaService } from './prisma.service.js';

const DEFAULT_PRICE_CACHE_TTL_SECONDS = 2 * 60 * 60;
const PRICE_CACHE_NAMESPACE = 'price:v1';
const DEFAULT_PROVIDER_TIMEOUT_MS = 8000;
const DEFAULT_PROVIDER_RETRIES = 2;
const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 5;
const DEFAULT_CIRCUIT_OPEN_MS = 30_000;

type ProviderName = 'TCGPLAYER' | 'RAKUTEN' | 'NAVER';
type ProviderOperation = 'auth' | 'search' | 'pricing';

type CircuitState = {
  failures: number;
  openedUntil: number;
};

function getEnvValue(name: string): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseCacheTtlSeconds(value: string | undefined): number {
  if (!value) return DEFAULT_PRICE_CACHE_TTL_SECONDS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PRICE_CACHE_TTL_SECONDS;
  return Math.floor(parsed);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

type TcgplayerToken = {
  value: string;
  expiresAt: number;
};

type PriceRedisClient = ReturnType<typeof createClient>;

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

function isPriceResponse(value: unknown): value is PriceResponse {
  if (!isRecord(value)) return false;
  return (
    typeof value.cardId === 'string' &&
    typeof value.market === 'string' &&
    typeof value.currency === 'string' &&
    typeof value.source === 'string' &&
    typeof value.fetchedAt === 'string' &&
    'low' in value &&
    'high' in value
  );
}

@Injectable()
export class PriceService implements OnModuleDestroy {
  constructor(private readonly prisma: PrismaService) {}

  private readonly logger = new Logger(PriceService.name);
  private readonly priceCache = new Map<string, { data: PriceResponse; expiresAt: number }>();
  private readonly cacheTtlSeconds = parseCacheTtlSeconds(getEnvValue('PRICE_CACHE_TTL_SECONDS'));
  private readonly cacheTtlMs = this.cacheTtlSeconds * 1000;
  private readonly cacheNamespace = getEnvValue('PRICE_CACHE_NAMESPACE') ?? PRICE_CACHE_NAMESPACE;
  private readonly redisUrl = getEnvValue('REDIS_URL');
  private readonly providerTimeoutMs = parsePositiveInt(
    getEnvValue('PRICE_PROVIDER_TIMEOUT_MS'),
    DEFAULT_PROVIDER_TIMEOUT_MS,
  );
  private readonly providerRetries = parsePositiveInt(
    getEnvValue('PRICE_PROVIDER_RETRY_COUNT'),
    DEFAULT_PROVIDER_RETRIES,
  );
  private readonly circuitFailureThreshold = parsePositiveInt(
    getEnvValue('PRICE_PROVIDER_CIRCUIT_FAILURE_THRESHOLD'),
    DEFAULT_CIRCUIT_FAILURE_THRESHOLD,
  );
  private readonly circuitOpenMs = parsePositiveInt(
    getEnvValue('PRICE_PROVIDER_CIRCUIT_OPEN_MS'),
    DEFAULT_CIRCUIT_OPEN_MS,
  );

  private redisClient?: PriceRedisClient;
  private redisConnectPromise?: Promise<PriceRedisClient | null>;
  private tcgplayerToken?: TcgplayerToken;
  private readonly circuitState = new Map<ProviderName, CircuitState>();

  private logStructured(
    level: 'debug' | 'log' | 'warn',
    event: string,
    payload: Record<string, unknown>,
  ): void {
    this.logger[level](JSON.stringify({ event, ...payload }));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redisClient?.isOpen) {
      await this.redisClient.quit();
    }
  }

  private getCacheKey(cardId: string, market: Market): string {
    return `${this.cacheNamespace}:${market}:${cardId}`;
  }

  private async getRedisClient(): Promise<PriceRedisClient | null> {
    if (!this.redisUrl) return null;

    if (this.redisClient?.isOpen) {
      return this.redisClient;
    }

    if (this.redisConnectPromise) {
      return this.redisConnectPromise;
    }

    const connectPromise = (async () => {
      try {
        const client = createClient({ url: this.redisUrl });
        client.on('error', (error: unknown) => {
          this.logger.warn(`redis error: ${error instanceof Error ? error.message : 'unknown'}`);
        });
        await client.connect();
        this.redisClient = client;
        this.logger.log('redis cache enabled');
        return client;
      } catch (error) {
        this.logger.warn('redis unavailable; falling back to in-memory cache');
        return null;
      } finally {
        this.redisConnectPromise = undefined;
      }
    })();
    this.redisConnectPromise = connectPromise;

    return connectPromise;
  }

  private async readCache(cacheKey: string): Promise<PriceResponse | null> {
    const redis = await this.getRedisClient();
    if (redis) {
      try {
        const raw = await redis.get(cacheKey);
        if (raw) {
          const parsed = JSON.parse(raw) as unknown;
          if (isPriceResponse(parsed)) {
            this.logStructured('debug', 'cache_event', {
              cache: 'redis',
              action: 'hit',
              key: cacheKey,
            });
            return parsed;
          }
        }
      } catch (error) {
        this.logStructured('warn', 'cache_event', {
          cache: 'redis',
          action: 'read_error',
          key: cacheKey,
        });
      }
    }

    const cached = this.priceCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.logStructured('debug', 'cache_event', {
        cache: 'memory',
        action: 'hit',
        key: cacheKey,
      });
      return cached.data;
    }
    if (cached) {
      this.priceCache.delete(cacheKey);
    }

    this.logStructured('debug', 'cache_event', {
      cache: redis ? 'redis' : 'memory',
      action: 'miss',
      key: cacheKey,
    });
    return null;
  }

  private async writeCache(cacheKey: string, data: PriceResponse): Promise<void> {
    const redis = await this.getRedisClient();
    if (redis) {
      try {
        await redis.set(cacheKey, JSON.stringify(data), {
          EX: this.cacheTtlSeconds,
        });
        this.logStructured('debug', 'cache_event', {
          cache: 'redis',
          action: 'set',
          key: cacheKey,
        });
        return;
      } catch (error) {
        this.logStructured('warn', 'cache_event', {
          cache: 'redis',
          action: 'write_error',
          key: cacheKey,
        });
      }
    }

    this.priceCache.set(cacheKey, { data, expiresAt: Date.now() + this.cacheTtlMs });
    this.logStructured('debug', 'cache_event', {
      cache: 'memory',
      action: 'set',
      key: cacheKey,
    });
  }

  async invalidateCardCache(cardId: string, market?: Market): Promise<void> {
    const markets: Market[] = market ? [market] : ['US', 'JP', 'KR'];
    const keys = markets.map((entry) => this.getCacheKey(cardId, entry));
    for (const key of keys) {
      this.priceCache.delete(key);
    }

    const redis = await this.getRedisClient();
    if (redis) {
      await redis.del(keys);
    }
  }

  private getOrCreateCircuitState(provider: ProviderName): CircuitState {
    const state = this.circuitState.get(provider);
    if (state) return state;
    const nextState: CircuitState = { failures: 0, openedUntil: 0 };
    this.circuitState.set(provider, nextState);
    return nextState;
  }

  private isCircuitOpen(provider: ProviderName): boolean {
    const state = this.getOrCreateCircuitState(provider);
    return state.openedUntil > Date.now();
  }

  private recordProviderSuccess(provider: ProviderName): void {
    const state = this.getOrCreateCircuitState(provider);
    if (state.failures === 0 && state.openedUntil === 0) return;
    state.failures = 0;
    state.openedUntil = 0;
  }

  private recordProviderFailure(provider: ProviderName): void {
    const state = this.getOrCreateCircuitState(provider);
    state.failures += 1;
    if (state.failures < this.circuitFailureThreshold) return;
    state.failures = 0;
    state.openedUntil = Date.now() + this.circuitOpenMs;
    this.logStructured('warn', 'provider_circuit', {
      provider,
      action: 'open',
      openMs: this.circuitOpenMs,
    });
  }

  private async fetchJson(
    provider: ProviderName,
    operation: ProviderOperation,
    url: string,
    init: RequestInit,
    message: string,
  ): Promise<unknown> {
    if (this.isCircuitOpen(provider)) {
      this.logStructured('warn', 'provider_call', {
        provider,
        operation,
        result: 'blocked_by_circuit',
      });
      throw new ServiceUnavailableException(`${provider.toLowerCase()} circuit is open`);
    }

    const maxAttempts = Math.max(1, this.providerRetries + 1);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.providerTimeoutMs);

      let response: Response;
      try {
        response = await fetch(url, { ...init, signal: controller.signal });
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        if (attempt < maxAttempts) {
          this.logStructured('warn', 'provider_call', {
            provider,
            operation,
            result: 'retrying_after_network_error',
            attempt,
            maxAttempts,
            latencyMs,
          });
          continue;
        }
        this.recordProviderFailure(provider);
        this.logStructured('warn', 'provider_call', {
          provider,
          operation,
          result: 'network_error',
          attempt,
          maxAttempts,
          latencyMs,
        });
        throw new ServiceUnavailableException(message);
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        const latencyMs = Date.now() - startedAt;
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < maxAttempts) {
          this.logStructured('warn', 'provider_call', {
            provider,
            operation,
            result: 'retrying_after_http_error',
            statusCode: response.status,
            attempt,
            maxAttempts,
            latencyMs,
          });
          continue;
        }
        this.recordProviderFailure(provider);
        this.logStructured('warn', 'provider_call', {
          provider,
          operation,
          result: 'http_error',
          statusCode: response.status,
          attempt,
          maxAttempts,
          latencyMs,
        });
        throw new BadGatewayException(`${message}: ${response.status}`);
      }

      this.recordProviderSuccess(provider);
      this.logStructured('debug', 'provider_call', {
        provider,
        operation,
        result: 'success',
        statusCode: response.status,
        attempt,
        maxAttempts,
        latencyMs: Date.now() - startedAt,
      });
      return (await response.json()) as unknown;
    }

    this.recordProviderFailure(provider);
    throw new ServiceUnavailableException(message);
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
      'TCGPLAYER',
      'auth',
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
      'TCGPLAYER',
      'search',
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
      'TCGPLAYER',
      'pricing',
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
      'RAKUTEN',
      'search',
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
      'NAVER',
      'search',
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

    const cacheKey = this.getCacheKey(cardId, market);
    const cached = await this.readCache(cacheKey);
    if (cached) return cached;

    const card = await this.prisma.cardIdentity.findUnique({ where: { id: cardId } });
    if (!card) {
      const stub = this.getStubPrice(cardId, market);
      await this.writeCache(cacheKey, stub);
      return stub;
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
    await this.writeCache(cacheKey, response);
    return response;
  }
}
