# Backup and Restore Runbook (RPO/RTO)

이 문서는 Postgres 기준 백업/복구 운영 절차와 검증 기준을 정의한다.

## 목표 SLO

- RPO: 24시간 이내
- RTO: 60분 이내

위 목표를 충족하지 못하면 배포 승인 대상에서 제외한다.

## 백업 정책

- 주기: 1일 1회 전체 백업 + 배포 직전 추가 백업
- 포맷: custom dump(`pg_dump -Fc`)
- 보관: 최근 14일
- 암호화: 저장소 정책에 맞는 암호화 적용

## 백업 명령 예시

```bash
export DATABASE_URL="postgresql://user:pass@host:5432/dbname"
export BACKUP_FILE="backup-$(date +%Y%m%d-%H%M%S).dump"

pg_dump "$DATABASE_URL" -Fc -f "$BACKUP_FILE"
```

## 복구 리허설 절차 (월 1회 이상)

1. 복구 대상 DB 준비
   - 프로덕션과 분리된 rehearsal DB 사용
2. 백업 파일 복구
   - `pg_restore --clean --if-exists --no-owner -d "$REHEARSAL_DATABASE_URL" "$BACKUP_FILE"`
3. 정합성 확인
   - 주요 테이블 row count 비교
   - API DB 통합 테스트 실행
     - `pnpm -C apps/api test -- tests/db-integration.test.ts`
4. 시간 측정
   - 복구 시작/종료 시각 기록
   - RTO 60분 내 완료 여부 기록

## 복구 검증 체크리스트

- [ ] 복구 실행 로그 보관
- [ ] 핵심 테이블 row count 검증
- [ ] API DB 통합 테스트 통과
- [ ] 애플리케이션 헬스 체크 정상(`GET /health`)
- [ ] 캐시/외부 의존성 오류 로그 급증 없음

## 장애 대응 기본 흐름

1. 장애 선언 및 쓰기 트래픽 차단
2. 마지막 정상 백업 시점 확인(RPO 평가)
3. 복구 실행 및 검증
4. 서비스 재개
5. 사후 분석(Postmortem) 및 재발 방지 액션 등록

## 기록 템플릿

- 일시:
- 장애 유형:
- 백업 시점:
- 복구 완료 시점:
- 실제 RPO:
- 실제 RTO:
- 검증 결과:
- 후속 액션:
