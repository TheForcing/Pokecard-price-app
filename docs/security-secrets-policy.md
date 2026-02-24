# Security and Secrets Policy

This policy defines handling rules for credentials, environment variables, and sensitive logs.

## Secrets Handling

- Do not commit secrets in source control.
- Use environment variables or secret managers for runtime credentials.
- Required sensitive vars include provider credentials and staging/prod DB URLs.

## Environment Variable Management

- Local development uses `.env` files that remain untracked.
- CI and remote environments must use repository/org secrets.
- Any new secret variable must be documented in deployment notes.

## Logging Rules

- Request logs are structured JSON with request metadata only.
- Do not log provider credentials, auth headers, or raw secret values.
- Provider/circuit/cache events log operational state, not secret payloads.

## Rotation and Access

- Rotate provider credentials on a scheduled cadence (at least quarterly).
- Limit secret access to minimum required maintainers.
- Revoke and rotate immediately on exposure suspicion.

## Verification Checklist

- `git grep` for obvious key/token literals before release.
- Confirm CI secret-scoped jobs do not print secret values.
- Validate alerting channel configs are populated with real values before production.
