#!/usr/bin/env bash
set -euo pipefail

CONFIG_PATH=${1:-infra/observability/alertmanager.yml}

if [[ ! -f "$CONFIG_PATH" ]]; then
  printf 'Alertmanager config not found: %s\n' "$CONFIG_PATH" >&2
  exit 1
fi

has_placeholder=false

if grep -Eq 'example\.invalid|ops@example\.com|alertmanager@example\.com|smtp\.example\.com|change-me' "$CONFIG_PATH"; then
  has_placeholder=true
fi

if grep -Eq '^route:\s*$' "$CONFIG_PATH" && grep -Eq 'receiver:\s*default-log' "$CONFIG_PATH"; then
  printf 'Route receiver is still default-log. Configure a real receiver for production.\n' >&2
  has_placeholder=true
fi

if [[ "$has_placeholder" == true ]]; then
  printf 'Observability channel config is NOT production-ready: %s\n' "$CONFIG_PATH" >&2
  printf 'Replace Slack/Email placeholders and set route.receiver to the active channel.\n' >&2
  exit 1
fi

printf 'Observability channel config looks production-ready: %s\n' "$CONFIG_PATH"
