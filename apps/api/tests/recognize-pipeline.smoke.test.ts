import 'reflect-metadata';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/module.js';
import { RecognizeController } from '../src/routes/recognize.controller.js';
import { CardService } from '../src/services/card.service.js';
import { PrismaService } from '../src/services/prisma.service.js';

const shouldRun = process.env.RUN_OCR_PIPELINE_SMOKE === 'true';

function createCardServiceMock() {
  return {
    searchCards: async () => [],
    getCardIdentity: async () => null,
    upsertFromPokemonTcg: async (card: { name?: string }, language: string) => ({
      id: `${language}:${card.name ?? 'unknown'}`,
    }),
    upsertPokemonTcgMap: async () => undefined,
  };
}

describe.runIf(shouldRun)('recognize pipeline smoke', () => {
  let app: INestApplication;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    const cardServiceMock = createCardServiceMock();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CardService)
      .useValue(cardServiceMock)
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    const recognizeController = app.get(RecognizeController);
    (
      recognizeController as unknown as { cardService: ReturnType<typeof createCardServiceMock> }
    ).cardService = cardServiceMock;

    globalThis.fetch = async (input: string | URL | Request) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('api.pokemontcg.io/v2/cards')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [] }),
        } as Response;
      }
      throw new Error(`unexpected fetch in smoke test: ${url}`);
    };
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
  });

  it('runs crop + OCR + post-processing on fixture image', async () => {
    const fixturePath = path.resolve(process.cwd(), '..', '..', 'tests', 'fixtures', '046.png');
    const originalBuffer = await fs.readFile(fixturePath);
    const buffer = await sharp(originalBuffer)
      .resize({ width: 280 })
      .jpeg({ quality: 55 })
      .toBuffer();
    const imageBase64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;

    const res = await request(app.getHttpServer())
      .post('/recognize')
      .send({ imageBase64, hint: { language: 'EN', market: 'US' } });

    expect(res.status).toBe(201);
    expect(res.body.debug).toBeTruthy();
    expect(['perspective', 'contour', 'auto', 'none']).toContain(res.body.debug.cropMethod);
    expect(Array.isArray(res.body.debug.candidateLines)).toBe(true);
    expect(typeof res.body.debug.ocr?.confidence).toBe('number');
  });
});

describe.skipIf(shouldRun)('recognize pipeline smoke', () => {
  it('is opt-in', () => {
    expect(process.env.RUN_OCR_PIPELINE_SMOKE).not.toBe('true');
  });
});
