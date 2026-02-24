# Incident Response Runbook

This runbook defines incident classification, mitigation, and recovery steps.

## Severity Levels

- `SEV-1`: Core flow down (recognize or pricing unavailable for most users)
- `SEV-2`: Elevated errors/latency with degraded but usable service
- `SEV-3`: Non-critical operational issue with workaround

## Initial Triage (first 10 minutes)

1. Confirm scope: endpoint(s), market(s), provider(s), error ratio.
2. Check dashboards/alerts: API 5xx, provider failures, circuit opens, cache errors.
3. Identify blast radius: web-only, api-only, provider-only, or data layer.

## Containment Actions

- Provider instability: reduce retries, fail over to stub path where allowed.
- Redis instability: keep service on in-memory fallback and monitor cache miss increase.
- DB failure risk: block writes, preserve recovery path, prepare restore.

## Recovery Verification

- `GET /health` returns `ok=true`
- `GET /health/metrics` shows stable trend for 5xx/circuit/cache errors
- Recognize-to-price key flow succeeds in web E2E or manual smoke

## Communication

- Open incident channel with severity and owner.
- Post updates at fixed cadence:
  - SEV-1 every 15 minutes
  - SEV-2 every 30 minutes
  - SEV-3 hourly

## Post-Incident

1. Record timeline, root cause, customer impact.
2. Link follow-up tasks to release gate or runbook updates.
3. Add test/alert coverage to prevent recurrence.
