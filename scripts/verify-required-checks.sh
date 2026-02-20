#!/usr/bin/env bash
set -euo pipefail

TOKEN=${GITHUB_TOKEN:-${GH_TOKEN:-}}
if [[ -z "$TOKEN" ]]; then
  printf 'GITHUB_TOKEN (or GH_TOKEN) is required\n' >&2
  exit 1
fi

REPO=${REPO:-}
if [[ -z "$REPO" ]]; then
  REMOTE_URL=$(git remote get-url origin)
  REPO=$(printf '%s' "$REMOTE_URL" | sed -E 's#https://github.com/([^/]+/[^/.]+)(\.git)?#\1#')
fi

if [[ -z "$REPO" ]]; then
  printf 'Unable to resolve repository. Set REPO=owner/repo\n' >&2
  exit 1
fi

BRANCH=${BRANCH:-}
if [[ -z "$BRANCH" ]]; then
  REPO_META=$(curl -fsS \
    -H "Accept: application/vnd.github+json" \
    -H "Authorization: Bearer ${TOKEN}" \
    "https://api.github.com/repos/${REPO}")
  BRANCH=$(printf '%s' "$REPO_META" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);process.stdout.write(j.default_branch||'');});")
fi

if [[ -z "$BRANCH" ]]; then
  printf 'Unable to resolve target branch. Set BRANCH explicitly\n' >&2
  exit 1
fi

JSON=$(curl -fsS \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer ${TOKEN}" \
  "https://api.github.com/repos/${REPO}/branches/${BRANCH}/protection")

printf '%s' "$JSON" | node -e "
let s='';
process.stdin.on('data', d => s += d).on('end', () => {
  const j = JSON.parse(s);
  const contexts = new Set((j.required_status_checks?.contexts ?? []));
  const needed = ['lint', 'typecheck', 'test', 'build'];
  const missing = needed.filter((name) => !contexts.has(name));
  const strictOk = j.required_status_checks?.strict === true;
  const adminsOk = j.enforce_admins?.enabled === true;
  if (!strictOk || !adminsOk || missing.length > 0) {
    process.stderr.write('Verification failed. strict=' + strictOk + ' admins=' + adminsOk + ' missing=' + missing.join(',') + '\\n');
    process.exit(1);
  }
});
"

printf 'Required checks verified on %s (%s): lint, typecheck, test, build\n' "$REPO" "$BRANCH"
