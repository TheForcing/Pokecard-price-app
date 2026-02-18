Pokemon Card Price Finder (Monorepo)

What you get
- apps/web: Next.js (TypeScript) app with upload/crop/recognize flow, candidate selection, manual search, and price lookup UI
- apps/api: NestJS (TypeScript) API with health, recognize, search, and price endpoints
- packages/shared: shared request/response/types used by web and api
- infra/docker-compose.yml: Postgres + Redis for local dev runtime

Current implementation status
- Recognition is implemented in API with OCR pipeline (Tesseract and optional EasyOCR), image preprocessing/cropping, and candidate generation.
- Price lookup is implemented with market-specific providers:
  - US: TCGplayer
  - JP: Rakuten
  - KR: Naver
- If provider credentials are missing, price responses fall back to market-specific stub values.
- Price snapshots and provider mappings are persisted with Prisma.

Prereqs
- Node.js 18+
- pnpm 9+
- Docker (optional, for Postgres/Redis)

Quickstart
1) pnpm install
2) pnpm docker:up (optional, starts Postgres/Redis)
3) pnpm dev

URLs
- Web: http://localhost:3000
- API: http://localhost:4000

Environment
- Web
  - NEXT_PUBLIC_API_BASE (default: http://localhost:4000)
- API price providers
  - US (TCGplayer): PRICE_PROVIDER_US_CLIENT_ID, PRICE_PROVIDER_US_CLIENT_SECRET
    PRICE_PROVIDER_US_CATEGORY_ID (default 3), PRICE_PROVIDER_US_SOURCE (default TCGPLAYER)
  - JP (Rakuten): PRICE_PROVIDER_JP_APP_ID, PRICE_PROVIDER_JP_SOURCE (default RAKUTEN)
  - KR (Naver): PRICE_PROVIDER_KR_CLIENT_ID, PRICE_PROVIDER_KR_CLIENT_SECRET
    PRICE_PROVIDER_KR_SOURCE (default NAVER)
- API cache
  - REDIS_URL (optional; when set and reachable, Redis is used as primary cache)
  - PRICE_CACHE_NAMESPACE (default: price:v1)
  - PRICE_CACHE_TTL_SECONDS (default: 7200)
- API runtime guardrails
  - API_BODY_LIMIT_MB (default: 10)
  - API_ALLOWED_ORIGINS (comma-separated; default: http://localhost:3000)
  - API_RATE_LIMIT_WINDOW_MS (default: 60000)
  - API_RATE_LIMIT_MAX_REQUESTS (default: 120)
  - PRICE_PROVIDER_TIMEOUT_MS (default: 8000)
  - PRICE_PROVIDER_RETRY_COUNT (default: 2)
  - PRICE_PROVIDER_CIRCUIT_FAILURE_THRESHOLD (default: 5)
  - PRICE_PROVIDER_CIRCUIT_OPEN_MS (default: 30000)

Testing
- Workspace: pnpm test
- API: pnpm -C apps/api test
- DB-backed API integration tests require both:
  - DATABASE_URL
  - RUN_DB_INTEGRATION_TESTS=true
  If not set, DB integration tests are skipped.

Operational notes
- See docs/cache-policy.md for cache key, TTL, invalidation, and observability policy.
- Redis-backed cache is recommended for multi-instance deployments to avoid per-instance cache divergence.
- See docs/runbooks/github-required-checks.md for branch protection required checks.
- See docs/runbooks/staging-migration-rehearsal.md for staging migration/rollback rehearsal.
- See docs/runbooks/backup-restore.md for backup/restore RPO/RTO operations.
- See docs/observability-baseline.md for dashboard/alert minimum requirements.
