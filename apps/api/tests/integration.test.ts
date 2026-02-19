import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { CardSearchResponse, PriceResponse } from '@pokecard/shared';
import request from 'supertest';
import Tesseract from 'tesseract.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/module.js';
import { HealthController } from '../src/routes/health.controller.js';
import { PricesController } from '../src/routes/prices.controller.js';
import { RecognizeController } from '../src/routes/recognize.controller.js';
import { CardService } from '../src/services/card.service.js';
import { PriceService } from '../src/services/price.service.js';
import { PrismaService } from '../src/services/prisma.service.js';

vi.mock('tesseract.js', () => ({
  default: {
    recognize: vi.fn(),
  },
}));

function createCardServiceMock() {
  return {
    searchCards: vi.fn(),
    getCardIdentity: vi.fn(),
    upsertFromPokemonTcg: vi.fn(),
    upsertPokemonTcgMap: vi.fn(),
  };
}

function createPriceServiceMock() {
  return {
    getPrice: vi.fn(),
    getMetricsSnapshot: vi.fn(() => ({
      cache: {
        redis: { hit: 0, miss: 0, set: 0, read_error: 0, write_error: 0 },
        memory: { hit: 0, miss: 0, set: 0, read_error: 0, write_error: 0 },
      },
      providers: [],
    })),
  };
}

