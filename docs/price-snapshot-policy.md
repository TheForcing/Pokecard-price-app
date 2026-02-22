# Price Snapshot Data Policy

이 문서는 가격 스냅샷(`price_snapshot`) 데이터의 보존, 중복, 정합성 기준을 정의한다.

## 범위

- 대상 테이블: `price_snapshot`, `external_product_map`, `card_identity`
- 대상 경로: `GET /cards/:cardId/prices`에서 생성/조회되는 가격 데이터
- 목표: 운영 비용을 통제하면서 조회 품질과 추적 가능성을 유지

## 보존 기간

- 기본 보존 기간: 180일
- 단기 분석용 핫 데이터: 최근 30일
- 180일 초과 데이터:
  - 운영 DB에서는 삭제 또는 아카이브 테이블로 이동
  - 감사/분석 목적이 있으면 별도 저장소(예: object storage)로 내보내기

## 중복 판단 기준

스냅샷 중복은 아래 조건을 모두 만족할 때로 본다.

- 동일 `external_product_map_id`
- 동일 `market`
- 동일 `source`
- 동일 정규화 가격 값(`low_price`, `mid_price`, `high_price`, `currency`)
- `fetched_at` 차이가 5분 이내

중복으로 판정된 레코드는 최신 1건만 유지하고 나머지는 정리 대상으로 분류한다.

## 정합성 점검 규칙

- 참조 무결성:
  - `price_snapshot.external_product_map_id`는 반드시 `external_product_map.id`를 참조
- 가격 값 규칙:
  - 음수 금지
  - `low_price <= mid_price <= high_price` (값이 존재하는 항목 기준)
- 통화 규칙:
  - `market=US -> USD`, `market=JP -> JPY`, `market=KR -> KRW`
- 시간 규칙:
  - `fetched_at`은 현재 시각 대비 미래값 허용 안 함

## 운영 정리 정책

- 실행 주기: 매일 1회(비피크 시간)
- 순서:
  1. 중복 후보 식별/삭제
  2. 보존 기간 초과 데이터 아카이브 또는 삭제
  3. 정합성 점검 결과 리포트 저장
- 실패 처리:
  - 정리 작업 실패 시 경고 알람 발행
  - 정합성 위반이 감지되면 삭제 중지 후 운영자 확인

## 점검 지표

- 총 스냅샷 row 수
- 30일/180일 구간 row 수
- 중복 정리 건수
- 정합성 위반 건수
- 정리 작업 소요 시간

## 검증 기준

- 샘플 데이터 기준 정리 전/후 row count 비교 로그 존재
- 정합성 위반 0건(또는 위반 원인/조치 기록)
- 운영 실행 절차 문서(`docs/runbooks/price-snapshot-maintenance.md`)와 일치
