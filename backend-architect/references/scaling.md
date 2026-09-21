# Scaling — sanely, inside a monolith

The architecture is a monolith. Not as a compromise, and not as a stage to grow out of — as the design. One deployable, one Postgres, one Redis. The scaling section of the plan exists to answer "what happens when this gets popular", not to draw a service mesh.

## Why monolith is the right default here

A Telegram Mini App or a bot backend has properties that make splitting actively harmful:

- Traffic is spiky and campaign-driven — it is idle, then it is 50× for two hours. Vertical headroom plus replicas absorbs that; a distributed system converts it into partial failures.
- The domain is small and tightly coupled. Users, balances and rewards touch each other constantly. Split them and every one of the transactions in [race-conditions.md](race-conditions.md) becomes a distributed transaction, which is dramatically harder.
- The team is small. Service count is paid for in operational attention, which a small team has none of to spare.

The monolith keeps invariants inside single database transactions. That is the single largest correctness advantage available, and it is free.

## Make it horizontally replicable, then stop

The one structural requirement: **the process must be stateless**, so `replicas: N` works without further thought.

Checklist:

- [ ] No in-memory state that matters across requests — sessions, counters, caches-of-record all live in Redis or Postgres.
- [ ] `LOCK_STORE=redis` in production. In-memory locks across replicas always succeed, which is worse than no lock, because it looks like it works.
- [ ] Schedules use taskora's leader election, not `setInterval`.
- [ ] No local filesystem writes; uploads go to S3.
- [ ] Bot runs in **webhook** mode in production. Polling from N replicas means N consumers fighting over one update stream.
- [ ] Migrations run as a pre-start step, not from every replica on boot.
- [ ] Graceful shutdown drains in-flight work before exit.

Tick those and the monolith scales to a number that will surprise you.

## Signals, not speculation

Do not design for load you cannot name. Instead, state in the plan which **metric** would trigger which **action**. That converts scaling from an argument into a decision with an owner.

| Signal | Threshold | Action |
| --- | --- | --- |
| p95 latency rises, CPU low | — | it is I/O: find the N+1 or the missing index before anything else |
| CPU sustained high | > 70% | add a replica |
| Postgres connections near the pool limit | > 80% | add PgBouncer in transaction mode; **do not** raise the pool per replica |
| One endpoint dominates DB time | > 30% | cache it, or denormalise the read, or paginate harder |
| Job queue depth grows monotonically | — | raise `concurrency`; if that does not hold, it is a slow external call — see below |
| Lock wait time climbs | — | the lock key is too coarse; narrow it |
| Write contention on one hot row | — | that is a design problem, not a capacity problem — go back to the hotspot |
| CPU-heavy work starves HTTP | — | move that work to a job, or run a **worker replica of the same image** with HTTP disabled |

That last row is the only "split" this architecture endorses, and it is not a split: the same deployable, started with a flag that runs workers instead of the HTTP server. Same code, same schema, same deploy — just different concurrency characteristics.

## Postgres is the scaling limit, and that is fine

Everything else is replicable; the database is not. So attention belongs there:

1. **Connection pooling.** Each replica holds a pool; N replicas multiply it. Postgres handles a few hundred connections before performance degrades. PgBouncer in transaction mode is the standard answer, and it is worth stating in the plan that `SET`-based session state and session-level advisory locks do not survive it.
2. **Indexes for real queries.** Most "we need to scale" turns out to be one sequential scan.
3. **Read replicas** only when reads genuinely dominate and staleness is acceptable per endpoint. This needs an explicit list of which endpoints may read stale, and it is rarely worth it before the other items.
4. **Partitioning** for append-only tables that grow without bound (events, sessions, logs) — by time range, with a retention policy. Decide this when the table is designed; retrofitting is painful.

## Caching

Cache last, and cache with intent. For each cache, the plan states: what is cached, the key, the TTL, and **what invalidates it**. An unnamed invalidation strategy means there isn't one.

Rule from [race-conditions.md](race-conditions.md) Class 12: **cached values may render, never decide.** Write paths re-read inside the transaction.

## Capacity, briefly

If the spec names an audience size, do the arithmetic and put it in the plan — it usually ends the discussion:

```
100k users, 30% DAU, 20 requests per active user per day
= 600k requests/day = ~7 rps average
campaign peak at 20× average = ~140 rps
```

140 rps against Postgres with sane indexes is a small number. Say so. The most valuable output of a capacity estimate is usually the permission it gives you to stop optimising.

If the spec names no numbers, ask at Gate 1. "Много пользователей" is not a requirement, and the difference between 10k and 10M changes real decisions.

## What would actually justify extracting a service

Worth stating, so the boundary is principled rather than aesthetic:

- a genuinely different resource profile (video transcoding, ML inference) that starves the main process;
- a different compliance boundary (payment data under stricter rules);
- a different rate of change with a different team owning it.

None of those is "the codebase got big". Note the candidate in the plan if one exists, and keep it in the monolith until the signal fires.
