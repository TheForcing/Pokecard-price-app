#!/usr/bin/env bash
set -euo pipefail

RUNBOOK_PATH=${RUNBOOK_PATH:-docs/runbooks/staging-migration-rehearsal.md}

if [[ ! -f "$RUNBOOK_PATH" ]]; then
  printf 'Runbook file not found: %s\n' "$RUNBOOK_PATH" >&2
  exit 1
fi

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
OWNER=${OWNER:-unknown}
RESULT=${RESULT:-PENDING}
MIGRATION_DURATION=${MIGRATION_DURATION:-unknown}
RECOVERY_DURATION=${RECOVERY_DURATION:-unknown}
SUMMARY=${SUMMARY:-staging rehearsal execution}
FOLLOW_UP=${FOLLOW_UP:-none}

cat <<EOF >> "$RUNBOOK_PATH"

## Rehearsal Record - ${NOW}

- 리허설 일시: ${NOW}
- 담당자: ${OWNER}
- 변경 요약: ${SUMMARY}
- 마이그레이션 수행 시간: ${MIGRATION_DURATION}
- 복구 수행 시간: ${RECOVERY_DURATION}
- 결과(Go/No-Go): ${RESULT}
- 후속 조치: ${FOLLOW_UP}
EOF

printf 'Appended rehearsal record to %s\n' "$RUNBOOK_PATH"
