export type Market = 'US' | 'JP';
export type Language = 'KO' | 'JA' | 'EN';

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
  confidence: number; // 0..1
  imageUrl?: string;
}

export interface RecognizeResponse {
  best?: CandidateCard;
  candidates: CandidateCard[];
  debug?: Record<string, unknown>;
}

export interface PriceResponse {
  cardId: string;
  market: Market;
  currency: string;
  low: number | null;
  high: number | null;
  source: string;
  fetchedAt: string; // ISO
}
