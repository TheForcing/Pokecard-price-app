#!/usr/bin/env bash
set -euo pipefail

API_BASE=${API_BASE:-http://localhost:4000}
PROM_BASE=${PROM_BASE:-http://localhost:9090}
GRAFANA_BASE=${GRAFANA_BASE:-http://localhost:3001}

printf '[1/4] Check API metrics endpoints\n'
curl -fsS "${API_BASE}/health/metrics/prometheus" >/dev/null
curl -fsS "${API_BASE}/recognize/metrics/prometheus" >/dev/null

printf '[2/4] Check Prometheus readiness\n'
curl -fsS "${PROM_BASE}/-/ready" >/dev/null

printf '[3/4] Check Prometheus targets\n'
TARGETS=$(curl -fsS "${PROM_BASE}/api/v1/targets" | tr -d '\n')
printf '%s' "$TARGETS" | grep -q 'pokecard-api-health'
printf '%s' "$TARGETS" | grep -q 'pokecard-api-recognize'

printf '[4/4] Check Grafana health\n'
curl -fsS "${GRAFANA_BASE}/api/health" >/dev/null

printf 'Observability smoke check passed\n'
