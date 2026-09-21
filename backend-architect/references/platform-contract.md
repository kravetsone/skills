# Platform contract — the names you do not get to choose

Deployment is GitLab CI (Kaniko build) → ArgoCD → Kubernetes, driven by shared manifests from `devops.jago.agency`, with secrets sealed via Bitnami SealedSecrets. The pipeline **injects a fixed set of environment variables**. Inventing `DB_URL` when the platform sets `DATABASE_URL` produces a plan that reads beautifully and cannot deploy.

Before writing any env var into a plan: check this list; if the name is not here, mark it as a new application variable that CI must be taught, and call that out explicitly as a deployment task.

## Injected by the platform

| Variable | Value | Note |
| --- | --- | --- |
| `DATABASE_URL` | Postgres connection string | requires `POSTGRES_ENABLED: 'true'` in CI |
| `REDIS_HOST` | Redis host | requires `REDIS_ENABLED: 'true'`; host only, not a URL |
| `S3_ENDPOINT` | public MinIO/S3 endpoint | used to build public asset URLs |
| `S3_INTERNAL_ENDPOINT` | in-cluster endpoint | use this for uploads — it avoids egress |
| `S3_ACCESS`, `S3_SECRET` | credentials | — |
| `S3_BUCKET`, `S3_REGION` | bucket / region | bucket must be listed in `MINIO_BUCKETS` |
| `PORT` | `8080` | must match `HTTP_PORT` and `S_PORT` |
| `PUBLIC_DOMAIN` | the assigned domain | the base for `API_URL` |
| `API_URL` | public base URL | defaults to `https://${PUBLIC_DOMAIN}` |
| `NODE_ENV` | `production` in prod | — |
| `USE_SSL` | `1` in prod | consumed by the migration step, not by app code |

## Sealed secrets

Declared in `.k8s/*.jsonnet` and listed in the CI `SECRETS` variable (e.g. `SECRETS: admin:production,token,token:production`). Observed names across services:

`BOT_TOKEN`, `WEBHOOK_SECRET`, `OPENAI_API_TOKEN`, `SENTRY_DSN`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_COOKIE_SECRET`, plus per-integration API tokens.

Adding a secret is a real task with a real lead time: generate the sealed value, add it to the jsonnet, add the name to `SECRETS`, redeploy. **Put it in the backlog as its own item** rather than assuming it appears.

## Application variables

Set as plain CI variables. Names are yours, but follow the established shapes:

| Variable | Purpose |
| --- | --- |
| `FRONTEND_URL` | CORS allow-list and deep links |
| `LOCK_STORE` | `memory` / `redis` — **must be `redis` in production** |
| `POSTHOG_API_KEY`, `POSTHOG_HOST` | analytics |
| `OPENAPI_PATH` | unguessable docs path; empty disables |
| `OWNER_IDS` | comma-separated admin Telegram ids |
| `TIMEZONE` | IANA zone for schedules, e.g. `Europe/Moscow` |
| `STATIC_URL` | CDN base overriding the S3-derived URL |
| `<DOMAIN>_*` | tunable business constants, grouped by prefix (`GAME_BONES_PER_XP`, `TAPS_MAX_LIMIT`) |

The `<DOMAIN>_*` convention is how the "Verbatim numbers" list from [requirements-extraction.md](requirements-extraction.md) lands in config instead of in code. Balance changes then become a redeploy, not a code review.

## Telemetry

| Variable | Purpose |
| --- | --- |
| `OTEL_SERVICE_NAME` | service name in traces |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | collector endpoint |

See [telemetry.md](telemetry.md).

## Pipeline-level variables (`.gitlab-ci.yml`)

Not visible to the app, but the plan's deployment section must specify them, because they decide whether a dependency exists at all:

```yaml
variables:
  DEPLOY_FROM: .k8s
  HTTP_ENABLED: 'true'
  HTTP_PORT: '8080'
  S_PORT: '8080'
  HTTP_HEALTH_CHECK: /health
  HTTP_CERT: auto
  HTTP_SUBDOMAIN: example.ru
  POSTGRES_ENABLED: 'true'
  REDIS_ENABLED: 'true'
  MINIO_ENABLED: 'true'
  MINIO_BUCKETS: static
  SECRETS: token,token:production
```

`HTTP_HEALTH_CHECK: /health` means **a `GET /health` must exist and stay cheap**. It is called constantly; it must not touch the database, or a slow query becomes a rolling restart. Exclude it from tracing too.

## NODE_TLS_REJECT_UNAUTHORIZED=0 — a production requirement, with a caveat

The managed Postgres presents a self-signed certificate, so the start command is:

```json
"start": "NODE_TLS_REJECT_UNAUTHORIZED=0 USE_SSL=1 bun x --bun drizzle-kit migrate && NODE_TLS_REJECT_UNAUTHORIZED=0 NODE_ENV=production bun run ./src/index.ts"
```

This is **required** — treat it as a given, not as a finding, and do not "fix" it in a plan.

State the consequence honestly, once, in the plan's platform-constraints section: the flag disables TLS verification **for the entire process**, including outbound calls to every third-party API — payment providers, LLM endpoints, partner systems. It is not scoped to the database connection.

If the plan involves outbound calls carrying secrets or money, note the two narrowing options so the team can make an informed choice:

1. `NODE_EXTRA_CA_CERTS=/path/to/ca.pem` — trust that one CA, keep verification everywhere else. The correct fix.
2. Keep the flag on the **migration step only**, and run the app process with a properly configured TLS connection (`ssl: { rejectUnauthorized: false }` scoped to the Postgres client).

Recommend option 2 as the pragmatic move: it is a one-line change to the start script and it confines the exposure to a step that talks only to the database.

## Health and probes

- `GET /health` → `"ok"`, no dependency checks, no tracing.
- If you want dependency status, that is `GET /ready` — a *separate* endpoint, because a readiness failure should stop traffic, while a liveness failure restarts the pod.

## Local development

`docker-compose.dev.yml` providing Postgres and Redis; `.env.example` listing every variable with a safe placeholder. The example file is the human-readable half of the contract — `config.ts` is the enforced half.
