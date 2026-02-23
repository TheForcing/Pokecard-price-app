# Release, Versioning, and Rollback Policy

This runbook defines the minimum release gate, versioning convention, and rollback flow.

## Release Gate

- CI required jobs must pass on PR: `lint`, `typecheck`, `test`, `build`
- API DB integration test must pass: `pnpm -C apps/api test -- tests/db-integration.test.ts`
- Web E2E must pass: `pnpm -C apps/web test:e2e`
- No pending migration risk or unresolved `No-Go` items in staging rehearsal record

## Versioning Convention

- Follow SemVer for release tags: `vMAJOR.MINOR.PATCH`
- `PATCH`: bug fixes and low-risk internal changes
- `MINOR`: backward-compatible feature addition or operational behavior extension
- `MAJOR`: breaking contract change (API/shared type compatibility break)

## Release Notes Template

For each production release, record:

- Release tag and date/time (UTC)
- Scope summary (web/api/shared/infra)
- Risk notes (provider changes, schema changes, cache behavior changes)
- Verification evidence (CI URL, smoke command results)
- Rollback trigger conditions

## Rollback Trigger Conditions

Rollback immediately when one or more occur:

- 5xx error rate sustained above threshold
- Provider failure surge with circuit open events
- Severe data integrity issue found after deploy
- Critical user flow failure (recognize -> select -> price)

## Rollback Procedure

1. Freeze writes and stop new rollout traffic.
2. Revert application deployment to the previous stable release.
3. If schema/data issue exists, execute backup restore rehearsal procedure from `docs/runbooks/backup-restore.md`.
4. Re-run minimum verification:
   - `GET /health`
   - `GET /health/metrics`
   - API DB integration test
   - Web E2E key flow
5. Announce status and open postmortem action items.

## Ownership

- Primary owner: release manager on duty
- Secondary owner: API maintainer
- Tertiary owner: infra/observability maintainer
