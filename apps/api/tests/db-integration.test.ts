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

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('imageBase64 is too large');

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
});

describe.skipIf(shouldRunDbIntegration)('API DB integration', () => {
  it('skips unless RUN_DB_INTEGRATION_TESTS=true and DATABASE_URL is set', () => {
    expect(shouldRunDbIntegration).toBe(false);
  });
});
