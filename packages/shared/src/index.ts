export type Market = 'US' | 'JP' | 'KR';
export type Language = 'KO' | 'JA' | 'EN';
export type CardVariant =
  | 'NORMAL'
  | 'HOLOFOIL'
  | 'REVERSE_HOLOFOIL'
  | 'FULL_ART'
  | 'ALT_ART'
  | 'SECRET'
  | 'PROMO'
  | 'OTHER';
export type ExternalProvider = 'POKEMONTCG' | 'TCGPLAYER' | 'RAKUTEN' | 'NAVER';
export type PriceType = 'LISTING' | 'AGGREGATED' | 'SOLD';

export interface CardIdentity {
  id: string;
  name: string;
  language: Language;
  setCode: string;
  setName?: string;
  collectorNumber: string;
  collectorTotal?: number;
  variant: CardVariant;
  rarity?: string;
  imageUrl?: string;
}

export interface CardSearchResponse {
  items: CardIdentity[];
}

export interface RecognizeRequest {
  // base64 data URL or raw base64; in production prefer multipart upload
  imageBase64: string;
  hint?: {
    language?: Language;
    market?: Market;
  };
}

export interface CandidateCard {
  cardId: string;
  name: string;
  setCode?: string;
  number?: string;
  language?: Language;
  variant?: CardVariant;
  identityId?: string;
  confidence: number; // 0..1
  imageUrl?: string;
}

export interface RecognizeResponse {
  best?: CandidateCard;
  candidates: CandidateCard[];
  needsUserPick?: boolean;
  debug?: Record<string, unknown>;
}

export interface PriceResponse {
  cardId: string;
  market: Market;
  currency: string;
  low: number | null;
  high: number | null;
  source: string;
  priceType?: PriceType;
  capturedAt?: string;
  fetchedAt: string; // ISO
}

export interface UpsertPriceRequest {
  market: Market;
  currency: string;
  low: number | null;
  high: number | null;
  source: ExternalProvider;
  priceType?: PriceType;
  capturedAt?: string;
  externalId?: string;
  externalUrl?: string;
  matchMethod?: string;
  matchConfidence?: number;
}

export interface ApiErrorResponse {
  statusCode: number;
  message: string | string[];
  error?: string;
}
