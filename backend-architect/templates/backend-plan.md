<!--
  BACKEND-PLAN.md — skeleton.

  Headings may be translated into the language of the source spec. The
  `<!-- section: ... -->` markers must NOT be translated: plan-lint.mjs uses
  them to find sections regardless of language. Each marker sits on the line
  above its heading.

  Every factual claim carries a citation — REQ-###, SCR-### or a Figma node id.
  A section with no citations is a section somebody invented.
-->

# <Project> — backend plan

<!-- section: summary -->
## Summary

<!-- Five sentences, for someone who has read neither the spec nor Figma.
     What is being built, who uses it, what the hard part is, what the shape
     of the backend is, and what is explicitly out of scope. -->

<!-- section: sources -->
## Sources

| Source | Fetched | Size | Note |
| --- | --- | --- | --- |
| ТЗ — <google docs url> | YYYY-MM-DD | NN KB | |
| Figma — <file key> | YYYY-MM-DD | NN screens, NN flow edges | Dev Mode annotations are not exposed over REST |

**Not available:** <what was asked for and did not arrive — this shapes how much of the plan is inference>

<!-- section: open-questions -->
## Open questions

| # | Question | Why it matters | Assumed for now |
| --- | --- | --- | --- |
| Q-001 | | | |

<!-- An empty section here is suspicious. A plan with no open questions
     usually means somebody guessed and did not say so. -->

<!-- section: domain-model -->
## Domain model

### Entities

| Entity | Identity (what makes two rows the same real thing) | Lifecycle |
| --- | --- | --- |

### Invariants

<!-- Sentences that must be true at every commit boundary. These become CHECK
     constraints, unique indexes and tests — so write them as claims, not as
     intentions. "A user's balance is never negative." (REQ-###) -->

1.
2.

<!-- section: data-model -->
## Data model

### Tables

| Table | Purpose | Key columns | Requirement |
| --- | --- | --- | --- |

### Constraints

| Constraint | Enforces invariant | Kind |
| --- | --- | --- |

### Indexes

| Index | Serves query | Kind |
| --- | --- | --- |

<!-- Every constraint maps to an invariant above; every index maps to a query
     that exists. An index with no query is a write-time cost with no reader. -->

<!-- section: api-contract -->
## API contract

| Method + path | Purpose | Auth | Errors | REQ / SCR |
| --- | --- | --- | --- | --- |
| GET /health | liveness for the ingress | none | — | platform |

<!-- Error codes are SCREAMING_SNAKE literals in a typed union, not free text.
     Race outcomes are 409. 401 = who are you, 403 = no. -->

<!-- section: bot-contract -->
## Bot contract

| Trigger | Kind | Scene / handler | State | REQ |
| --- | --- | --- | --- | --- |
| /start | command | | — | |

<!-- section: concurrency -->
## Concurrency register

| ID | Invariant | Class | Guard (database-level) | Lock | Failure |
| --- | --- | --- | --- | --- | --- |
| H-001 | | | | | |

<!-- Full stories live in design/hotspots.md. Every row's guard is a mechanism
     the database enforces — a lock alone fails hotspot-scan.mjs, because
     verrou issues no fencing token. -->

<!-- section: background -->
## Background work

| Task | Trigger | Idempotency | Retries | After last attempt | Flow control |
| --- | --- | --- | --- | --- | --- |

| Schedule | Cron | Timezone | onMissed | Why |
| --- | --- | --- | --- | --- |

<!-- Delivery is at-least-once, so "it will not run twice" is not an idempotency
     answer. Name the barrier. -->

<!-- section: configuration -->
## Configuration

| Variable | Type | Required | Default | Source | Purpose |
| --- | --- | --- | --- | --- | --- |
| DATABASE_URL | string | yes | — | platform | |
| REDIS_HOST | string | yes | — | platform | |
| LOCK_STORE | enum | yes | memory | application | must be `redis` in production |

**New to CI:** <names the pipeline does not set yet — each one is a backlog item with a lead time>

<!-- section: observability -->
## Observability

| Signal | What it answers | Alert threshold |
| --- | --- | --- |

<!-- Spans, metrics, and the thresholds that should page someone. /health is
     excluded from tracing. No personal data in span attributes or logs. -->

<!-- section: analytics -->
## Analytics

See [docs/analytics.md](analytics.md) — the single source of truth for events,
properties and identity. Not duplicated here.

<!-- section: scaling -->
## Scaling

| Signal | Threshold | Action |
| --- | --- | --- |

**Capacity arithmetic:** <expected users, peak RPS, the query that will hurt first>

<!-- Monolith. Replicas, not services. Name the metric that would justify
     splitting something out, and do not split before it. -->

<!-- section: platform -->
## Platform constraints

- Deploy: GitLab CI (Kaniko) → ArgoCD → Kubernetes; secrets via SealedSecrets.
- `GET /health` must exist and stay cheap — `HTTP_HEALTH_CHECK: /health` calls it constantly.
- `NODE_TLS_REJECT_UNAUTHORIZED=0` is required in production (self-signed Postgres certificate).
  It disables TLS verification for the **entire process**, including outbound third-party calls.
  Recommended narrowing: keep the flag on the migration step only.
- Pipeline variables this service needs: <POSTGRES_ENABLED, REDIS_ENABLED, MINIO_ENABLED, MINIO_BUCKETS, SECRETS>

<!-- section: decisions -->
## Decisions

| ADR | Decision | Main tradeoff |
| --- | --- | --- |
| ADR-001 | | |

<!-- section: traceability -->
## Traceability

<!-- Generated: node backend-architect/scripts/coverage-report.mjs
     then paste out/traceability.md here. -->
