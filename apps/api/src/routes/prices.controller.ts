import { BadRequestException, Controller, Get, Inject, Param, Query } from '@nestjs/common';
import type {
  CardIdentity,
  CardSearchResponse,
  CardVariant,
  Language,
  Market,
  PriceResponse,
} from '@pokecard/shared';
import { CardService } from '../services/card.service.js';
import { PriceService } from '../services/price.service.js';

type CardIdentityRecord = NonNullable<Awaited<ReturnType<CardService['getCardIdentity']>>>;

function toCardIdentityDto(card: CardIdentityRecord): CardIdentity {
  return {
    id: card.id,
    name: card.name,
    language: card.language as CardIdentity['language'],
    setCode: card.setCode,
    setName: card.setName ?? undefined,
    collectorNumber: card.collectorNumber,
    collectorTotal: card.collectorTotal ?? undefined,
    variant: card.variant as CardIdentity['variant'],
    rarity: card.rarity ?? undefined,
    imageUrl: card.imageUrl ?? undefined,
  };
}

@Controller('/cards')
export class PricesController {
  private readonly priceService: PriceService;
  private readonly cardService: CardService;

  constructor(
    @Inject(PriceService) priceService: PriceService,
    @Inject(CardService) cardService: CardService,
  ) {
    this.priceService = priceService;
    this.cardService = cardService;
  }

  @Get('search')
  async search(
    @Query('q') query?: string,
    @Query('language') language?: Language,
    @Query('setCode') setCode?: string,
    @Query('number') collectorNumber?: string,
    @Query('variant') variant?: CardVariant,
    @Query('limit') limit?: string,
  ): Promise<CardSearchResponse> {
    const parsedLimit = Number(limit);
    const items = await this.cardService.searchCards({
      query,
      language,
      setCode,
      collectorNumber,
      variant,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    });
    return { items: items.map(toCardIdentityDto) };
  }

  @Get(':cardId/prices')
  async prices(
    @Param('cardId') cardId: string,
    @Query('market') marketQuery?: Market,
  ): Promise<PriceResponse> {
    const allowedMarkets: Market[] = ['US', 'JP', 'KR'];
    if (marketQuery && !allowedMarkets.includes(marketQuery)) {
      throw new BadRequestException('invalid market');
    }
    const market: Market = marketQuery ?? 'US';
    return this.priceService.getPrice(cardId, market);
  }
}