describe('API integration', () => {
  let app: INestApplication;
  let cardServiceMock: ReturnType<typeof createCardServiceMock>;
  let priceServiceMock: ReturnType<typeof createPriceServiceMock>;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    cardServiceMock = createCardServiceMock();
    priceServiceMock = createPriceServiceMock();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CardService)
      .useValue(cardServiceMock)
      .overrideProvider(PriceService)
      .useValue(priceServiceMock)
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    app = moduleRef.createNestApplication();
    app.useLogger(false);
    await app.init();

    const pricesController = app.get(PricesController);
    (pricesController as unknown as { cardService: typeof cardServiceMock }).cardService =
      cardServiceMock;
    (pricesController as unknown as { priceService: typeof priceServiceMock }).priceService =
      priceServiceMock;

    const recognizeController = app.get(RecognizeController);
    (recognizeController as unknown as { cardService: typeof cardServiceMock }).cardService =
      cardServiceMock;

    const healthController = app.get(HealthController);
    (healthController as unknown as { priceService: typeof priceServiceMock }).priceService =
      priceServiceMock;
  });

  afterEach(async () => {
    vi.clearAllMocks();
    globalThis.fetch = originalFetch;
    await app.close();
  });

  it('GET /health returns service status', async () => {
    const res = await request(app.getHttpServer()).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.service).toBe('api');
    expect(typeof res.body.time).toBe('string');
  });

  it('GET /health/metrics/prometheus returns prometheus text payload', async () => {
    const res = await request(app.getHttpServer()).get('/health/metrics/prometheus');

    expect(res.status).toBe(200);
    expect(res.text).toContain('pokecard_cache_events_total');
    expect(res.text).toContain('pokecard_provider_calls_total');
  });

  it('GET /cards/search returns mapped items', async () => {
    cardServiceMock.searchCards.mockResolvedValue([
      {
        id: 'card_1',
        name: 'Pikachu',
        language: 'EN',
        setCode: 'sv1',
        setName: 'Scarlet & Violet',
        collectorNumber: '001',
        collectorTotal: 198,
        variant: 'NORMAL',
        rarity: 'Common',
        imageUrl: 'https://example.com/pikachu.jpg',
      },
    ]);

    const res = await request(app.getHttpServer())
      .get('/cards/search')
      .query({ q: 'Pikachu', language: 'EN', setCode: 'sv1', number: '001', variant: 'NORMAL' });

    expect(res.status).toBe(200);
    expect(cardServiceMock.searchCards).toHaveBeenCalledWith({
      query: 'Pikachu',
      language: 'EN',
      setCode: 'sv1',
      collectorNumber: '001',
      variant: 'NORMAL',
      limit: undefined,
    });

    const body = res.body as CardSearchResponse;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: 'card_1',
      name: 'Pikachu',
      language: 'EN',
      setCode: 'sv1',
      collectorNumber: '001',
      variant: 'NORMAL',
    });
  });

  it('GET /cards/search forwards numeric limit and filter-only query', async () => {
    cardServiceMock.searchCards.mockResolvedValue([]);

    const res = await request(app.getHttpServer()).get('/cards/search').query({
      language: 'JA',
      setCode: 'sv2a',
      number: '151',
      variant: 'HOLOFOIL',
      limit: '7',
    });

    expect(res.status).toBe(200);
    expect(cardServiceMock.searchCards).toHaveBeenCalledWith({
      query: undefined,
      language: 'JA',
      setCode: 'sv2a',
      collectorNumber: '151',
      variant: 'HOLOFOIL',
      limit: 7,
    });
    expect(res.body).toEqual({ items: [] });
  });

  it('GET /cards/search sends undefined limit when limit is invalid', async () => {
    cardServiceMock.searchCards.mockResolvedValue([]);

    const res = await request(app.getHttpServer())
      .get('/cards/search')
      .query({ q: 'Charizard', language: 'EN', limit: 'not-a-number' });

    expect(res.status).toBe(200);
    expect(cardServiceMock.searchCards).toHaveBeenCalledWith({
      query: 'Charizard',
      language: 'EN',
      setCode: undefined,
      collectorNumber: undefined,
      variant: undefined,
      limit: undefined,
    });
  });

  it('GET /cards/search returns 500 when card service throws', async () => {
    cardServiceMock.searchCards.mockRejectedValue(new Error('db unavailable'));

    const res = await request(app.getHttpServer()).get('/cards/search').query({ q: 'Pikachu' });

    expect(res.status).toBe(500);
    expect(res.body.statusCode).toBe(500);
  });

  it('GET /cards/:cardId/prices rejects invalid market', async () => {
    const res = await request(app.getHttpServer())
      .get('/cards/card_1/prices')
      .query({ market: 'EU' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('invalid market');
    expect(priceServiceMock.getPrice).not.toHaveBeenCalled();
  });

  it('GET /cards/:cardId/prices returns provider response', async () => {
    const payload: PriceResponse = {
      cardId: 'card_1',
      market: 'US',
      currency: 'USD',
      low: 10.5,
      high: 22,
      source: 'TCGPLAYER',
      fetchedAt: new Date().toISOString(),
    };
    priceServiceMock.getPrice.mockResolvedValue(payload);

    const res = await request(app.getHttpServer())
      .get('/cards/card_1/prices')
      .query({ market: 'US' });

    expect(res.status).toBe(200);
    expect(priceServiceMock.getPrice).toHaveBeenCalledWith('card_1', 'US');
    expect(res.body).toMatchObject(payload);
  });

  it('GET /cards/:cardId/prices returns 500 when price service throws', async () => {
    priceServiceMock.getPrice.mockRejectedValue(new Error('provider timeout'));

    const res = await request(app.getHttpServer())
      .get('/cards/card_1/prices')
      .query({ market: 'US' });

    expect(res.status).toBe(500);
    expect(res.body.statusCode).toBe(500);
  });

  it('POST /recognize validates required imageBase64', async () => {
    const res = await request(app.getHttpServer())
      .post('/recognize')
      .send({ hint: { language: 'EN' } });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('imageBase64 is required');
    expect(cardServiceMock.searchCards).not.toHaveBeenCalled();
  });

  it('POST /recognize rejects non-string imageBase64', async () => {
    const res = await request(app.getHttpServer())
      .post('/recognize')
      .send({ imageBase64: 12345, hint: { language: 'EN' } });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('imageBase64 is required');
  });

  it('POST /recognize rejects invalid base64 payload', async () => {
    const res = await request(app.getHttpServer())
      .post('/recognize')
      .send({ imageBase64: 'data:image/png;base64,', hint: { language: 'EN' } });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('imageBase64 is invalid');
  });

  it('POST /recognize rejects unsupported mime type', async () => {
    const res = await request(app.getHttpServer())
      .post('/recognize')
      .send({ imageBase64: 'data:text/plain;base64,YWJj', hint: { language: 'EN' } });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('unsupported image mime type');
  });

  it('GET /recognize/metrics returns confidence histogram shape', async () => {
    const res = await request(app.getHttpServer()).get('/recognize/metrics');

    expect(res.status).toBe(200);
    expect(typeof res.body.count).toBe('number');
    expect(res.body.confidenceHistogram).toHaveProperty('0.0-0.2');
    expect(res.body.confidenceHistogram).toHaveProperty('0.8-1.0');
    expect(res.body.elapsedMs).toHaveProperty('p95');
  });

  it('GET /recognize/metrics/prometheus returns prometheus text payload', async () => {
    const res = await request(app.getHttpServer()).get('/recognize/metrics/prometheus');

    expect(res.status).toBe(200);
    expect(res.text).toContain('pokecard_recognize_requests_total');
    expect(res.text).toContain('pokecard_ocr_confidence_bucket');
  });

  it('POST /recognize returns 503 when OCR engine request fails', async () => {
    const mockedRecognize = vi.mocked(Tesseract.recognize);
    mockedRecognize.mockRejectedValue(new Error('ocr worker crashed'));

    const imageBase64 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5WnN4AAAAASUVORK5CYII=';

    const res = await request(app.getHttpServer())
      .post('/recognize')
      .send({ imageBase64, hint: { language: 'EN', market: 'US' } });

    expect(res.status).toBe(503);
    expect(res.body.message).toBe('ocr request failed');
  });

  it('POST /recognize returns candidates on success with mocked OCR/provider', async () => {
    const mockedRecognize = vi.mocked(Tesseract.recognize);
    mockedRecognize.mockResolvedValue({
      data: {
        text: 'Pikachu',
        lines: [{ text: 'Pikachu' }],
        confidence: 96,
      },
    } as never);

    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: 'base1-1',
                name: 'Pikachu',
                number: '1',
                rarity: 'Common',
                set: { id: 'base1', name: 'Base', printedTotal: 102 },
                images: { small: 'https://example.com/pikachu.jpg' },
              },
            ],
          }),
        }) as Response,
    );

    cardServiceMock.searchCards.mockResolvedValue([]);
    cardServiceMock.upsertFromPokemonTcg.mockResolvedValue({ id: 'identity_1' });
    cardServiceMock.upsertPokemonTcgMap.mockResolvedValue(undefined);

    const imageBase64 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5WnN4AAAAASUVORK5CYII=';

    const res = await request(app.getHttpServer())
      .post('/recognize')
      .send({ imageBase64, hint: { language: 'EN', market: 'US' } });

    expect(res.status).toBe(201);
    expect(mockedRecognize).toHaveBeenCalled();
    expect(cardServiceMock.upsertFromPokemonTcg).toHaveBeenCalled();
    expect(cardServiceMock.upsertPokemonTcgMap).toHaveBeenCalledWith('base1-1', 'identity_1');
    expect(res.body.best).toMatchObject({
      name: 'Pikachu',
      identityId: 'identity_1',
      language: 'EN',
    });
    expect(Array.isArray(res.body.candidates)).toBe(true);
    expect(res.body.candidates.length).toBeGreaterThan(0);
  });
});
