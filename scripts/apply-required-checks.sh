#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  printf 'GITHUB_TOKEN is required\n' >&2
  exit 1
fi

REMOTE_URL=$(git remote get-url origin)
REPO=$(printf '%s' "$REMOTE_URL" | sed -E 's#https://github.com/([^/]+/[^/.]+)(\.git)?#\1#')

if [[ -z "$REPO" ]]; then
  printf 'Unable to resolve repository from origin remote\n' >&2
  exit 1
fi

curl -sS -X PUT \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  "https://api.github.com/repos/${REPO}/branches/main/protection" \
  -d '{
    "required_status_checks": {
      "strict": true,
      "contexts": ["lint", "typecheck", "test", "build"]
    },
    "enforce_admins": true,
    "required_pull_request_reviews": {
      "dismiss_stale_reviews": true,
      "required_approving_review_count": 1
    },
    "required_conversation_resolution": true,
    "allow_force_pushes": false,
    "allow_deletions": false,
    "block_creations": false,
    "required_linear_history": false
  }'

printf 'Applied required checks to %s main branch\n' "$REPO"
