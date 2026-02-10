import { PrismaClient, ExternalProvider, Market } from '@prisma/client';

const DEFAULT_PAGE_SIZE = 250;
const DEFAULT_PAGES = 4;
const DEFAULT_START_PAGE = 1;
const API_BASE = 'https://api.pokemontcg.io/v2/cards';

const prisma = new PrismaClient();

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    pageSize: DEFAULT_PAGE_SIZE,
    pages: DEFAULT_PAGES,
    startPage: DEFAULT_START_PAGE,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--page-size' && next) {
      result.pageSize = Number(next) || result.pageSize;
      i += 1;
      continue;
    }
    if (arg === '--pages' && next) {
      result.pages = Number(next) || result.pages;
      i += 1;
      continue;
    }
    if (arg === '--start' && next) {
      result.startPage = Number(next) || result.startPage;
      i += 1;
      continue;
    }
  }
  return result;
}

function normalizeName(value) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function parseVariant(rarity) {
  if (!rarity) return 'NORMAL';
  const value = String(rarity);
  if (/reverse/i.test(value)) return 'REVERSE_HOLOFOIL';
  if (/holo/i.test(value)) return 'HOLOFOIL';
  if (/full art/i.test(value)) return 'FULL_ART';
  if (/alt art/i.test(value)) return 'ALT_ART';
  if (/secret/i.test(value)) return 'SECRET';
  if (/promo/i.test(value)) return 'PROMO';
  return 'NORMAL';
}

async function fetchCards(page, pageSize, apiKey) {
  const url = new URL(API_BASE);
  url.searchParams.set('page', String(page));
  url.searchParams.set('pageSize', String(pageSize));
  const headers = { Accept: 'application/json' };
  if (apiKey) headers['X-Api-Key'] = apiKey;

  const response = await fetch(url.toString(), { headers });
  if (!response.ok) {
    throw new Error(`PokemonTCG API error ${response.status}`);
  }
  return response.json();
}

async function upsertCard(card) {
  if (!card || !card.id || !card.name) return null;
  const setCode = card.set?.id ?? 'unknown';
  const collectorNumber = card.number?.trim() || '0';
  const variant = parseVariant(card.rarity);
  const nameNormalized = normalizeName(card.name);
  const data = {
    name: card.name,
    nameNormalized,
    language: 'EN',
    setCode,
    setName: card.set?.name ?? null,
    collectorNumber,
    collectorTotal: Number.isFinite(Number(card.set?.printedTotal))
      ? Number(card.set?.printedTotal)
      : null,
    variant,
    rarity: card.rarity ?? null,
    imageUrl: card.images?.small ?? null,
  };

  const identity = await prisma.cardIdentity.upsert({
    where: {
      card_identity_unique: {
        language: 'EN',
        setCode,
        collectorNumber,
        variant,
      },
    },
    update: data,
    create: data,
  });

  await prisma.externalProductMap.upsert({
    where: {
      external_provider_unique: {
        provider: ExternalProvider.POKEMONTCG,
        externalId: card.id,
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
      externalId: card.id,
      matchMethod: 'catalog',
      matchConfidence: 0.95,
    },
  });

  return identity;
}

async function run() {
  const { pageSize, pages, startPage } = parseArgs();
  const apiKey = process.env.POKEMONTCG_API_KEY;
  const maxPages = Math.max(1, pages);
  const start = Math.max(1, startPage);

  console.log(`Seeding PokemonTCG cards: pageSize=${pageSize}, pages=${maxPages}, start=${start}`);

  let totalUpserts = 0;
  for (let page = start; page < start + maxPages; page += 1) {
    const payload = await fetchCards(page, pageSize, apiKey);
    const items = Array.isArray(payload?.data) ? payload.data : [];
    if (items.length === 0) {
      console.log(`No data at page ${page}. Stopping.`);
      break;
    }
    for (const card of items) {
      const identity = await upsertCard(card);
      if (identity) totalUpserts += 1;
    }
    console.log(`Page ${page} done. Upserts so far: ${totalUpserts}`);
  }

  console.log(`Seed complete. Total upserts: ${totalUpserts}`);
}

try {
  await run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
