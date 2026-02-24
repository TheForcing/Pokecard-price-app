import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Market, PriceResponse, UpsertPriceRequest } from '@pokecard/shared';
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
type ProviderResult =
  | 'success'
  | 'http_error'
  | 'network_error'
  | 'retrying_after_network_error'
  | 'retrying_after_http_error'
  | 'blocked_by_circuit';
type CacheKind = 'redis' | 'memory';
type CacheAction = 'hit' | 'miss' | 'set' | 'read_error' | 'write_error';

type CacheMetricEntry = Record<CacheAction, number>;
type ProviderMetricEntry = {
  calls: number;
  latenciesMs: number[];
  results: Record<ProviderResult, number>;
};

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

function createCacheMetricEntry(): CacheMetricEntry {
  return {
    hit: 0,
    miss: 0,
    set: 0,
    read_error: 0,
    write_error: 0,
  };
}

function createProviderMetricEntry(): ProviderMetricEntry {
  return {
    calls: 0,
    latenciesMs: [],
    results: {
      success: 0,
      http_error: 0,
      network_error: 0,
      retrying_after_network_error: 0,
      retrying_after_http_error: 0,
      blocked_by_circuit: 0,
    },
  };
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedValues.length) - 1;
  const safeIndex = Math.max(0, Math.min(sortedValues.length - 1, index));
  return sortedValues[safeIndex];
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
  private readonly prisma: PrismaService;

  constructor(@Inject(PrismaService) prisma: PrismaService) {
    this.prisma = prisma;
  }

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
  private readonly providerMetrics: Record<ProviderName, ProviderMetricEntry> = {
    TCGPLAYER: createProviderMetricEntry(),
    RAKUTEN: createProviderMetricEntry(),
    NAVER: createProviderMetricEntry(),
  };
  private readonly providerCircuitOpens: Record<ProviderName, number> = {
    TCGPLAYER: 0,
    RAKUTEN: 0,
    NAVER: 0,
  };
  private readonly cacheMetrics: Record<CacheKind, CacheMetricEntry> = {
    redis: createCacheMetricEntry(),
    memory: createCacheMetricEntry(),
  };

  private trackCacheMetric(payload: Record<string, unknown>): void {
    const cache = payload.cache;
    const action = payload.action;
    if ((cache !== 'redis' && cache !== 'memory') || typeof action !== 'string') {
      return;
    }
    if (!(action in this.cacheMetrics[cache])) {
      return;
    }
    const typedAction = action as CacheAction;
    this.cacheMetrics[cache][typedAction] += 1;
  }

  private trackProviderMetric(payload: Record<string, unknown>): void {
    const provider = payload.provider;
    const result = payload.result;
    if (
      (provider !== 'TCGPLAYER' && provider !== 'RAKUTEN' && provider !== 'NAVER') ||
      typeof result !== 'string'
    ) {
      return;
    }
    if (!(result in this.providerMetrics[provider].results)) {
      return;
    }
    const entry = this.providerMetrics[provider];
    const typedResult = result as ProviderResult;
    entry.calls += 1;
    entry.results[typedResult] += 1;

    const latencyMs = payload.latencyMs;
    if (typeof latencyMs === 'number' && Number.isFinite(latencyMs) && latencyMs >= 0) {
      entry.latenciesMs.push(latencyMs);
      if (entry.latenciesMs.length > 500) {
        entry.latenciesMs.shift();
      }
    }
  }

  private trackCircuitMetric(payload: Record<string, unknown>): void {
    const provider = payload.provider;
    const action = payload.action;
    if (
      (provider !== 'TCGPLAYER' && provider !== 'RAKUTEN' && provider !== 'NAVER') ||
      action !== 'open'
    ) {
      return;
    }
    this.providerCircuitOpens[provider] += 1;
  }

  private trackStructuredMetric(event: string, payload: Record<string, unknown>): void {
    if (event === 'cache_event') {
      this.trackCacheMetric(payload);
      return;
    }
    if (event === 'provider_call') {
      this.trackProviderMetric(payload);
      return;
    }
    if (event === 'provider_circuit') {
      this.trackCircuitMetric(payload);
    }
  }

  private logStructured(
    level: 'debug' | 'log' | 'warn',
    event: string,
    payload: Record<string, unknown>,
  ): void {
    this.trackStructuredMetric(event, payload);
    this.logger[level](JSON.stringify({ event, ...payload }));
  }

  getMetricsSnapshot() {
    const providerSummary = (Object.keys(this.providerMetrics) as ProviderName[]).map(
      (provider) => {
        const entry = this.providerMetrics[provider];
        const sortedLatencies = [...entry.latenciesMs].sort((a, b) => a - b);
        const count = sortedLatencies.length;
        const avg =
          count > 0
            ? sortedLatencies.reduce((acc, value) => acc + value, 0) / sortedLatencies.length
            : 0;
        return {
          provider,
          calls: entry.calls,
          circuitOpenCount: this.providerCircuitOpens[provider],
          results: { ...entry.results },
          latencyMs: {
            samples: count,
            avg,
            p95: percentile(sortedLatencies, 95),
            p99: percentile(sortedLatencies, 99),
            max: count > 0 ? sortedLatencies[count - 1] : 0,
          },
        };
      },
    );

    return {
      cache: {
        redis: { ...this.cacheMetrics.redis },
        memory: { ...this.cacheMetrics.memory },
      },
      providers: providerSummary,
    };
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

  async registerPrice(cardId: string, payload: UpsertPriceRequest): Promise<PriceResponse> {
    if (!cardId) {
      throw new BadRequestException('cardId is required');
    }

    const currency = payload.currency?.trim();
    if (!currency) {
      throw new BadRequestException('currency is required');
    }

    const low = payload.low;
    const high = payload.high;
    if (low !== null && (!Number.isFinite(low) || low < 0)) {
      throw new BadRequestException('low must be a non-negative number or null');
    }
    if (high !== null && (!Number.isFinite(high) || high < 0)) {
      throw new BadRequestException('high must be a non-negative number or null');
    }
    if (low !== null && high !== null && high < low) {
      throw new BadRequestException('high must be greater than or equal to low');
    }

    const capturedAt = payload.capturedAt ? new Date(payload.capturedAt) : new Date();
    if (Number.isNaN(capturedAt.getTime())) {
      throw new BadRequestException('capturedAt must be a valid ISO datetime');
    }

    if (
      payload.matchConfidence != null &&
      (!Number.isFinite(payload.matchConfidence) ||
        payload.matchConfidence < 0 ||
        payload.matchConfidence > 1)
    ) {
      throw new BadRequestException('matchConfidence must be a number between 0 and 1');
    }

    const card = await this.prisma.cardIdentity.findUnique({ where: { id: cardId } });
    if (!card) {
      throw new NotFoundException('card not found');
    }

    const externalId =
      payload.externalId?.trim() || `manual:${card.id}:${payload.source}:${payload.market}`;
    const provider = payload.source as ExternalProvider;
    const market = payload.market as PrismaMarket;
    const map = await this.prisma.externalProductMap.upsert({
      where: {
        external_provider_unique: {
          provider,
          externalId,
        },
      },
      update: {
        cardIdentityId: card.id,
        provider,
        market,
        externalUrl: payload.externalUrl?.trim() || null,
        matchMethod: payload.matchMethod?.trim() || 'manual',
        matchConfidence: payload.matchConfidence ?? 1,
        active: true,
        meta: {
          source: 'manual-upsert',
        },
      },
      create: {
        cardIdentityId: card.id,
        provider,
        market,
        externalId,
        externalUrl: payload.externalUrl?.trim() || null,
        matchMethod: payload.matchMethod?.trim() || 'manual',
        matchConfidence: payload.matchConfidence ?? 1,
        active: true,
        meta: {
          source: 'manual-upsert',
        },
      },
    });

    const nowIso = new Date().toISOString();
    const response: PriceResponse = {
      cardId: card.id,
      market: payload.market,
      currency,
      low,
      high,
      source: provider,
      priceType: payload.priceType ?? 'LISTING',
      capturedAt: capturedAt.toISOString(),
      fetchedAt: nowIso,
    };

    await this.storeSnapshot(map, response);
    await this.writeCache(this.getCacheKey(card.id, payload.market), response);
    return response;
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
