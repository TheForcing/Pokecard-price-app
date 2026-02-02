import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import type { RecognizeRequest, RecognizeResponse } from '@pokecard/shared';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const DEFAULT_TOP_K = 5;

function decodeBase64Image(data: string): { buffer: Buffer; mime?: string } {
  const dataUrlMatch = data.match(/^data:(.+);base64,(.*)$/);
  const base64 = dataUrlMatch ? dataUrlMatch[2] : data;
  const mime = dataUrlMatch ? dataUrlMatch[1] : undefined;
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw new BadRequestException('imageBase64 is invalid');
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new BadRequestException('imageBase64 is too large');
  }
  return { buffer, mime };
}

function runOcrRoiStub(buffer: Buffer, hint: RecognizeRequest['hint']) {
  const normalized = (value?: string) => (value ? value.toUpperCase() : undefined);
  return {
    setCode: normalized(hint?.market === 'JP' ? 'JP' : undefined),
    number: undefined,
    language: hint?.language,
    confidence: 0,
    bytes: buffer.length,
  };
}

function runEmbeddingSearchStub(buffer: Buffer, topK = DEFAULT_TOP_K) {
  const base = [
    {
      cardId: 'stub-001',
      name: 'Pikachu (Stub)',
      setCode: 'STB',
      number: '001/100',
      confidence: 0.62,
      imageUrl: 'https://images.pokemontcg.io/base1/58.png',
    },
    {
      cardId: 'stub-002',
      name: 'Charizard (Stub)',
      setCode: 'STB',
      number: '002/100',
      confidence: 0.41,
      imageUrl: 'https://images.pokemontcg.io/base1/4.png',
    },
    {
      cardId: 'stub-003',
      name: 'Blastoise (Stub)',
      setCode: 'STB',
      number: '003/100',
      confidence: 0.33,
      imageUrl: 'https://images.pokemontcg.io/base1/2.png',
    },
    {
      cardId: 'stub-004',
      name: 'Venusaur (Stub)',
      setCode: 'STB',
      number: '004/100',
      confidence: 0.28,
      imageUrl: 'https://images.pokemontcg.io/base1/15.png',
    },
    {
      cardId: 'stub-005',
      name: 'Gyarados (Stub)',
      setCode: 'STB',
      number: '005/100',
      confidence: 0.22,
      imageUrl: 'https://images.pokemontcg.io/base1/6.png',
    },
  ];
  return {
    candidates: base.slice(0, Math.max(1, Math.min(topK, base.length))),
    embeddingBytes: buffer.length,
  };
}

@Controller('/recognize')
export class RecognizeController {
  @Post()
  recognize(@Body() body: RecognizeRequest): RecognizeResponse {
    if (!body?.imageBase64 || typeof body.imageBase64 !== 'string') {
      throw new BadRequestException('imageBase64 is required');
    }
    const startedAt = Date.now();
    const { buffer, mime } = decodeBase64Image(body.imageBase64);
    const hint = body.hint ?? {};
    const ocr = runOcrRoiStub(buffer, hint);
    const embedding = runEmbeddingSearchStub(buffer, DEFAULT_TOP_K);
    const candidates = embedding.candidates.map((candidate) => ({
      ...candidate,
      language: hint.language ?? 'EN',
    }));

    return {
      best: candidates[0],
      candidates,
      debug: {
        note: 'stub: decode + size check + ocr/embedding placeholders',
        receivedBytes: body.imageBase64?.length ?? 0,
        decodedBytes: buffer.length,
        mime,
        hint,
        ocr,
        embedding: {
          topK: candidates.length,
          embeddingBytes: embedding.embeddingBytes,
        },
        steps: ['decode', 'size-check', 'ocr-roi:stub', 'embedding:stub'],
        elapsedMs: Date.now() - startedAt,
      },
    };
  }
}
