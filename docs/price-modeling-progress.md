# Price Modeling Progress

## Scope

- Condition, grading, and physical defects are excluded from pricing.
- Price is based on card identity + market + source.

## What Changed

### Data model (API)

- Added Prisma schema with:
  - CardIdentity (language, setCode, collectorNumber, variant, name)
  - ExternalProductMap (provider mapping)
  - PriceSnapshot (immutable price reads)
- New enums for Language, Market, CardVariant, ExternalProvider, PriceType.

### Shared types

- Added CardVariant, ExternalProvider, PriceType.
- Added CardIdentity and CardSearchResponse.
- Extended CandidateCard with optional identityId and variant.
- RecognizeResponse now includes needsUserPick.
- PriceResponse now includes optional priceType and capturedAt.

### API behavior

- /recognize imports EN candidates into CardIdentity and returns identityId.
- /cards/search added for manual lookup by name/set/number/variant.
- /cards/:cardId/prices now expects CardIdentity.id and resolves provider mapping.
- Price reads are stored as PriceSnapshot entries.

### Web UI

- Manual card search section added with variant filtering.
- Price lookup uses identityId when available.
- Low confidence results require user pick.

## Commands Run

- pnpm install
- pnpm -C packages/shared build
- pnpm -C apps/api prisma:generate
- pnpm -C apps/api build
- pnpm -C apps/web typecheck

## Next Steps

- Create DB and run migrations:
  - pnpm docker:up
  - pnpm -C apps/api prisma:migrate
- Add JP/KR catalog or manual card registration endpoint.
- Improve variant detection and mapping accuracy.
