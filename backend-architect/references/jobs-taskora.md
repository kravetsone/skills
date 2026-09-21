# Background work — taskora

> **taskora ships its own skill.** Do not duplicate its API documentation here or in the plan. Install it alongside this one and read it when implementing:
> `https://github.com/kravetsone/taskora/tree/main/documentation/skills` — `using-taskora` (the full reference) and `taskora-nestjs`.
> This file covers only the *architectural* decisions the plan must make about async work.

taskora is task-centric rather than queue-centric: you define tasks, and the queue is an implementation detail. Redis-backed — which is one of the reasons Redis is non-optional in this stack.

## What belongs in a job, and what does not

| Put it in a job when | Keep it inline when |
| --- | --- |
| It can fail independently of the request | The user must see the result to proceed |
| It calls a third party | It only touches your own database |
| It fans out over many rows | It is a single-row write |
| It may exceed ~1 s | It is fast and cheap |
| It must survive a restart | Losing it on crash is acceptable |

The mistake worth naming: an **in-process queue** (`p-queue` and friends) for work that must not be lost. It gives the shape of a queue with none of the durability — a deploy drops everything in flight, silently. If the work matters, it goes to Redis via taskora. If it does not matter, it does not need a queue.

## The four architectural decisions

Record each in the plan, one line apiece.

### 1. Delivery semantics

taskora delivers **at-least-once**. Therefore every handler must be **idempotent** — same input twice, same end state. Usually that means the handler carries a natural key and uses one of the [race-conditions.md](race-conditions.md) Class-3 or Class-7 barriers. Say for each task how it achieves idempotency; "it won't run twice" is not an answer.

### 2. Retry policy

Exponential backoff with a cap, and a deliberate `attempts`. The question the plan must answer per task: **what happens after the last attempt?** Dead-letter queue and alert, or drop, or compensating action. An unanswered DLQ policy means failures accumulate invisibly.

Do not retry non-retryable errors. A 400 from a partner will still be a 400 in ten minutes; retrying it burns quota and hides the bug. Classify errors into retryable/terminal in the handler.

### 3. Flow control

taskora has first-class primitives — pick deliberately rather than writing your own:

| Need | Primitive |
| --- | --- |
| Collapse a burst of edits into one reindex | `debounce` (per-key, last wins) |
| Cap notifications per user per minute | `throttle` (per-key, excess dropped) |
| The same logical dispatch may arrive twice | `deduplicate` (per-key, first wins) |
| Only one instance of this task ever runs | `singleton: true` |
| Serialise per entity, parallel across entities | `concurrencyKey` |
| Accumulate then flush as a batch | `collect` |
| Job is worthless after N minutes | `ttl` |

`concurrencyKey` is the one most often missed. It gives per-user serialisation with global parallelism — frequently a better answer than a Verrou lock, because it is enforced by the queue rather than by a TTL.

### 4. Schedules

Recurring work uses taskora schedules, which do **leader election (SET NX PX)** so exactly one worker fires a tick across all replicas. This is the correct answer to [race-conditions.md](race-conditions.md) Class 6, and the reason `setInterval` is banned.

```ts
app.schedule("daily-digest", {
  task: sendDigestTask,
  cron: "0 9 * * *",
  timezone: "Europe/Moscow",   // IANA zone — never a manual hour offset
  onMissed: "skip",            // "skip" | "catch-up" | "catch-up-limit:N"
  data: {},
});
```

Two things the plan must state per schedule:

- **`timezone`** as an IANA zone. Hand-computing "UTC+3" for Moscow is wrong across any future rule change, and quietly wrong forever.
- **`onMissed`** — if every replica was down for the 09:00 tick, should it fire late? For a digest, `skip`. For invoice generation, `catch-up`. This is a product decision, so it goes to a gate.

## Other capabilities worth knowing exist

So the plan can reach for them instead of inventing: Standard Schema validation on payloads, producer/consumer contract split (`defineTask` / `register` / `implement`), payload **versioning with migrations** (the answer to "we changed the job's shape while jobs were in flight"), chain/group/chord workflows, cancellation, stall detection, retention, an inspector API, and an admin board. Details live in the taskora skill.

## Migrating from jobify

`jobify` is taskora's predecessor and appears in older services on this stack. Rough mapping:

| jobify | taskora |
| --- | --- |
| `jobify(name, handler)` | `taskora.task(name, handler)` |
| BullMQ queue/worker pair | one task definition, workers started by `taskora` |
| manual repeat options | `schedule` with leader election |
| hand-rolled dedupe | `deduplicate` / `singleton` / `concurrencyKey` |
| ad-hoc failure logging | DLQ + retention |

When planning a migration, do it task by task with both running, not as a big-bang switch — the queues are separate, so in-flight jobs on the old system need to drain.

## Shutdown

Graceful shutdown order matters, and it is the reverse of startup: stop accepting new HTTP work, stop the bot, let taskora workers finish the current job (do not accept new ones), flush analytics, then close Redis and Postgres. Killing Redis while a handler is mid-flight turns a clean stop into a stalled job and an alert at 3 a.m.
