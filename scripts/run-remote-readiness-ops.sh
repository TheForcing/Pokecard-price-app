#!/usr/bin/env bash
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  printf 'gh CLI is required but not installed.\n' >&2
  exit 1
fi

TOKEN=${GITHUB_TOKEN:-${GH_TOKEN:-}}
if [[ -z "$TOKEN" ]]; then
  printf 'GITHUB_TOKEN (or GH_TOKEN) is required.\n' >&2
  exit 1
fi

printf 'Applying and verifying required checks...\n'
bash scripts/apply-required-checks.sh
bash scripts/verify-required-checks.sh

printf 'Dispatching staging rehearsal workflow...\n'
gh workflow run staging-rehearsal.yml

printf 'Recent staging rehearsal runs:\n'
gh run list --workflow staging-rehearsal.yml --limit 3

printf 'Remote readiness ops completed.\n'
