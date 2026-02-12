# Price Cache Policy

This document defines the API price-cache behavior for multi-instance deployments.

## Scope

- Target: `apps/api/src/services/price.service.ts`
- Data: `PriceResponse` payloads for `GET /cards/:cardId/prices`
- Goal: consistent cache behavior across multiple API instances

## Key policy

- Namespace: `price:v1` (override with `PRICE_CACHE_NAMESPACE`)
- Key format: `<namespace>:<market>:<cardId>`
- Example: `price:v1:US:ckv123...`

Using a versioned namespace (`v1`) allows safe key migration when cache schema changes.

## TTL policy

- Default TTL: 7200 seconds (2 hours)
- Override via: `PRICE_CACHE_TTL_SECONDS`
- Requirement: positive integer only; invalid values fall back to default

TTL applies to Redis and in-memory fallback consistently.

## Storage policy

- Primary cache: Redis (`REDIS_URL` present and reachable)
- Fallback cache: in-memory `Map` when Redis is not configured/unavailable
- On cache read:
  - try Redis first
  - fall back to in-memory
- On cache write:
  - write to Redis if available
  - otherwise write to in-memory

## Invalidation policy

- Service method: `invalidateCardCache(cardId, market?)`
- If market is provided: invalidate single key
- If market is omitted: invalidate all supported markets (`US`, `JP`, `KR`)

This supports explicit invalidation after future pricing backfills or mapping updates.

## Observability policy

- Emit debug logs for:
  - cache hit (`redis` or `memory`)
  - cache miss
  - cache set (`redis` or `memory`)
- Emit warning logs for:
  - Redis read/write failures
  - Redis connection/runtime errors

The service keeps operating under Redis failures by falling back to memory.

## Operational notes

- For production, Redis should be enabled to avoid per-instance divergence.
- In-memory fallback is intended for local/dev or degraded operation, not steady-state multi-instance production.
