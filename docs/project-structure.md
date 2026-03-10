# Project Structure

## Monorepo overview

```text
pokecard-price-app/
|- apps/
|  |- api/        # NestJS API server
|  \- web/        # Next.js web client
|- packages/
|  \- shared/     # Shared TypeScript types/contracts
|- docs/           # Policies, runbooks, project status docs
|- infra/          # Docker and observability configs
|- scripts/        # Release/ops helper scripts
|- tests/          # Shared fixtures and high-res samples
|- README.txt
|- BUILDUP.md
|- package.json
|- pnpm-workspace.yaml
\- pnpm-lock.yaml
```

## apps/api (NestJS)

```text
apps/api/
|- src/
|  |- main.ts                  # API bootstrap
|  |- module.ts                # Root module wiring
|  |- routes/
|  |  |- health.controller.ts
|  |  |- prices.controller.ts
|  |  \- recognize.controller.ts
|  \- services/                # Domain/service layer
|- prisma/                     # Prisma schema/migrations/seeding context
|- tests/                      # API tests (fast/integration)
|- scripts/                    # API helper scripts
\- package.json
```

## apps/web (Next.js App Router)

```text
apps/web/
|- app/
|  |- page.tsx                 # Main UI flow and state orchestration
|  |- layout.tsx               # App layout
|  |- globals.css              # Global styles
|  |- components/
|  |  |- upload-camera-crop-section.tsx
|  |  |- candidates-section.tsx
|  |  \- manual-search-price-section.tsx
|  |- hooks/
|  |  |- use-recognize.ts
|  |  |- use-card-search.ts
|  |  |- use-price.ts
|  |  \- fetch-with-timeout.ts
|  \- utils/
|- tests/                      # Web unit/component tests (Vitest)
|- playwright.config.ts        # E2E config
\- package.json
```

## packages/shared

```text
packages/shared/
|- src/
|  \- index.ts                 # Shared request/response/types
|- tests/
\- package.json
```

## infra and operations

```text
infra/
|- docker-compose.yml          # Local Postgres/Redis
\- observability/
   |- prometheus.yml
   |- alerts.yml
   |- alertmanager.yml
   \- grafana/

scripts/
|- release-readiness-check.mjs
|- observability-smoke.sh
|- verify-required-checks.sh
\- (other runbook automation scripts)
```

## docs

```text
docs/
|- project-status.md
|- production-readiness-checklist.md
|- cache-policy.md
|- observability-baseline.md
\- runbooks/
   |- incident-response.md
   |- backup-restore.md
   |- staging-migration-rehearsal.md
   \- (other operational runbooks)
```

## Notes

- Generated/runtime directories such as `node_modules/`, `dist/`, `.next/`, `playwright-report/`, and `test-results/` are intentionally omitted from the structure focus.
- Source of truth for commands and conventions remains `AGENTS.md` and `README.txt`.
