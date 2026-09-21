# <project> — backend

<!-- Copy to AGENTS.md (or CLAUDE.md) in the target repo. This is the first
     thing every future agent session reads, so a stale endpoint table here
     actively misleads — hence the standing rules below. -->

Bun + Elysia + Drizzle + PostgreSQL + Redis. **Monolith** — one deployable, one
database, one process group. Full plan: `docs/backend-plan.md`.

## Standing rules

1. **Update the endpoint table below in the same commit as the route change.**
2. **Update `docs/analytics.md` in the same commit as any `capture()` change.**
3. Business logic lives in `services/`, queries in `db/queries/`. Route handlers
   parse, call, and map errors — nothing else. The bot and the API call the same
   service, or they will drift.
4. Every concurrent path is guarded at the **database** level. A `@verrou/core`
   lock is coordination, not correctness: it has no fencing token, so a TTL
   expiry mid-transaction admits a second writer. See `docs/backend-plan.md`,
   concurrency register.
5. `process.env` is read in `src/config.ts` and nowhere else.
6. Durable background work goes to `taskora`. Never `p-queue`, never `setInterval`.

## Layout

```
src/
  index.ts          # compose: telemetry -> app -> bot -> jobs -> shutdown
  config.ts         # the only reader of process.env
  db/
    schema.ts       # drizzle tables
    queries/        # reusable query functions, one file per aggregate
    migrations/
  services/         # business logic, transaction boundaries, invariants
  routes/           # elysia route modules, thin
  bot/              # gramio handlers and scenes, thin
  jobs/             # taskora task definitions and schedules
  lib/              # locks, redis, s3, analytics, telemetry
```

## Endpoints

| Method + path | Purpose | Auth | Errors |
| --- | --- | --- | --- |
| GET /health | liveness, no dependency checks, excluded from tracing | none | — |

## Bot surface

| Trigger | Kind | Handler | State |
| --- | --- | --- | --- |
| /start | command | bot/commands/start.ts | — |

## Concurrency register

| ID | What it protects | Guard |
| --- | --- | --- |
| H-001 | | |

Each one has a test named after it. If you are changing code near one of these,
run that test first and keep it passing — the guard looks removable and is not.

## Commands

```bash
bun install
bun run dev                  # watch mode
bun test                     # PGlite + real migrations
bun x drizzle-kit generate   # after editing db/schema.ts
```

## Environment

`.env.example` lists every variable. `src/config.ts` is the enforced half of
the same contract — it throws at boot on anything missing.

Production start command (the TLS flag is a platform requirement, not an oversight):

```json
"start": "NODE_TLS_REJECT_UNAUTHORIZED=0 USE_SSL=1 bun x --bun drizzle-kit migrate && NODE_ENV=production bun run ./src/index.ts"
```
