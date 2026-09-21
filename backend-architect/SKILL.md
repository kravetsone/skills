---
name: backend-architect
description: "Invoke to turn a product spec into a production-ready backend plan — when the user drops a Google Docs / Notion / PDF ТЗ, a Figma file or link (Dev Mode), or says 'спланируй бекенд', 'design the API', 'what endpoints do we need', 'architect this', 'составь план бекенда', 'backend plan', 'API contract from designs', 'спроектируй схему БД'. Runs a staged pipeline (ingest → extract → gate → design → gate → emit → lint) that reads the spec and the Figma screen graph with a cheap model and does the architecture with an expensive one, then emits BACKEND-PLAN.md, openapi.yaml, a Drizzle schema draft, an analytics event spec, and a sequenced backlog. Opinionated stack: **monolith only** — Bun + Elysia + Drizzle + PostgreSQL + Redis, GramIO for Telegram bots, `@verrou/core` for locks, `env-var` for config, `taskora` for jobs/schedules, OpenTelemetry via `@elysiajs/opentelemetry`. First-class treatment of **race conditions** (every hotspot must be closed by a database-level mechanism, never by a lock alone), idempotency, and sane scaling inside one process. Also invoke for backend design review, 'найди гонки', 'проверь на race conditions', 'где здесь дырка в конкурентности', API-surface audits, and porting an existing service onto this stack. Scripts: `plan-init.mjs`, `docs-pull.mjs`, `figma-digest.mjs`, `merge-facts.mjs`, `hotspot-scan.mjs`, `plan-lint.mjs`, `coverage-report.mjs`. When delegating to a subagent, pass the reference-file paths inline (e.g. `backend-architect/references/race-conditions.md`, `api-design.md`, `platform-contract.md`) — skills do not auto-load in subagent sessions."
allowed-tools: Bash(node backend-architect/scripts/*.mjs*)
metadata:
  author: kravetsone
  version: "0.1.0"
  source: https://github.com/kravetsone/skills/tree/main/backend-architect
  upstream: https://github.com/kravetsone/taskora
---

# Backend Architect

A pipeline + judgement skill. It takes the two artefacts a product actually ships with — a **written spec** (Google Docs / Notion / PDF) and a **Figma file** — and produces the document a senior backend engineer would write before touching code: what the API surface is, what the data model is, where the concurrency lands, and in what order to build it.

Two operating modes:

| Mode | Flag | Primary artefact |
| --- | --- | --- |
| REST API for a web/Mini-App frontend | `--mode api` | `openapi.yaml` + endpoint table |
| Telegram bot (GramIO) | `--mode bot` | scene/command graph + state contract |
| Both (Mini App + bot in one monolith) | `--mode both` | both, sharing one domain model |

**Everything is a monolith.** One deployable, one Postgres, one Redis, one process group. Scaling is addressed by making the monolith *horizontally replicable* and by naming the metric that would justify splitting something out — not by drawing microservices up front. See [references/scaling.md](references/scaling.md).

## The non-negotiables

These are the rules the emitted plan is linted against. They exist because each one was violated in a real shipped service and cost real money.

1. **A fact without a source is an open question, not a guess.** Every statement in the plan carries a citation: `REQ-###` (a line in the spec) or a Figma node id. Unsourced inference goes to the OPEN QUESTIONS section and blocks the gate. See [references/requirements-extraction.md](references/requirements-extraction.md).
2. **Every race hotspot is closed at the database level.** A `@verrou/core` lock is a *coordination* mechanism, not a correctness guarantee — it has no fencing tokens, so a TTL expiry mid-transaction silently admits a second writer. A hotspot whose only defence is a lock fails lint. See [references/race-conditions.md](references/race-conditions.md).
3. **Heavy context never reaches the expensive model.** Figma JSON is reduced to a digest by a script, then summarised by a cheap model. The architect model sees ledgers, never raw nodes. See [references/model-tiering.md](references/model-tiering.md).

   A corollary that decides scope: **count screen families, not links.** A 48-link handover is
   normally ~20 screens drawn in several states, and states are response shapes, not routes. The
   digest collapses them; the plan must state the reduction out loud. See [references/ingest-figma.md](references/ingest-figma.md).
4. **Env var names come from the platform, not from imagination.** The CI/CD injects a fixed set of names. Inventing `DB_URL` when the platform sets `DATABASE_URL` produces a plan that cannot deploy. See [references/platform-contract.md](references/platform-contract.md).
5. **Ask.** The agent running this pipeline should interrupt at any point where a decision changes the shape of the result. Two gates are mandatory; more questions are welcome. Never invent a business rule to keep momentum.

6. **The LLM is the operator.** In a Codex thread, run the scripts yourself with
   `exec_command`, read their outputs, delegate bounded stages, and ask the human questions
   directly in chat. Do not hand the human a shell checklist as the workflow. `questions.md`
   is the durable audit trail; the conversation is where decisions are made. Read
   [references/thread-orchestration.md](references/thread-orchestration.md) before operating.

## Pipeline at a glance

```
 0  plan-init      ─ scaffold .backend-plan/, pick mode           [script]
 1  ingest         ─ docs-pull + figma-digest                     [script, no model]
 2  extract        ─ spec → facts ledger; figma → screen ledger   [cheap model]
 3  reconcile      ─ merge-facts → contradictions + gaps          [script + cheap model]
 ══ GATE 1 ═══════  facts confirmed by the human
 4  design         ─ domain model → ADRs → API → race hotspots    [expensive model]
 ══ GATE 2 ═══════  architectural decisions approved
 5  emit           ─ BACKEND-PLAN.md, openapi.yaml, schema.ts,
                     analytics.md, BACKLOG.md                     [expensive model]
 6  verify         ─ plan-lint + coverage-report                  [script]
 7  land           ─ AGENTS.md / docs/ into the target repo
```

Full stage contracts, inputs/outputs and the gate scripts: [references/pipeline.md](references/pipeline.md).

## Quick start

These commands are the operator's actions inside the Codex thread. The user supplies the
sources and answers the gates; the LLM runs the commands and reports their results.

```bash
# 0. scaffold the working directory
node backend-architect/scripts/plan-init.mjs --name my-project --mode both

# 1a. pull the spec (public link, or --file for a manual drop)
node backend-architect/scripts/docs-pull.mjs "https://docs.google.com/document/d/<id>/edit"

# 1b. reduce Figma to a digest (needs FIGMA_TOKEN).
#     The usual handover is "implement these 48 designs" + 48 deep-links —
#     pass them all at once; --from-file / --stdin take a pasted list.
node backend-architect/scripts/figma-digest.mjs <url1> <url2> ... <url48>
node backend-architect/scripts/figma-digest.mjs --from-file links.txt

# 3. reconcile after the ledgers are written
node backend-architect/scripts/merge-facts.mjs

# 6. verify before handing the plan over
node backend-architect/scripts/hotspot-scan.mjs
node backend-architect/scripts/plan-lint.mjs
node backend-architect/scripts/coverage-report.mjs
```

All state lives in `.backend-plan/` in the target repo. Add it to `.gitignore` while drafting; commit the final artefacts to `docs/`.

## The stack (fixed)

| Concern | Choice | Reference |
| --- | --- | --- |
| Runtime | Bun | — |
| HTTP | Elysia (+ `@elysiajs/openapi`, `@elysiajs/cors`) | [api-design.md](references/api-design.md) |
| Bot | GramIO (+ `@gramio/scenes`, `@gramio/autoload`, `@gramio/init-data`) | [bot-mode.md](references/bot-mode.md) |
| DB | PostgreSQL + Drizzle ORM (`postgres` driver) | [data-model.md](references/data-model.md) |
| Cache / bot state / locks / jobs | Redis (`ioredis`) | — |
| Locks | [`@verrou/core`](https://verrou.dev/) | [locks-verrou.md](references/locks-verrou.md) |
| Jobs, schedules, flow control | [`taskora`](https://github.com/kravetsone/taskora) | [jobs-taskora.md](references/jobs-taskora.md) |
| Config | [`env-var`](https://github.com/evanshortiss/env-var) | [config-env-var.md](references/config-env-var.md) |
| Telemetry | `@elysiajs/opentelemetry` + OTLP | [telemetry.md](references/telemetry.md) |
| Product analytics | PostHog, spec'd before code | [analytics.md](references/analytics.md) |
| Tests | `bun:test` + PGlite + `mock.module` | [testing.md](references/testing.md) |

Deviating from this table is allowed only via an ADR that states what the stack could not do.

## Reference map

Read the ones your stage needs. Do not preload all of them.

| File | Read when |
| --- | --- |
| [pipeline.md](references/pipeline.md) | Always — the stage contracts and gates |
| [thread-orchestration.md](references/thread-orchestration.md) | When operating inside a Codex thread — model-owned scripts, delegation, direct questions and resume |
| [model-tiering.md](references/model-tiering.md) | Before spawning any subagent |
| [ingest-google-docs.md](references/ingest-google-docs.md) | Stage 1, spec side |
| [ingest-figma.md](references/ingest-figma.md) | Stage 1, design side |
| [requirements-extraction.md](references/requirements-extraction.md) | Stages 2–3, and at Gate 1 |
| [api-design.md](references/api-design.md) | Stage 4–5, `--mode api` |
| [bot-mode.md](references/bot-mode.md) | Stage 4–5, `--mode bot` |
| [data-model.md](references/data-model.md) | Stage 4–5, always |
| **[race-conditions.md](references/race-conditions.md)** | Stage 4–5, always — the core of the review |
| [locks-verrou.md](references/locks-verrou.md) | Whenever a lock is proposed |
| [jobs-taskora.md](references/jobs-taskora.md) | Any async / scheduled / retried work |
| [config-env-var.md](references/config-env-var.md) | Writing the config section |
| [platform-contract.md](references/platform-contract.md) | Writing any env var name or deploy note |
| [telemetry.md](references/telemetry.md) | Observability section |
| [analytics.md](references/analytics.md) | The spec mentions metrics/аналитика/воронки |
| [scaling.md](references/scaling.md) | Scaling section, capacity questions |
| [monolith-layout.md](references/monolith-layout.md) | Emitting the module map |
| [anti-patterns.md](references/anti-patterns.md) | Stage 6 lint, and any code review |
| [testing.md](references/testing.md) | Test-strategy section |
| [deliverables.md](references/deliverables.md) | Stage 5 — exact artefact formats |

## Templates

`templates/` holds paste-ready, **corrected** implementations of every pattern the plan references — `config.ts`, `locks.ts`, `otel.ts`, `auth-plugin.ts`, atomic balance mutation, limited-pool claim, idempotent claim, inbox webhook, taskora setup, test preload, plus the document skeletons (`backend-plan.md`, `adr.md`, `analytics-spec.md`, `backlog.md`, `AGENTS.md`). Reference them from the plan by path; copy them into the target repo at implementation time. See [templates/README.md](templates/README.md).

## Working agreement for the agent running this

- Announce the stage you are entering and what it will cost (model tier, rough token weight).
- **Stop at both gates.** Present findings as a numbered list of concrete claims, and ask the human to correct rather than approve in bulk.
- When something in the spec and something in Figma disagree, never silently pick one. It goes to the contradictions table.
- When the spec is silent on a behaviour that has a concurrency consequence (can the same reward be claimed twice? what happens when stock hits zero mid-purchase?), that is a **question**, not a default.
- Prefer to be interrupted early. A wrong domain model discovered at Gate 2 is cheap; discovered in implementation it is not.
