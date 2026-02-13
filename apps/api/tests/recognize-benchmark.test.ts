import 'reflect-metadata';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/module.js';
import { RecognizeController } from '../src/routes/recognize.controller.js';
import { CardService } from '../src/services/card.service.js';
import { PrismaService } from '../src/services/prisma.service.js';

const shouldRun = process.env.RUN_OCR_BENCHMARK === 'true';
const WARMUP_ROUNDS = 1;
const MEASURE_ROUNDS = 4;

type Sample = {
  image: string;
  status: number;
  wallMs: number;
  pipelineMs: number | null;
  cropMethod: string | null;
  ocrConfidence: number | null;
};

type FixtureCase = {
  name: string;
  source: string;
  transform: (image: sharp.Sharp) => sharp.Sharp;
};

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

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

async function loadFixtureCaseBase64(fixture: FixtureCase): Promise<string> {
  const fixturePath = path.resolve(process.cwd(), '..', '..', 'tests', 'fixtures', fixture.source);
  const originalBuffer = await fs.readFile(fixturePath);
  const transformed = await fixture
    .transform(sharp(originalBuffer))
    .resize({ width: 280 })
    .jpeg({ quality: 55 })
    .toBuffer();
  return `data:image/jpeg;base64,${transformed.toString('base64')}`;
}

describe.runIf(shouldRun)('recognize benchmark', () => {
  let app: INestApplication;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
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
      throw new Error(`unexpected fetch in benchmark: ${url}`);
    };
  }, 60000);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
  }, 60000);

  it('measures /recognize latency and pipeline timing', async () => {
    const fixtures: FixtureCase[] = [
      { name: '046-base', source: '046.png', transform: (image) => image },
      { name: '127-base', source: '127.png', transform: (image) => image },
      {
        name: '046-dim',
        source: '046.png',
        transform: (image) => image.modulate({ brightness: 0.82, saturation: 0.9 }),
      },
      {
        name: '127-soft-blur',
        source: '127.png',
        transform: (image) => image.blur(0.6),
      },
      {
        name: '046-tilt',
        source: '046.png',
        transform: (image) => image.rotate(1.5, { background: '#ffffff' }),
      },
      {
        name: '127-compressed',
        source: '127.png',
        transform: (image) => image.jpeg({ quality: 40 }),
      },
    ];
    const base64ByFixture = await Promise.all(
      fixtures.map((fixture) => loadFixtureCaseBase64(fixture)),
    );
    const samples: Sample[] = [];

    for (let round = 0; round < WARMUP_ROUNDS + MEASURE_ROUNDS; round += 1) {
      for (let i = 0; i < fixtures.length; i += 1) {
        const startedAt = Date.now();
        const res = await request(app.getHttpServer())
          .post('/recognize')
          .send({ imageBase64: base64ByFixture[i], hint: { language: 'EN', market: 'US' } });
        const wallMs = Date.now() - startedAt;
        if (round >= WARMUP_ROUNDS) {
          samples.push({
            image: fixtures[i].name,
            status: res.status,
            wallMs,
            pipelineMs:
              typeof res.body?.debug?.elapsedMs === 'number'
                ? (res.body.debug.elapsedMs as number)
                : null,
            cropMethod:
              typeof res.body?.debug?.cropMethod === 'string' ? res.body.debug.cropMethod : null,
            ocrConfidence:
              typeof res.body?.debug?.ocr?.confidence === 'number'
                ? (res.body.debug.ocr.confidence as number)
                : null,
          });
        }
      }
    }

    const ok = samples.filter((entry) => entry.status === 201);
    expect(ok).toHaveLength(samples.length);

    const wall = ok.map((entry) => entry.wallMs);
    const pipeline = ok.map((entry) => entry.pipelineMs ?? 0);
    const avgWall = Math.round(wall.reduce((sum, value) => sum + value, 0) / wall.length);
    const avgPipeline = Math.round(
      pipeline.reduce((sum, value) => sum + value, 0) / pipeline.length,
    );

    const summary = {
      samples: ok.length,
      wallMs: {
        min: Math.min(...wall),
        p50: percentile(wall, 50),
        p95: percentile(wall, 95),
        avg: avgWall,
        max: Math.max(...wall),
      },
      pipelineMs: {
        min: Math.min(...pipeline),
        p50: percentile(pipeline, 50),
        p95: percentile(pipeline, 95),
        avg: avgPipeline,
        max: Math.max(...pipeline),
      },
      cropMethods: ok.map((entry) => entry.cropMethod),
      ocrConfidence: ok.map((entry) => entry.ocrConfidence),
    };

    console.log('RECOGNIZE_BENCHMARK_SUMMARY');
    console.log(JSON.stringify(summary, null, 2));
  }, 180000);
});

describe.skipIf(shouldRun)('recognize benchmark', () => {
  it('is opt-in', () => {
    expect(process.env.RUN_OCR_BENCHMARK).not.toBe('true');
  });
});
