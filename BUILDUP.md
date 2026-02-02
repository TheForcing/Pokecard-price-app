# Build-Up Plan

This document turns the initial plan into an actionable build plan aligned with the
current monorepo (Next.js web, NestJS API, shared types). It is scoped to what we
can implement safely in this codebase without external services yet.

## Goals (MVP)

- Web-first flow: upload/capture → recognize → show low/high price.
- Target markets: US/JP. Languages: KO/JA/EN.
- Low/high price only, with source + fetched_at.
- Show Top-5 candidates when recognition is uncertain.

## Phase 0: Baseline (Now)

- Web UI exists with stub recognize/price.
- API has stub controllers returning sample data.
- Shared types already define request/response shapes.

## Phase 1: Recognition Pipeline (MVP-ready)

### 1.1 Card normalization and candidates

- Server endpoint: `POST /recognize`
- Pipeline:
  1. Decode image (base64 → buffer).
  2. Try card detection + perspective transform.
  3. Extract OCR ROI (set/number/name hints).
  4. Embed image and search Top-K candidates (FAISS).
  5. Fuse OCR hints + similarity to rank candidates.

### 1.2 Failure and UX handling

- Return `candidates` array always; if confidence low, `best` can be undefined.
- Web: always render Top-5 candidate list, allow manual selection.

### 1.3 Recognition outputs

- `RecognizeResponse` stays as-is.
- Add optional debug fields (timing, steps hit) under `debug`.

## Phase 2: Pricing (US/JP)

### 2.1 API contract

- `GET /cards/:cardId/prices?market=US|JP`
- Response: `{ cardId, market, currency, low, high, source, fetchedAt }`

### 2.2 Data sources

- US: TCGplayer API (low/high).
- JP: start with a price-aggregation API; swap later if needed.

### 2.3 Caching

- Redis cache key: `price:{cardId}:{market}`
- TTL: 1-6 hours initially.
- Store snapshots to `prices` table for history.

## Phase 3: Data Catalog

### 3.1 Cards table

- Seed via public Pokemon TCG card API.
- Map internal `card_id` to external market IDs (TCGplayer / JP source).

### 3.2 ID normalization

- Normalize by language, set_code, card_number, variant.
- Add data QA checks for duplicates and mismatched set codes.

## Database Schema (Draft)

### cards

- id (PK)
- name
- language (KO/JA/EN)
- set_code
- card_number
- rarity
- variant (normal/holo/reverse/promo)
- image_url

### market_product_map

- card_id (FK)
- market (US/JP)
- source (TCGplayer/PriceCharting/etc)
- external_product_id

### prices

- card_id (FK)
- market
- currency
- low
- high
- source
- fetched_at

### recognition_logs

- id
- image_hash
- predicted_card_id
- candidates (json)
- confidence
- elapsed_ms
- created_at

## Web UX Changes (MVP)

- Add camera option using getUserMedia when available.
- Keep input capture for mobile as fallback.
- Display Top-5 candidates with confidence and image.
- Show price source and fetched time.

## API Changes (MVP)

- Replace stub recognize with:
  - image decode
  - detection/warp
  - OCR ROI (optional)
  - embedding + vector search
- Replace stub prices with:
  - market mapping
  - cached lookup
  - upstream fetch
  - snapshot store

## Risks & Mitigations

- OCR accuracy varies by language → ROI + preprocessing + fallback to embedding.
- JP pricing sources inconsistent → start with aggregation API; annotate source.
- Image quality issues → perspective transform + fallback crop.

## Implementation Order (Concrete)

1. Add DB schema + seed catalog in `packages/shared` types and API models.
2. Build recognition pipeline (server) with stubbed OCR and embedding.
3. Build price integration with cache and snapshots.
4. Improve web UI for capture + candidate selection + price display.
5. Add logging and observability for recognition.

## Done Criteria (MVP)

- Web: upload/capture → candidate list → selection → price low/high shown.
- API: real recognition pipeline + real price fetch (US at least).
- Cache and fetched_at displayed.
