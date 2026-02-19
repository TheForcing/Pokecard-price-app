# Observability Baseline

이 문서는 배포 전 최소 관측성 기준(대시보드 + 알람)을 정의한다.

## 대상 지표

- API 성공률/에러율
- API p95/p99 latency
- OCR confidence 분포
- 공급자별 실패율/지연시간(TCGPLAYER, RAKUTEN, NAVER)
- DB 연결 실패율
- Redis 연결 실패율 및 캐시 hit/miss

## 로그 필드 표준

`apps/api/src/main.ts` 기준으로 아래 필드가 요청 로그에 포함된다.

- `event`
- `requestId`
- `method`
- `path`
- `statusCode`
- `durationMs`

권장: 애플리케이션 로그 수집기에서 JSON 파싱을 활성화하고 `requestId`로 추적 연결.

가격 조회 경로(`apps/api/src/services/price.service.ts`)는 아래 구조화 이벤트를 추가로 출력한다.

- `provider_call`
  - `provider` (`TCGPLAYER` | `RAKUTEN` | `NAVER`)
  - `operation` (`auth` | `search` | `pricing`)
  - `result` (`success`, `http_error`, `network_error`, `retrying_after_*`, `blocked_by_circuit`)
  - `latencyMs`, `attempt`, `maxAttempts`, `statusCode`(있는 경우)
- `provider_circuit`
  - `provider`, `action`(현재 `open`), `openMs`
- `cache_event`
  - `cache` (`redis` | `memory`)
  - `action` (`hit`, `miss`, `set`, `read_error`, `write_error`)
  - `key`

## 대시보드 최소 패널

1. Request Volume + 2xx/4xx/5xx 비율 (1m/5m)
2. Endpoint별 p95/p99 latency
3. Provider 실패율(분당) + 평균 응답시간
4. OCR confidence histogram (bucket: 0.0~1.0)
5. Redis cache hit/miss 비율
6. DB connection error count

## 필수 알람 룰

- 5xx 급증
  - 조건: 5분 평균 5xx 비율 > 3%
  - 지속: 10분
- 공급자 실패율 급증
  - 조건: provider별 실패율 > 20% (5분)
  - 지속: 10분
- DB 연결 실패
  - 조건: DB 연결 관련 에러 5회 이상/5분
- Redis 장애
  - 조건: Redis 연결 실패 로그 감지 + cache miss 급증

## 운영 점검 루틴

- 배포 직후 30분 집중 모니터링
- 24시간 내 일일 리뷰:
  - 에러 상위 endpoint
  - provider별 실패 원인 분류
  - OCR confidence 저구간(0.0~0.3) 비중

## 구현 가이드 (벤더 독립)

- 로그 기반 메트릭 생성:
  - `statusCode >= 500` 카운트
  - `durationMs` percentile 계산
- Provider 호출 로그 추가 권장 필드:
  - `provider`
  - `operation`
  - `result`(success/failure)
  - `latencyMs`
  - `errorType`

## 완료 기준

- [ ] 대시보드 URL 공유
- [ ] 알람 채널(슬랙/이메일) 연결
- [ ] 알람 테스트(의도적 실패) 1회 이상 성공
- [ ] 온콜 runbook에 링크 추가

## 구현 참고

- Prometheus 스크랩 샘플: `infra/observability/prometheus.yml`
- 알람 룰 샘플: `infra/observability/alerts.yml`
- 대시보드 연결 절차: `docs/runbooks/observability-dashboard-setup.md`
