import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ExternalProvider, Market } from '@prisma/client';
import request from 'supertest';
import Tesseract from 'tesseract.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/module.js';
import { PrismaService } from '../src/services/prisma.service.js';

vi.mock('tesseract.js', () => ({
  default: {
    recognize: vi.fn(),
  },
}));

const runDbIntegration = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const shouldRunDbIntegration = runDbIntegration && hasDatabaseUrl;

describe.runIf(shouldRunDbIntegration)('API DB integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.priceSnapshot.deleteMany();
    await prisma.externalProductMap.deleteMany();
    await prisma.cardIdentity.deleteMany();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    globalThis.fetch = originalFetch;

    if (prisma) {
      await prisma.priceSnapshot.deleteMany();
      await prisma.externalProductMap.deleteMany();
      await prisma.cardIdentity.deleteMany();
    }

    await app.close();
  });

  it('POST /recognize persists identity and pokemon map with real Prisma service', async () => {
    const mockedRecognize = vi.mocked(Tesseract.recognize);
    mockedRecognize.mockResolvedValue({
      data: {
        text: 'Pikachu',
        lines: [{ text: 'Pikachu' }],
        confidence: 96,
      },
    } as never);

    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('api.pokemontcg.io/v2/cards')) {
        return {
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
        } as Response;
      }

      throw new Error(`unexpected fetch in test: ${url}`);
    });

    const imageBase64 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5WnN4AAAAASUVORK5CYII=';

    const res = await request(app.getHttpServer())
      .post('/recognize')
      .send({ imageBase64, hint: { language: 'EN', market: 'US' } });

    expect(res.status).toBe(201);
    expect(mockedRecognize).toHaveBeenCalled();
    expect(res.body.best?.identityId).toBeTruthy();

    const identities = await prisma.cardIdentity.findMany();
    expect(identities).toHaveLength(1);
    expect(identities[0]).toMatchObject({
      name: 'Pikachu',
      language: 'EN',
      setCode: 'base1',
      collectorNumber: '1',
    });

    const map = await prisma.externalProductMap.findUnique({
      where: {
        external_provider_unique: {
          provider: ExternalProvider.POKEMONTCG,
          externalId: 'base1-1',
        },
      },
    });
    expect(map).not.toBeNull();
    expect(map?.cardIdentityId).toBe(identities[0].id);
    expect(map?.market).toBe(Market.US);
  });

  it('GET /cards/:cardId/prices creates map and snapshot, then serves cached value', async () => {
    const seeded = await prisma.cardIdentity.create({
      data: {
        name: 'Pikachu',
        nameNormalized: 'pikachu',
        language: 'EN',
        setCode: 'base1',
        setName: 'Base',
        collectorNumber: '1',
        variant: 'NORMAL',
      },
    });

    const first = await request(app.getHttpServer())
      .get(`/cards/${seeded.id}/prices`)
      .query({ market: 'US' });

    expect(first.status).toBe(200);
    expect(first.body.cardId).toBe(seeded.id);
    expect(first.body.market).toBe('US');
    expect(first.body.source).toBe('TCGPLAYER');

    const map = await prisma.externalProductMap.findFirst({
      where: {
        cardIdentityId: seeded.id,
        provider: ExternalProvider.TCGPLAYER,
        market: Market.US,
        active: true,
      },
    });
    expect(map).not.toBeNull();
    expect(map?.externalId.startsWith('query:')).toBe(true);

    const snapshotsAfterFirst = await prisma.priceSnapshot.findMany();
    expect(snapshotsAfterFirst).toHaveLength(1);
    expect(snapshotsAfterFirst[0]).toMatchObject({
      externalProductMapId: map?.id,
      market: Market.US,
      source: ExternalProvider.TCGPLAYER,
    });

    const second = await request(app.getHttpServer())
      .get(`/cards/${seeded.id}/prices`)
      .query({ market: 'US' });

    expect(second.status).toBe(200);
    const snapshotsAfterSecond = await prisma.priceSnapshot.findMany();
    expect(snapshotsAfterSecond).toHaveLength(1);
  });

  it('POST+GET /cards/:cardId/prices keeps same-name variants priced separately', async () => {
    const normal = await prisma.cardIdentity.create({
      data: {
        name: 'Pikachu',
        nameNormalized: 'pikachu',
        language: 'EN',
        setCode: 'variant-check',
        setName: 'Variant Check Set',
        collectorNumber: '1',
        variant: 'NORMAL',
      },
    });

    const holo = await prisma.cardIdentity.create({
      data: {
        name: 'Pikachu',
        nameNormalized: 'pikachu',
        language: 'EN',
        setCode: 'variant-check',
        setName: 'Variant Check Set',
        collectorNumber: '1',
        variant: 'HOLOFOIL',
      },
    });

    const normalUpsert = await request(app.getHttpServer())
      .post(`/cards/${normal.id}/prices`)
      .send({
        market: 'US',
        currency: 'USD',
        low: 10,
        high: 20,
        source: 'TCGPLAYER',
      });
    expect(normalUpsert.status).toBe(201);

    const holoUpsert = await request(app.getHttpServer())
      .post(`/cards/${holo.id}/prices`)
      .send({
        market: 'US',
        currency: 'USD',
        low: 80,
        high: 120,
        source: 'TCGPLAYER',
      });
    expect(holoUpsert.status).toBe(201);

    const normalPrice = await request(app.getHttpServer())
      .get(`/cards/${normal.id}/prices`)
      .query({ market: 'US' });
    expect(normalPrice.status).toBe(200);
    expect(normalPrice.body.low).toBe(10);
    expect(normalPrice.body.high).toBe(20);

    const holoPrice = await request(app.getHttpServer())
      .get(`/cards/${holo.id}/prices`)
      .query({ market: 'US' });
    expect(holoPrice.status).toBe(200);
    expect(holoPrice.body.low).toBe(80);
    expect(holoPrice.body.high).toBe(120);

    expect(normalPrice.body.low).not.toBe(holoPrice.body.low);
    expect(normalPrice.body.high).not.toBe(holoPrice.body.high);

    const maps = await prisma.externalProductMap.findMany({
      where: {
        provider: ExternalProvider.TCGPLAYER,
        market: Market.US,
      },
    });
    expect(maps).toHaveLength(2);

    const snapshots = await prisma.priceSnapshot.findMany({ where: { market: Market.US } });
    expect(snapshots).toHaveLength(2);
  });

  it('regression: same name/set/number across 6 variants keeps search and prices isolated', async () => {
    const variantCases = [
      { variant: 'NORMAL', low: 10, high: 20 },
      { variant: 'HOLOFOIL', low: 30, high: 40 },
      { variant: 'REVERSE_HOLOFOIL', low: 50, high: 60 },
      { variant: 'FULL_ART', low: 70, high: 80 },
      { variant: 'ALT_ART', low: 90, high: 100 },
      { variant: 'PROMO', low: 110, high: 120 },
    ] as const;

    const created = [] as Array<{ id: string; variant: (typeof variantCases)[number]['variant'] }>;
    for (const entry of variantCases) {
      const card = await prisma.cardIdentity.create({
        data: {
          name: 'CollisionMon',
          nameNormalized: 'collisionmon',
          language: 'EN',
          setCode: 'collision-regression',
          setName: 'Collision Regression Set',
          collectorNumber: '25',
          variant: entry.variant,
        },
      });
      created.push({ id: card.id, variant: entry.variant });

      const upsert = await request(app.getHttpServer())
        .post(`/cards/${card.id}/prices`)
        .send({
          market: 'US',
          currency: 'USD',
          low: entry.low,
          high: entry.high,
          source: 'TCGPLAYER',
        });
      expect(upsert.status).toBe(201);
    }

    const allVariantsSearch = await request(app.getHttpServer()).get('/cards/search').query({
      q: 'CollisionMon',
      language: 'EN',
      setCode: 'collision-regression',
      number: '25',
      limit: '20',
    });
    expect(allVariantsSearch.status).toBe(200);
    expect(allVariantsSearch.body.items).toHaveLength(6);

    for (const entry of variantCases) {
      const byVariant = await request(app.getHttpServer()).get('/cards/search').query({
        q: 'CollisionMon',
        language: 'EN',
        setCode: 'collision-regression',
        number: '25',
        variant: entry.variant,
      });

      expect(byVariant.status).toBe(200);
      expect(byVariant.body.items).toHaveLength(1);
      expect(byVariant.body.items[0].variant).toBe(entry.variant);

      const card = created.find((candidate) => candidate.variant === entry.variant);
      expect(card).toBeDefined();

      const price = await request(app.getHttpServer())
        .get(`/cards/${card!.id}/prices`)
        .query({ market: 'US' });
      expect(price.status).toBe(200);
      expect(price.body.low).toBe(entry.low);
      expect(price.body.high).toBe(entry.high);
    }

    const maps = await prisma.externalProductMap.findMany({
      where: {
        provider: ExternalProvider.TCGPLAYER,
        market: Market.US,
      },
    });
    expect(maps).toHaveLength(6);

    const snapshots = await prisma.priceSnapshot.findMany({ where: { market: Market.US } });
    expect(snapshots).toHaveLength(6);
  });

  it('GET /cards/search applies language/set/number/variant filters with limit', async () => {
    await prisma.cardIdentity.createMany({
      data: [
        {
          name: 'Pikachu',
          nameNormalized: 'pikachu',
          language: 'EN',
          setCode: 'base1',
          setName: 'Base',
          collectorNumber: '1',
          variant: 'NORMAL',
        },
        {
          name: 'Pikachu',
          nameNormalized: 'pikachu',
          language: 'EN',
          setCode: 'base1',
          setName: 'Base',
          collectorNumber: '1',
          variant: 'HOLOFOIL',
        },
        {
          name: 'Pikachu',
          nameNormalized: 'pikachu',
          language: 'JA',
          setCode: 'base1',
          setName: 'Base',
          collectorNumber: '1',
          variant: 'NORMAL',
        },
      ],
    });

    const res = await request(app.getHttpServer()).get('/cards/search').query({
      language: 'EN',
      setCode: 'base1',
      number: '1',
      variant: 'NORMAL',
      limit: '1',
    });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      name: 'Pikachu',
      language: 'EN',
      setCode: 'base1',
      collectorNumber: '1',
      variant: 'NORMAL',
    });
  });

  it('GET /cards/search normalizes query and returns name-asc ordered cards', async () => {
    await prisma.cardIdentity.createMany({
      data: [
        {
          name: 'Pikachu Alpha',
          nameNormalized: 'pikachu alpha',
          language: 'EN',
          setCode: 'sv1',
          setName: 'Scarlet & Violet',
          collectorNumber: '63',
          variant: 'NORMAL',
        },
        {
          name: 'Pikachu Zeta',
          nameNormalized: 'pikachu zeta',
          language: 'EN',
          setCode: 'swsh1',
          setName: 'Sword & Shield',
          collectorNumber: '43',
          variant: 'NORMAL',
        },
        {
          name: 'Charizard',
          nameNormalized: 'charizard',
          language: 'EN',
          setCode: 'base1',
          setName: 'Base',
          collectorNumber: '4',
          variant: 'NORMAL',
        },
      ],
    });

    const res = await request(app.getHttpServer())
      .get('/cards/search')
      .query({ q: '  PIKACHU---  ', language: 'EN', limit: '10' });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].name).toBe('Pikachu Alpha');
    expect(res.body.items[1].name).toBe('Pikachu Zeta');
  });

  it('GET /cards/search uses default limit when limit query is invalid', async () => {
    await prisma.cardIdentity.createMany({
      data: [
        {
          name: 'Eevee A',
          nameNormalized: 'eevee a',
          language: 'EN',
          setCode: 'base1',
          setName: 'Base',
          collectorNumber: '63',
          variant: 'NORMAL',
        },
        {
          name: 'Eevee B',
          nameNormalized: 'eevee b',
          language: 'EN',
          setCode: 'base1',
          setName: 'Base',
          collectorNumber: '64',
          variant: 'NORMAL',
        },
      ],
    });

    const res = await request(app.getHttpServer())
      .get('/cards/search')
      .query({ q: 'eevee', language: 'EN', limit: 'not-a-number' });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].name).toBe('Eevee A');
    expect(res.body.items[1].name).toBe('Eevee B');
  });

  it('GET /cards/search clamps limit boundary values (0 -> 1, 999 -> 50)', async () => {
    await prisma.cardIdentity.createMany({
      data: Array.from({ length: 55 }, (_, index) => {
        const n = index + 1;
        return {
          name: `LimitMon ${n.toString().padStart(2, '0')}`,
          nameNormalized: `limitmon ${n.toString().padStart(2, '0')}`,
          language: 'EN' as const,
          setCode: 'sv1',
          setName: 'Scarlet & Violet',
          collectorNumber: `${n}`,
          variant: 'NORMAL' as const,
        };
      }),
    });

    const lowLimit = await request(app.getHttpServer())
      .get('/cards/search')
      .query({ q: 'limitmon', language: 'EN', limit: '0' });

    expect(lowLimit.status).toBe(200);
    expect(lowLimit.body.items).toHaveLength(1);

    const highLimit = await request(app.getHttpServer())
      .get('/cards/search')
      .query({ q: 'limitmon', language: 'EN', limit: '999' });

    expect(highLimit.status).toBe(200);
    expect(highLimit.body.items).toHaveLength(50);
  });

  it('GET /cards/:cardId/prices rejects invalid market and does not persist snapshots', async () => {
    const seeded = await prisma.cardIdentity.create({
      data: {
        name: 'Bulbasaur',
        nameNormalized: 'bulbasaur',
        language: 'EN',
        setCode: 'base1',
        setName: 'Base',
        collectorNumber: '44',
        variant: 'NORMAL',
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/cards/${seeded.id}/prices`)
      .query({ market: 'EU' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('invalid market');

    const snapshots = await prisma.priceSnapshot.findMany();
    expect(snapshots).toHaveLength(0);
  });

  it('GET /cards/:cardId/prices for unknown card returns stub and does not create map/snapshot', async () => {
    const unknownCardId = 'missing-card-id';

    const res = await request(app.getHttpServer())
      .get(`/cards/${unknownCardId}/prices`)
      .query({ market: 'US' });

    expect(res.status).toBe(200);
    expect(res.body.cardId).toBe(unknownCardId);
    expect(res.body.market).toBe('US');
    expect(res.body.source).toBe('US_STUB');

    const maps = await prisma.externalProductMap.findMany();
    const snapshots = await prisma.priceSnapshot.findMany();
    expect(maps).toHaveLength(0);
    expect(snapshots).toHaveLength(0);
  });

  it('POST /recognize rejects invalid image payload and does not persist identity/map', async () => {
    const res = await request(app.getHttpServer())
      .post('/recognize')
      .send({ imageBase64: 'data:image/png;base64,', hint: { language: 'EN', market: 'US' } });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('imageBase64 is invalid');

    const identities = await prisma.cardIdentity.findMany();
    const maps = await prisma.externalProductMap.findMany();
    expect(identities).toHaveLength(0);
    expect(maps).toHaveLength(0);
  });

  it('POST /recognize rejects missing imageBase64 and does not persist identity/map', async () => {
    const res = await request(app.getHttpServer())
      .post('/recognize')
      .send({ hint: { language: 'EN' } });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('imageBase64 is required');

    const identities = await prisma.cardIdentity.findMany();
    const maps = await prisma.externalProductMap.findMany();
    expect(identities).toHaveLength(0);
    expect(maps).toHaveLength(0);
  });

  it('POST /recognize rejects oversized image payload and does not persist identity/map', async () => {
    const tooLargeImageBase64 = `data:image/png;base64,${Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64')}`;

    const res = await request(app.getHttpServer())
      .post('/recognize')
      .send({ imageBase64: tooLargeImageBase64, hint: { language: 'EN', market: 'US' } });

    expect([400, 413]).toContain(res.status);
    if (res.status === 400) {
      expect(res.body.message).toBe('imageBase64 is too large');
    } else {
      expect(res.body.message).toBe('request entity too large');
    }

    const identities = await prisma.cardIdentity.findMany();
    const maps = await prisma.externalProductMap.findMany();
    expect(identities).toHaveLength(0);
    expect(maps).toHaveLength(0);
  });

  it('GET /cards/:cardId/prices returns 503 when external provider auth request fails', async () => {
    const seeded = await prisma.cardIdentity.create({
      data: {
        name: 'Squirtle',
        nameNormalized: 'squirtle',
        language: 'EN',
        setCode: 'base1',
        setName: 'Base',
        collectorNumber: '7',
        variant: 'NORMAL',
      },
    });

    const prevClientId = process.env.PRICE_PROVIDER_US_CLIENT_ID;
    const prevClientSecret = process.env.PRICE_PROVIDER_US_CLIENT_SECRET;
    process.env.PRICE_PROVIDER_US_CLIENT_ID = 'ci-test-client-id';
    process.env.PRICE_PROVIDER_US_CLIENT_SECRET = 'ci-test-client-secret';

    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    });

    try {
      const res = await request(app.getHttpServer())
        .get(`/cards/${seeded.id}/prices`)
        .query({ market: 'US' });

      expect(res.status).toBe(503);
      expect(res.body.message).toBe('tcgplayer auth failed');

      const maps = await prisma.externalProductMap.findMany();
      const snapshots = await prisma.priceSnapshot.findMany();
      expect(maps).toHaveLength(0);
      expect(snapshots).toHaveLength(0);
    } finally {
      process.env.PRICE_PROVIDER_US_CLIENT_ID = prevClientId;
      process.env.PRICE_PROVIDER_US_CLIENT_SECRET = prevClientSecret;
    }
  });

  it('GET /cards/:cardId/prices returns 502 when external provider payload is invalid', async () => {
    const seeded = await prisma.cardIdentity.create({
      data: {
        name: 'Charmander',
        nameNormalized: 'charmander',
        language: 'EN',
        setCode: 'base1',
        setName: 'Base',
        collectorNumber: '4',
        variant: 'NORMAL',
      },
    });

    const prevClientId = process.env.PRICE_PROVIDER_US_CLIENT_ID;
    const prevClientSecret = process.env.PRICE_PROVIDER_US_CLIENT_SECRET;
    process.env.PRICE_PROVIDER_US_CLIENT_ID = 'ci-test-client-id';
    process.env.PRICE_PROVIDER_US_CLIENT_SECRET = 'ci-test-client-secret';

    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes('/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'token-1', expires_in: 3600 }),
        } as Response;
      }

      if (url.includes('/catalog/products')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ results: { unexpected: true } }),
        } as Response;
      }

      throw new Error(`unexpected fetch in test: ${url}`);
    });

    try {
      const res = await request(app.getHttpServer())
        .get(`/cards/${seeded.id}/prices`)
        .query({ market: 'US' });

      expect(res.status).toBe(502);
      expect(res.body.message).toBe('tcgplayer search returned invalid data');

      const maps = await prisma.externalProductMap.findMany();
      const snapshots = await prisma.priceSnapshot.findMany();
      expect(maps).toHaveLength(0);
      expect(snapshots).toHaveLength(0);
    } finally {
      process.env.PRICE_PROVIDER_US_CLIENT_ID = prevClientId;
      process.env.PRICE_PROVIDER_US_CLIENT_SECRET = prevClientSecret;
    }
  });

  it('GET /health/metrics reports cache hit/miss/set counters', async () => {
    const seeded = await prisma.cardIdentity.create({
      data: {
        name: 'Eevee',
        nameNormalized: 'eevee',
        language: 'EN',
        setCode: 'base1',
        setName: 'Base',
        collectorNumber: '63',
        variant: 'NORMAL',
      },
    });

    const prevClientId = process.env.PRICE_PROVIDER_US_CLIENT_ID;
    const prevClientSecret = process.env.PRICE_PROVIDER_US_CLIENT_SECRET;
    process.env.PRICE_PROVIDER_US_CLIENT_ID = '';
    process.env.PRICE_PROVIDER_US_CLIENT_SECRET = '';

    try {
      const first = await request(app.getHttpServer())
        .get(`/cards/${seeded.id}/prices`)
        .query({ market: 'US' });
      expect(first.status).toBe(200);

      const second = await request(app.getHttpServer())
        .get(`/cards/${seeded.id}/prices`)
        .query({ market: 'US' });
      expect(second.status).toBe(200);

      const metrics = await request(app.getHttpServer()).get('/health/metrics');
      expect(metrics.status).toBe(200);
      const missTotal = metrics.body.cache.memory.miss + metrics.body.cache.redis.miss;
      const setTotal = metrics.body.cache.memory.set + metrics.body.cache.redis.set;
      const hitTotal = metrics.body.cache.memory.hit + metrics.body.cache.redis.hit;
      expect(missTotal).toBeGreaterThanOrEqual(1);
      expect(setTotal).toBeGreaterThanOrEqual(1);
      expect(hitTotal).toBeGreaterThanOrEqual(1);
    } finally {
      process.env.PRICE_PROVIDER_US_CLIENT_ID = prevClientId;
      process.env.PRICE_PROVIDER_US_CLIENT_SECRET = prevClientSecret;
    }
  });

  it('GET /recognize/metrics exposes confidence histogram and latency stats', async () => {
    const mockedRecognize = vi.mocked(Tesseract.recognize);
    mockedRecognize.mockResolvedValue({
      data: {
        text: 'Pikachu',
        lines: [{ text: 'Pikachu' }],
        confidence: 96,
      },
    } as never);

    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('api.pokemontcg.io/v2/cards')) {
        return {
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
        } as Response;
      }

      throw new Error(`unexpected fetch in test: ${url}`);
    });

    const imageBase64 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5WnN4AAAAASUVORK5CYII=';

    const recognize = await request(app.getHttpServer())
      .post('/recognize')
      .send({ imageBase64, hint: { language: 'EN', market: 'US' } });
    expect(recognize.status).toBe(201);

    const metrics = await request(app.getHttpServer()).get('/recognize/metrics');
    expect(metrics.status).toBe(200);
    expect(metrics.body.count).toBeGreaterThanOrEqual(1);
    expect(metrics.body.confidenceHistogram).toHaveProperty('0.0-0.2');
    expect(metrics.body.confidenceHistogram).toHaveProperty('0.8-1.0');
    expect(metrics.body.elapsedMs).toHaveProperty('p95');
  });
});

describe.skipIf(shouldRunDbIntegration)('API DB integration', () => {
  it('skips unless RUN_DB_INTEGRATION_TESTS=true and DATABASE_URL is set', () => {
    expect(shouldRunDbIntegration).toBe(false);
  });
});
