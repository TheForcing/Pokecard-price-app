# AGENTS.md

This file orients coding agents to this repo. Follow existing patterns and keep
changes scoped to the relevant package.

## Repo map

- `apps/web`: Next.js app (app router, TypeScript)
- `apps/api`: NestJS API (TypeScript, ESM)
- `packages/shared`: shared TypeScript types
- `infra/docker-compose.yml`: Postgres + Redis for local dev

## Prerequisites

- Node.js 18+
- pnpm 9+
- Docker (optional for Postgres/Redis)

## Build, lint, typecheck, test

### Workspace-level

- Install: `pnpm install`
- Dev (all packages): `pnpm dev`
- Build (all packages): `pnpm build`
- Lint (all packages): `pnpm lint`
- Typecheck (all packages): `pnpm typecheck`
- Format (prettier): `pnpm format`
- Docker up/down: `pnpm docker:up` / `pnpm docker:down`

### Web app (`apps/web`)

- Dev: `pnpm -C apps/web dev`
- Build: `pnpm -C apps/web build`
- Start (prod): `pnpm -C apps/web start`
- Lint: `pnpm -C apps/web lint`
- Typecheck: `pnpm -C apps/web typecheck`

### API (`apps/api`)

- Dev (watch): `pnpm -C apps/api dev`
- Build: `pnpm -C apps/api build`
- Start (prod): `pnpm -C apps/api start`
- Lint: `pnpm -C apps/api lint` (currently prints "no lint configured")
- Typecheck: `pnpm -C apps/api typecheck`

### Shared types (`packages/shared`)

- Dev (watch): `pnpm -C packages/shared dev`
- Build: `pnpm -C packages/shared build`
- Lint: `pnpm -C packages/shared lint` (currently prints "no lint configured")
- Typecheck: `pnpm -C packages/shared typecheck`

### Tests

- Workspace fast tests: `pnpm test` or `pnpm test:fast`
- Workspace DB integration tests: `pnpm test:integration`
- Web tests: `pnpm -C apps/web test`
- API fast tests (default): `pnpm -C apps/api test` or `pnpm -C apps/api test:fast`
- API DB integration tests: `pnpm -C apps/api test:integration`
- Shared tests: `pnpm -C packages/shared test`
- Single test file: `pnpm -C packages/shared test -- tests/basic.test.ts`
- DB integration tests require `DATABASE_URL` and a reachable Postgres instance; `test:integration` sets `RUN_DB_INTEGRATION_TESTS=true` automatically.
- Redis is optional for DB integration tests. If `REDIS_URL` is not set, API falls back to in-memory cache.
- OCR smoke/benchmark tests are opt-in via `RUN_OCR_PIPELINE_SMOKE=true` and `RUN_OCR_BENCHMARK=true`.

## Runtime URLs and env

- Web: http://localhost:3000
- API: http://localhost:4000
- Web uses `NEXT_PUBLIC_API_BASE` (defaults to `http://localhost:4000`).

## Code style and conventions

### Formatting (Prettier)

- Config in `.prettierrc`:
  - semicolons enabled
  - single quotes
  - print width 100
  - trailing commas where valid
- Run `pnpm format` before committing large changes.

### TypeScript

- `strict: true` across packages.
- Prefer explicit types for exported APIs and shared types.
- Avoid `any`; use `unknown` and narrow when possible.
- Keep types in `packages/shared/src/index.ts` and import from `@pokecard/shared`.

### Imports

- Use `import type` for type-only imports.
- Group imports: external first, then internal relative imports.
- API and shared packages are ESM (`"type": "module"`):
  - Use `.js` extension for relative imports in TS (`./module.js`).
  - Keep `reflect-metadata` import first in `apps/api/src/main.ts`.

### Naming

- Types/interfaces: `PascalCase` (e.g., `RecognizeResponse`).
- Functions/vars: `camelCase`.
- React components: `PascalCase`.
- Files: `kebab.case` or `dot` for Nest controllers (`prices.controller.ts`).
- Hooks: `useX` naming for custom hooks.

### React / Next.js (apps/web)

- App Router files live under `apps/web/app`.
- Client components must start with `'use client';`.
- Prefer React hooks for state (`useState`, `useMemo`).
- Keep inline styles consistent with existing patterns when touching `page.tsx`.

### NestJS (apps/api)

- Controllers live under `apps/api/src/routes`.
- Use decorators (`@Controller`, `@Get`, `@Post`) and typed params.
- Return plain JSON objects that match shared types.

### Error handling

- Web: check `res.ok` for fetch; surface helpful error messages.
- API: validate inputs and return typed responses. Prefer NestJS exceptions for
  error cases instead of throwing raw errors.
- Do not swallow errors; set UI error state on failures.

### Data flow and shared types

- Use `@pokecard/shared` for request/response shapes.
- Keep stubs aligned between API and Web.
- When adding fields, update both API responses and UI consumption.

## Linting and static analysis

- Web uses `next lint` with `eslint-config-next` defaults.
- API/shared currently have no lint configured; keep code consistent with
  Prettier and TypeScript strict settings.

## Monorepo workflow tips

- Use `pnpm -C <path> <script>` for package-local scripts.
- Use workspace scripts for cross-package actions.
- If you change `packages/shared`, rebuild or typecheck dependents.

## Infra

- Docker compose file: `infra/docker-compose.yml` (Postgres + Redis).
- Start services with `pnpm docker:up` and stop with `pnpm docker:down`.

## Cursor/Copilot rules

- No `.cursor/rules`, `.cursorrules`, or `.github/copilot-instructions.md` were found.
