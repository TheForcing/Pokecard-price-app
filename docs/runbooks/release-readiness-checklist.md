# Release Readiness Checklist

이 문서는 실제 사용자 배포 전에 최소한으로 확인해야 하는 검증 순서를 정의한다.

## 목표

- 앱이 사용자 주요 흐름(인식, 수동 검색, 가격 조회)에서 안정적으로 동작하는지 확인
- DB/캐시 연동 경로와 빌드 산출물 품질을 배포 전에 강제

## 사전 조건

- Docker Desktop 실행 상태
- Node.js 18+
- pnpm 9+

## 권장 실행 순서

1) 인프라 기동

```bash
pnpm docker:up
```

2) 원커맨드 릴리스 게이트 실행

```bash
pnpm release:check
```

`release:check`는 아래 항목을 순서대로 실행한다.

- Postgres reachability 확인 (`DATABASE_URL`)
- Prisma schema sync (`pnpm -C apps/api exec prisma db push`)
- Fast tests (`pnpm test`)
- API DB integration tests (`pnpm test:integration`)
- OCR smoke (`pnpm ocr:manual`)
- Typecheck + Build (`pnpm typecheck`, `pnpm build`)
- Web E2E (`pnpm -C apps/web test:e2e`)

## 실패 시 대응

- `database unreachable`:
  - `docker compose -f infra/docker-compose.yml ps`로 `postgres` 상태 확인
  - 필요 시 `pnpm docker:down && pnpm docker:up`
- `prisma db push` 실패:
  - `DATABASE_URL` 확인
  - 스키마 충돌 시 migration 상태 점검
- Web E2E 실패:
  - `apps/web/playwright-report` 확인
  - `apps/web/test-results` trace/screenshot 확인

## CI 정합성

- CI (`.github/workflows/ci.yml`)는 `lint`, `typecheck`, `test`, `build`를 필수 게이트로 사용한다.
- 로컬에서는 `pnpm release:check`를 최종 배포 전 점검 커맨드로 사용한다.
