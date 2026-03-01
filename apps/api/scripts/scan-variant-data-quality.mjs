import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SUSPICIOUS_RARITY_PATTERN = /(reverse|holo|full art|alt art|secret|promo)/i;

function toGroupKey(card) {
  return [card.language, card.setCode, card.collectorNumber, card.nameNormalized].join('|');
}

function sortCardsByUpdatedAtDesc(a, b) {
  return b.updatedAt.getTime() - a.updatedAt.getTime();
}

async function main() {
  const cards = await prisma.cardIdentity.findMany({
    select: {
      id: true,
      name: true,
      nameNormalized: true,
      language: true,
      setCode: true,
      collectorNumber: true,
      variant: true,
      rarity: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
  });

  const groups = new Map();
  for (const card of cards) {
    const key = toGroupKey(card);
    const existing = groups.get(key);
    if (existing) {
      existing.push(card);
    } else {
      groups.set(key, [card]);
    }
  }

  const normalOnlyGroups = [];
  const suspiciousRarityMismatch = [];

  for (const list of groups.values()) {
    const variants = new Set(list.map((entry) => entry.variant));
    if (variants.size === 1 && variants.has('NORMAL')) {
      const latest = [...list].sort(sortCardsByUpdatedAtDesc)[0];
      normalOnlyGroups.push({
        language: latest.language,
        setCode: latest.setCode,
        collectorNumber: latest.collectorNumber,
        name: latest.name,
        variantCount: variants.size,
        rowsInGroup: list.length,
        latestCardId: latest.id,
      });
    }

    for (const entry of list) {
      if (entry.variant === 'NORMAL' && entry.rarity && SUSPICIOUS_RARITY_PATTERN.test(entry.rarity)) {
        suspiciousRarityMismatch.push({
          id: entry.id,
          language: entry.language,
          setCode: entry.setCode,
          collectorNumber: entry.collectorNumber,
          name: entry.name,
          rarity: entry.rarity,
          variant: entry.variant,
          updatedAt: entry.updatedAt.toISOString(),
        });
      }
    }
  }

  normalOnlyGroups.sort((a, b) => a.name.localeCompare(b.name));
  suspiciousRarityMismatch.sort((a, b) => a.name.localeCompare(b.name));

  const report = {
    scannedAt: new Date().toISOString(),
    totalCards: cards.length,
    normalOnlyGroupCount: normalOnlyGroups.length,
    suspiciousRarityMismatchCount: suspiciousRarityMismatch.length,
    sampleNormalOnlyGroups: normalOnlyGroups.slice(0, 20),
    sampleSuspiciousRarityMismatch: suspiciousRarityMismatch.slice(0, 20),
  };

  console.log(JSON.stringify(report, null, 2));

  if (suspiciousRarityMismatch.length > 0) {
    process.exitCode = 2;
  }
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
