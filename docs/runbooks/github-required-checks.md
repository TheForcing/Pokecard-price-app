# GitHub Required Checks Runbook

이 문서는 `main` 브랜치에 필수 상태 체크를 강제하는 절차를 정의한다.

## 목표

- PR merge 전에 아래 체크를 반드시 통과하도록 강제
  - `lint`
  - `typecheck`
  - `test`
  - `build`

위 체크 이름은 `.github/workflows/ci.yml`의 job name과 정확히 일치해야 한다.

## 사전 조건

- 저장소 관리자 권한
- `gh auth status` 성공
- 기본 브랜치가 `main`

## 적용 명령 (GitHub CLI)

아래 명령은 현재 저장소의 `main` 브랜치 보호 규칙을 업데이트한다.

```bash
REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)

gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  "repos/$REPO/branches/main/protection" \
  -f required_status_checks.strict=true \
  -F required_status_checks.contexts[]='lint' \
  -F required_status_checks.contexts[]='typecheck' \
  -F required_status_checks.contexts[]='test' \
  -F required_status_checks.contexts[]='build' \
  -f enforce_admins=true \
  -f required_pull_request_reviews.dismiss_stale_reviews=true \
  -f required_pull_request_reviews.required_approving_review_count=1 \
  -f required_linear_history=false \
  -f allow_force_pushes=false \
  -f allow_deletions=false \
  -f block_creations=false \
  -f required_conversation_resolution=true
```

## 검증

```bash
REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
gh api "repos/$REPO/branches/main/protection" --jq '.required_status_checks.contexts'
```

출력에 `lint`, `typecheck`, `test`, `build`가 모두 포함되어야 한다.

## 실패 시 대응

- 403/404: 관리자 권한 또는 토큰 스코프 확인
- context 누락: CI workflow job 이름과 보호 규칙 context 이름 일치 여부 확인
- 체크가 Pending으로 고정: workflow 트리거(`pull_request`)와 브랜치 필터 확인
