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

Notes
- Recognition + pricing are stubbed. Replace /recognize and /cards/:id/prices with your pipeline.
