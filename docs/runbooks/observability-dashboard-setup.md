# Observability Dashboard Setup (Prometheus + Grafana)

이 문서는 API 메트릭 엔드포인트를 Prometheus/Grafana 대시보드로 연결하는 절차를 정의한다.

## 대상 엔드포인트

- `GET /health/metrics/prometheus`
- `GET /recognize/metrics/prometheus`

기본 로컬 주소:

- `http://localhost:4000/health/metrics/prometheus`
- `http://localhost:4000/recognize/metrics/prometheus`

## 준비물

- API 서버 실행 상태
- Prometheus
- Grafana

## 1) Prometheus 스크랩 설정

- 샘플 설정 파일: `infra/observability/prometheus.yml`
- 알람 룰 파일: `infra/observability/alerts.yml`

핵심 포인트:

- Docker에서 Prometheus를 띄우면 target을 `host.docker.internal:4000`으로 사용
- 로컬 네이티브 실행이면 target을 `localhost:4000`으로 변경

## 2) Grafana 데이터소스 연결

1. Grafana -> Data sources -> Prometheus 추가
2. Prometheus URL 입력
3. Save & Test 성공 확인

## 3) 대시보드 패널 권장 구성

1. Provider p95/p99 latency
   - `pokecard_provider_latency_ms{stat="p95"}`
   - `pokecard_provider_latency_ms{stat="p99"}`
2. Provider error trends
   - `pokecard_provider_calls_total{result="http_error"}`
   - `pokecard_provider_calls_total{result="network_error"}`
3. Circuit breaker openings
   - `pokecard_provider_circuit_open_total`
4. Cache hit/miss
   - `pokecard_cache_events_total{action="hit"}`
   - `pokecard_cache_events_total{action="miss"}`
5. OCR confidence buckets
   - `pokecard_ocr_confidence_bucket`
6. Recognize latency
   - `pokecard_recognize_latency_ms{stat="p95"}`
   - `pokecard_recognize_latency_ms{stat="p99"}`

## 4) 알람 적용

- `infra/observability/alerts.yml`를 Prometheus rule_files로 로드
- 최소 알람:
  - Provider p95 latency 상승
  - Provider HTTP error 증가
  - Circuit breaker open
  - OCR 저신뢰 결과 급증

## 5) 검증 체크리스트

- [ ] Prometheus Targets 페이지에서 두 엔드포인트 모두 UP
- [ ] Grafana 패널 데이터 표시 확인
- [ ] 테스트 요청 후 카운터 증가 확인
- [ ] 알람 테스트(임계치 초과 시뮬레이션) 1회 성공
