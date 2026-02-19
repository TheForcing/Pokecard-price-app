import { Inject, Injectable } from '@nestjs/common';
import type { CardVariant, Language } from '@pokecard/shared';
import {
  ExternalProvider,
  Market,
  Prisma,
  type CardIdentity as PrismaCardIdentity,
} from '@prisma/client';
import { PrismaService } from './prisma.service.js';

type PokemonTcgCard = {
  id: string;
  name: string;
  number?: string;
  rarity?: string;
  set?: { id?: string; name?: string; printedTotal?: number | string };
  images?: { small?: string };
};

const VARIANT_MAP: { match: RegExp; variant: CardVariant }[] = [
  { match: /reverse/i, variant: 'REVERSE_HOLOFOIL' },
  { match: /holo/i, variant: 'HOLOFOIL' },
  { match: /full art/i, variant: 'FULL_ART' },
  { match: /alt art/i, variant: 'ALT_ART' },
  { match: /secret/i, variant: 'SECRET' },
  { match: /promo/i, variant: 'PROMO' },
];

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function parseVariant(rarity?: string): CardVariant {
  if (!rarity) return 'NORMAL';
  const match = VARIANT_MAP.find((entry) => entry.match.test(rarity));
  return match?.variant ?? 'NORMAL';
}

function toInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

@Injectable()
export class CardService {
  private readonly prisma: PrismaService;

  constructor(@Inject(PrismaService) prisma: PrismaService) {
    this.prisma = prisma;
  }

  async searchCards(params: {
    query?: string;
    language?: Language;
    setCode?: string;
    collectorNumber?: string;
    variant?: CardVariant;
    limit?: number;
  }): Promise<PrismaCardIdentity[]> {
    const normalizedQuery = params.query ? normalizeName(params.query) : undefined;
    const where: Prisma.CardIdentityWhereInput = {
      ...(params.language ? { language: params.language } : {}),
      ...(params.setCode ? { setCode: params.setCode } : {}),
      ...(params.collectorNumber ? { collectorNumber: params.collectorNumber } : {}),
      ...(params.variant ? { variant: params.variant } : {}),
      ...(normalizedQuery
        ? {
            nameNormalized: {
              contains: normalizedQuery,
              mode: 'insensitive',
            },
          }
        : {}),
    };

    const limit = Math.max(1, Math.min(params.limit ?? 20, 50));
    return this.prisma.cardIdentity.findMany({
      where,
      orderBy: { name: 'asc' },
      take: limit,
    });
  }

  async getCardIdentity(id: string) {
    return this.prisma.cardIdentity.findUnique({ where: { id } });
  }

  async upsertFromPokemonTcg(
    card: PokemonTcgCard,
    language: Language,
  ): Promise<PrismaCardIdentity> {
    const setCode = card.set?.id ?? 'unknown';
    const collectorNumber = card.number?.trim() || '0';
    const variant = parseVariant(card.rarity);
    const nameNormalized = normalizeName(card.name);
    const data = {
      name: card.name,
      nameNormalized,
      language,
      setCode,
      setName: card.set?.name,
      collectorNumber,
      collectorTotal: toInt(card.set?.printedTotal),
      variant,
      rarity: card.rarity,
      imageUrl: card.images?.small,
    };

    return this.prisma.cardIdentity.upsert({
      where: {
        card_identity_unique: {
          language,
          setCode,
          collectorNumber,
          variant,
        },
      },
      update: data,
      create: data,
    });
  }

  async upsertPokemonTcgMap(cardId: string, cardIdentityId: string) {
    return this.prisma.externalProductMap.upsert({
      where: {
        external_provider_unique: {
          provider: ExternalProvider.POKEMONTCG,
          externalId: cardId,
        },
      },
      update: {
        cardIdentityId,
        market: Market.US,
        active: true,
      },
      create: {
        cardIdentityId,
        provider: ExternalProvider.POKEMONTCG,
        market: Market.US,
        externalId: cardId,
        matchMethod: 'catalog',
        matchConfidence: 0.95,
      },
    });
  }
}
