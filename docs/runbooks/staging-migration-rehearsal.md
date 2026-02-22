# Staging Migration and Rollback Rehearsal

이 문서는 스테이징에서 DB 마이그레이션/롤백 리허설을 수행하는 절차다.

## 목표

- 마이그레이션 적용 경로를 배포 전에 검증
- 실패 시 복구 시간을 측정해 RTO 달성 가능 여부 확인
- 배포 중단 기준(Go/No-Go)을 명확히 유지

## 사전 조건

- 스테이징 DB 연결 정보(`STAGING_DATABASE_URL`)
- 최신 백업 파일 확보
- API DB 통합 테스트 실행 가능 상태

## 리허설 절차

1. 리허설 시작 전 스냅샷 확보
   - Postgres 기준:
     - `pg_dump "$STAGING_DATABASE_URL" -Fc -f staging-pre-rehearsal.dump`

2. 스키마 적용
   - 마이그레이션 파일이 존재하면:
     - `pnpm -C apps/api exec prisma migrate deploy`
   - 마이그레이션 파일이 없으면(현재 리포 상태):
     - `pnpm -C apps/api exec prisma db push`

3. 핵심 검증
   - `pnpm -C apps/api test -- tests/db-integration.test.ts`
   - `pnpm -C apps/api test:fast`

4. 실패 복구(롤백) 리허설
   - 애플리케이션 쓰기 트래픽 차단
   - DB 복구 실행:
     - `dropdb --if-exists "$STAGING_DATABASE_URL"`
     - `createdb "$STAGING_DATABASE_URL"`
     - `pg_restore --clean --if-exists --no-owner -d "$STAGING_DATABASE_URL" staging-pre-rehearsal.dump`
   - API 통합 테스트 재실행으로 정상화 확인

## Go/No-Go 기준

- Go:
  - 마이그레이션 성공
  - DB 통합 테스트 통과
  - 복구 경로 검증 성공
- No-Go:
  - 데이터 불일치 발생
  - 테스트 실패 재현
  - 복구 절차가 목표 시간 내 완료되지 않음

## 기록 템플릿

- 리허설 일시:
- 담당자:
- 변경 요약:
- 마이그레이션 수행 시간:
- 복구 수행 시간:
- 결과(Go/No-Go):
- 후속 조치:

## 자동화

- 수동 실행 워크플로우: `.github/workflows/staging-rehearsal.yml`
- GitHub Secrets 필요:
  - `STAGING_DATABASE_URL`
  - `STAGING_REDIS_URL` (선택)
- 실행 결과 기록 자동화:
  - `OWNER=<name> RESULT=<GO|NO-GO> MIGRATION_DURATION=<e.g. 8m> RECOVERY_DURATION=<e.g. 22m> SUMMARY="..." FOLLOW_UP="..." bash scripts/record-staging-rehearsal-result.sh`
