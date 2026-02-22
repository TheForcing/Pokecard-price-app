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
- Alertmanager (알람 채널 라우팅)

## 빠른 시작 (로컬)

1. 인프라 서비스 기동

```bash
pnpm docker:up
docker compose -f infra/docker-compose.yml up -d prometheus grafana alertmanager
```

2. API 실행 (`http://localhost:4000`)

```bash
pnpm -C apps/api dev
```

3. 대시보드 접속

- Grafana: `http://localhost:3001` (`admin` / `admin`)
- Prometheus: `http://localhost:9090`
- Alertmanager: `http://localhost:9093`

4. 스모크 검증

```bash
bash scripts/observability-smoke.sh
```

성공 시 `Observability smoke check passed` 출력.

## 1) Prometheus 스크랩 설정

- 샘플 설정 파일: `infra/observability/prometheus.yml`
- 알람 룰 파일: `infra/observability/alerts.yml`

핵심 포인트:

- Docker에서 Prometheus를 띄우면 target을 `host.docker.internal:4000`으로 사용
- 로컬 네이티브 실행이면 target을 `localhost:4000`으로 변경

## 2) Grafana 데이터소스 연결

이 저장소는 자동 프로비저닝을 사용한다.

- 데이터소스: `infra/observability/grafana/provisioning/datasources/datasources.yml`
- 대시보드 프로바이더: `infra/observability/grafana/provisioning/dashboards/dashboards.yml`
- 대시보드 JSON: `infra/observability/grafana/dashboards/pokecard-observability.json`

수동 추가가 필요하면 Prometheus URL을 `http://prometheus:9090`으로 설정한다.

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
- `infra/observability/alertmanager.yml`를 Alertmanager가 로드
- 최소 알람:
  - Provider p95 latency 상승
  - Provider HTTP error 증가
  - Circuit breaker open
  - OCR 저신뢰 결과 급증

알람 채널 연결:

- Slack: `infra/observability/alertmanager.yml`의 `slack-webhook` receiver 사용
- Email: `email-alert` receiver 사용
- 운영에서는 route receiver를 `default-log`에서 실제 채널 receiver로 변경

운영 전 채널 설정 검증:

```bash
bash scripts/verify-observability-channel-config.sh
```

위 검증은 placeholder(`example.invalid`, `change-me`) 또는 `default-log` 라우팅이 남아 있으면 실패한다.

기본 템플릿은 로컬 부팅 안전성을 위해 placeholder 값을 사용한다.
운영 적용 전 반드시 아래 값을 실제 값으로 교체한다.

- `https://example.invalid/slack-webhook`
- `auth_password: change-me`

## 5) 검증 체크리스트

- [ ] Prometheus Targets 페이지에서 두 엔드포인트 모두 UP
- [ ] Grafana 패널 데이터 표시 확인
- [ ] 테스트 요청 후 카운터 증가 확인
- [ ] 알람 테스트(임계치 초과 시뮬레이션) 1회 성공

## 알람 발화 테스트 예시

1. `infra/observability/alerts.yml`에서 임계치를 일시적으로 낮춤(예: `pokecard_provider_circuit_open_total > 0` 유지).
2. API에 실패 유도 요청을 반복 전송해 관련 카운터 증가.
3. Alertmanager UI(`http://localhost:9093`)에서 firing 확인.
4. Slack/Email 수신 확인 후 임계치를 원복.

또는 synthetic alert로 경로 자체를 즉시 점검한다.

```bash
bash scripts/observability-fire-test-alert.sh
```

성공 시 Alertmanager에 `PokecardSyntheticTestAlert`가 표시된다.
