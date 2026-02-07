Pokémon Card Price Finder (Web-first) - Starter Monorepo

What you get
- apps/web: Next.js (TypeScript) web UI (upload image -> stub recognize)
- apps/api: NestJS (TypeScript) API (health, recognize stub, price stub)
- packages/shared: shared types
- infra/docker-compose.yml: Postgres + Redis for local dev

Prereqs
- Node.js 18+
- pnpm 9+
- Docker (optional, for Postgres/Redis)

Quickstart
1) cd pokecard-price-app
2) pnpm install
3) pnpm docker:up   (optional)
4) pnpm dev

URLs
- Web: http://localhost:3000
- API: http://localhost:4000

Price provider env
- US (TCGplayer): PRICE_PROVIDER_US_CLIENT_ID, PRICE_PROVIDER_US_CLIENT_SECRET
  PRICE_PROVIDER_US_CATEGORY_ID (default 3), PRICE_PROVIDER_US_SOURCE (default TCGPLAYER)
- JP (Rakuten): PRICE_PROVIDER_JP_APP_ID, PRICE_PROVIDER_JP_SOURCE (default RAKUTEN)
- KR (Naver): PRICE_PROVIDER_KR_CLIENT_ID, PRICE_PROVIDER_KR_CLIENT_SECRET
  PRICE_PROVIDER_KR_SOURCE (default NAVER)
- Missing env values fall back to stub prices.

Notes
- Recognition + pricing are stubbed. Replace /recognize and /cards/:id/prices with your pipeline.
