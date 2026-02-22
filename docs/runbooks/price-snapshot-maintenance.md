# Price Snapshot Maintenance Runbook

이 문서는 가격 스냅샷 데이터 정리/검증의 운영 실행 절차를 정의한다.

관련 정책 문서: `docs/price-snapshot-policy.md`

## 목표

- 스냅샷 데이터 크기를 통제해 운영 비용을 안정화
- 중복/무결성 문제를 사전에 탐지
- 정리 작업 실패 시 빠르게 원인 파악 및 재시도

## 사전 조건

- `DATABASE_URL` 접근 가능
- 백업 정책에 따라 최근 백업 확보
- 점검 쿼리 실행 권한(read/write)

## 실행 절차

1. 사전 점검(정리 전)

```sql
-- 총 row 수
SELECT COUNT(*) AS total_rows FROM price_snapshot;

-- 최근 30일 row 수
SELECT COUNT(*) AS rows_30d
FROM price_snapshot
WHERE fetched_at >= NOW() - INTERVAL '30 days';

-- 보존기간(180일) 초과 row 수
SELECT COUNT(*) AS rows_over_180d
FROM price_snapshot
WHERE fetched_at < NOW() - INTERVAL '180 days';
```

2. 중복 후보 점검

```sql
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY external_product_map_id, market, source, currency,
                   COALESCE(low_price, -1), COALESCE(mid_price, -1), COALESCE(high_price, -1),
                   DATE_TRUNC('minute', fetched_at)
      ORDER BY fetched_at DESC, id DESC
    ) AS rn
  FROM price_snapshot
)
SELECT COUNT(*) AS duplicate_rows
FROM ranked
WHERE rn > 1;
```

3. 정리 실행

```sql
-- 예시: 보존기간 초과 데이터 삭제
DELETE FROM price_snapshot
WHERE fetched_at < NOW() - INTERVAL '180 days';
```

중복 삭제는 반드시 트랜잭션으로 수행하고, 실행 전 `SELECT` 결과를 기록한다.

4. 사후 점검(정리 후)

```sql
-- 음수 가격 검증
SELECT COUNT(*) AS invalid_negative_price
FROM price_snapshot
WHERE COALESCE(low_price, 0) < 0
   OR COALESCE(mid_price, 0) < 0
   OR COALESCE(high_price, 0) < 0;

-- 시간 무결성 검증(미래 시각)
SELECT COUNT(*) AS invalid_future_timestamp
FROM price_snapshot
WHERE fetched_at > NOW();
```

5. 리포트 기록

- 정리 전/후 row 수
- 삭제/아카이브 건수
- 무결성 위반 건수
- 소요 시간
- 실패 시 조치 내용

## 실패 대응

- 정리 실패:
  - 즉시 트랜잭션 롤백
  - SQL 에러 및 영향 범위를 운영 채널에 공유
- 무결성 위반 감지:
  - 자동 삭제 중지
  - 원인 레코드 샘플 추출 후 애플리케이션 입력 경로 점검

## 기록 템플릿

- 실행 일시:
- 담당자:
- 정리 전 row 수:
- 정리 후 row 수:
- 중복 정리 건수:
- 보존기간 초과 정리 건수:
- 무결성 위반 건수:
- 소요 시간:
- 후속 조치:
