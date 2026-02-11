import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { CardSearchResponse, PriceResponse } from '@pokecard/shared';
import request from 'supertest';
import Tesseract from 'tesseract.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/module.js';
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
    await app.init();

    const pricesController = app.get(PricesController);
    (pricesController as unknown as { cardService: typeof cardServiceMock }).cardService =
      cardServiceMock;
    (pricesController as unknown as { priceService: typeof priceServiceMock }).priceService =
      priceServiceMock;

    const recognizeController = app.get(RecognizeController);
    (recognizeController as unknown as { cardService: typeof cardServiceMock }).cardService =
      cardServiceMock;
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

  it('POST /recognize validates required imageBase64', async () => {
    const res = await request(app.getHttpServer())
      .post('/recognize')
      .send({ hint: { language: 'EN' } });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('imageBase64 is required');
    expect(cardServiceMock.searchCards).not.toHaveBeenCalled();
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
