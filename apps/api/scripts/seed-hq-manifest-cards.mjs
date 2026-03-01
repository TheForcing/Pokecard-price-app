import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient, ExternalProvider, Market } from '@prisma/client';

const prisma = new PrismaClient();

function normalizeName(value) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function parseCardId(cardId) {
  const [setCode, collectorNumber] = cardId.split('-');
  if (!setCode || !collectorNumber) {
    return { setCode: 'unknown', collectorNumber: '0' };
  }

  return { setCode, collectorNumber };
}

async function main() {
  const manifestPath = path.resolve(process.cwd(), '..', '..', 'tests', 'fixtures', 'hq-cards', 'manifest.json');
  const raw = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  const items = Array.isArray(manifest.items) ? manifest.items : [];

  let upserts = 0;
  for (const item of items) {
    if (!item || typeof item.cardId !== 'string' || typeof item.name !== 'string') {
      continue;
    }

    const { setCode, collectorNumber } = parseCardId(item.cardId);
    const data = {
      name: item.name,
      nameNormalized: normalizeName(item.name),
      language: 'EN',
      setCode,
      setName: setCode.toUpperCase(),
      collectorNumber,
      collectorTotal: null,
      variant: 'NORMAL',
      rarity: null,
      imageUrl: typeof item.sourceUrl === 'string' ? item.sourceUrl : null,
    };

    const identity = await prisma.cardIdentity.upsert({
      where: {
        card_identity_unique: {
          language: 'EN',
          setCode,
          collectorNumber,
          variant: 'NORMAL',
        },
      },
      update: data,
      create: data,
    });

    await prisma.externalProductMap.upsert({
      where: {
        external_provider_unique: {
          provider: ExternalProvider.POKEMONTCG,
          externalId: item.cardId,
        },
      },
      update: {
        cardIdentityId: identity.id,
        market: Market.US,
        active: true,
      },
      create: {
        cardIdentityId: identity.id,
        provider: ExternalProvider.POKEMONTCG,
        market: Market.US,
        externalId: item.cardId,
        matchMethod: 'catalog',
        matchConfidence: 0.95,
      },
    });

    upserts += 1;
  }

  console.log(`Seed complete from HQ manifest. Total upserts: ${upserts}`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
