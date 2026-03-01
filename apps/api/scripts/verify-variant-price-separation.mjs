import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const baseUrl = process.env.API_BASE_URL?.trim() || 'http://127.0.0.1:4000';
const testName = 'VariantPriceCheckMon';
const testSetCode = 'variant-debug';

function fail(message) {
  throw new Error(message);
}

async function assertApiReady() {
  const response = await fetch(`${baseUrl}/health`);
  if (!response.ok) {
    fail(`API health check failed: ${response.status}`);
  }
}

async function upsertTestCards() {
  const shared = {
    name: testName,
    nameNormalized: testName.toLowerCase(),
    language: 'EN',
    setCode: testSetCode,
    setName: 'Variant Debug Set',
    collectorNumber: '001',
    collectorTotal: 999,
    rarity: 'Rare',
    imageUrl: null,
  };

  const normal = await prisma.cardIdentity.upsert({
    where: {
      card_identity_unique: {
        language: 'EN',
        setCode: testSetCode,
        collectorNumber: '001',
        variant: 'NORMAL',
      },
    },
    update: shared,
    create: {
      ...shared,
      variant: 'NORMAL',
    },
  });

  const holo = await prisma.cardIdentity.upsert({
    where: {
      card_identity_unique: {
        language: 'EN',
        setCode: testSetCode,
        collectorNumber: '001',
        variant: 'HOLOFOIL',
      },
    },
    update: shared,
    create: {
      ...shared,
      variant: 'HOLOFOIL',
    },
  });

  return { normal, holo };
}

async function registerPrice(cardId, low, high) {
  const response = await fetch(`${baseUrl}/cards/${cardId}/prices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      market: 'US',
      currency: 'USD',
      low,
      high,
      source: 'TCGPLAYER',
      priceType: 'LISTING',
      externalId: `manual-variant-check-${cardId}`,
      matchMethod: 'manual',
      matchConfidence: 1,
    }),
  });

  if (!response.ok) {
    fail(`Price register failed for ${cardId}: ${response.status}`);
  }
}

async function getPrice(cardId) {
  const response = await fetch(`${baseUrl}/cards/${cardId}/prices?market=US`);
  if (!response.ok) {
    fail(`Price fetch failed for ${cardId}: ${response.status}`);
  }
  return response.json();
}

async function cleanup() {
  await prisma.cardIdentity.deleteMany({
    where: {
      name: testName,
      setCode: testSetCode,
      language: 'EN',
    },
  });
}

async function main() {
  await assertApiReady();

  let normalId = '';
  let holoId = '';

  try {
    const { normal, holo } = await upsertTestCards();
    normalId = normal.id;
    holoId = holo.id;

    await registerPrice(normalId, 10, 20);
    await registerPrice(holoId, 80, 120);

    const normalPrice = await getPrice(normalId);
    const holoPrice = await getPrice(holoId);

    const separated =
      normalPrice.low === 10 &&
      normalPrice.high === 20 &&
      holoPrice.low === 80 &&
      holoPrice.high === 120;

    if (!separated) {
      fail(
        `Variant price separation failed. normal=${JSON.stringify(normalPrice)} holo=${JSON.stringify(holoPrice)}`,
      );
    }

    console.log('OK: variant-based price separation confirmed');
    console.log(`NORMAL ${normalId} -> low=${normalPrice.low}, high=${normalPrice.high}`);
    console.log(`HOLO   ${holoId} -> low=${holoPrice.low}, high=${holoPrice.high}`);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

await main();
