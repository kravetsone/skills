# Templates

Paste-ready implementations of every pattern the plan references. Reference
them from `BACKEND-PLAN.md` by path; copy them into the target repo at
implementation time and rename the domain nouns.

These are **corrected** versions. Several are derived from real services on
this stack where the pattern was wrong — the comments say what broke and why,
because a rule you understand you will apply in situations the rule never
anticipated.

## Documents

| File | Use |
| --- | --- |
| [backend-plan.md](backend-plan.md) | The main deliverable. Carries `<!-- section: ... -->` markers that `plan-lint.mjs` matches on, so headings may be translated but markers may not. |
| [adr.md](adr.md) | One decision a competent engineer could reasonably disagree with. |
| [analytics-spec.md](analytics-spec.md) | Lands as `docs/analytics.md` and becomes the single source of truth. |
| [backlog.md](backlog.md) | Sequenced, sized, with the infrastructure tasks people forget. |
| [AGENTS.md](AGENTS.md) | For the target repo. The first thing every future agent session reads. |
| [openapi-skeleton.yaml](openapi-skeleton.yaml) | The target contract — what unblocks the frontend on day one. |

## Infrastructure

| File | Pattern |
| --- | --- |
| [config.ts](config.ts) | The single `process.env` boundary; required secrets; production-only assertions. |
| [locks.ts](locks.ts) | Verrou with an explicit TTL and an explicit retry timeout — both defaults will bite you. |
| [otel.ts](otel.ts) | Traces, metrics and logs over OTLP, with `/health` excluded and a span-attribute allow-list. |
| [taskora-setup.ts](taskora-setup.ts) | Task, flow control and schedule shapes. The full API lives in the taskora skill. |
| [graceful-shutdown.ts](graceful-shutdown.ts) | Stop order, and why it is the reverse of startup. |
| [test-preload.ts](test-preload.ts) | PGlite with real migrations, `mock.module`, and the env-ordering trap. |

## API

| File | Pattern |
| --- | --- |
| [auth-plugin.ts](auth-plugin.ts) | Init-data validation as a scoped plugin; the 401/403 split; constant-time webhook secrets. |
| [route.ts](route.ts) | Typed error unions, bounded pagination, a visible guard boundary. |
| [schema.ts](schema.ts) | Drizzle tables where every constraint names its invariant and every index names its query. |

## Concurrency

One file per class from [race-conditions.md](../references/race-conditions.md).
Each shows the naive version, says exactly how two requests break it, and then
the guard.

| File | Class | Guard |
| --- | --- | --- |
| [atomic-balance.ts](atomic-balance.ts) | 1 — counter mutation | `UPDATE ... WHERE col >= n RETURNING` + `CHECK` |
| [limited-pool-claim.ts](limited-pool-claim.ts) | 2 — limited pool | `FOR UPDATE SKIP LOCKED` + predicate on the assignment |
| [claim-idempotent.ts](claim-idempotent.ts) | 3 — one-shot claim | composite PK + `onConflictDoNothing` |
| [idempotency-key.ts](idempotency-key.ts) | 5 — client retry | `idempotency_keys`, reserved before the work |
| [inbox-webhook.ts](inbox-webhook.ts) | 7 — duplicate delivery | `UNIQUE (source, external_id)`, store then process |
| [outbox.ts](outbox.ts) | 10 — local write + external call | intent in the same transaction, delivery by a worker |

## The rule these all share

The guard is a mechanism the **database** enforces. A `@verrou/core` lock may
appear alongside one — to reduce contention, or to protect a side effect that
has no row to constrain — but never instead of one. Verrou issues no fencing
token, so a TTL expiry mid-transaction admits a second writer that neither
Redis nor Postgres will reject.

`hotspot-scan.mjs` fails any register entry whose only defence is a lock.
