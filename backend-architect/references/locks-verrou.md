# Locks — @verrou/core

[Verrou](https://verrou.dev/) is the lock library for this stack. It is good, and it is not a correctness mechanism. Both halves matter.

## Setup

```ts
import { Verrou } from "@verrou/core";
import { memoryStore } from "@verrou/core/drivers/memory";
import { redisStore } from "@verrou/core/drivers/redis";
import { config } from "../config.ts";
import { redis } from "./redis.ts";

export const verrou = new Verrou({
  default: config.LOCK_STORE,                    // "memory" | "redis"
  stores: {
    memory: { driver: memoryStore() },
    redis: { driver: redisStore({ connection: redis }) },
  },
});
```

The `LOCK_STORE` switch is the detail worth copying: tests run against `memory` with no Redis and no code changes, production runs `redis`. Drivers also exist for postgres, mysql and sqlite — if you are already on Postgres and want one fewer moving part, `postgres` is a legitimate choice.

**`memory` is single-process only.** Setting it in production with more than one replica gives you a lock that always succeeds — the most dangerous possible failure mode, because everything looks fine. `plan-lint.mjs` flags a production config that leaves `LOCK_STORE` at its default.

## API, and the two defaults that will bite you

```ts
const lock = verrou.createLock("user:123:purchase", "30s");

// 1. run() — acquire, execute, always release
await lock.run(async () => { /* critical section */ });

// 2. runImmediately() — skip entirely if held. Returns [acquired, result]
const [acquired, result] = await lock.runImmediately(async () => { /* ... */ });
if (!acquired) return status(409, "IN_PROGRESS");

// 3. manual
await lock.acquire({ retry: { attempts: 10, delay: 100, timeout: "5s" } });
try { /* ... */ } finally { await lock.release(); }
```

**Default TTL is 30 seconds.** Always pass it explicitly, and size it against the worst-case critical section rather than the average one. An expired lock releases silently while your code is still running.

**Default retry timeout is `Infinity`.** `await lock.acquire()` with no options waits forever. Under load that converts a slow path into an exhausted connection pool and an unresponsive service. **Always pass a timeout.** `plan-lint.mjs` flags a bare `acquire()`.

Also available: `extend()` for long work, `isLocked()`, `getOwner()`, `getRemainingTime()`, `forceRelease()` for operational recovery, and `serialize()` plus `verrou.restoreLock()` to hand a lock to a worker that will release it.

## What locks are actually for

1. **Reducing contention.** A hot row protected by a conditional `UPDATE` is correct but may thrash; a lock in front converts retries into queueing.
2. **Non-transactional side effects.** "Only one broadcast job runs at a time" — there is no row to constrain, so a lock plus `runImmediately()` is the right tool.
3. **Coordinating external calls.** One refresh of a shared API token instead of fifty.
4. **Cheap mutual exclusion for non-critical work.** Cache-stampede prevention, where a double execution is wasteful but harmless.

## What locks are not for

**Holding an invariant.** Verrou issues no **fencing token** — there is no monotonically increasing number the database could use to reject a writer whose lock has expired. The failure sequence is mundane:

```
t0  A acquires lock (TTL 30s), begins transaction
t1  A stalls 31s — GC pause, slow query, FOR UPDATE queueing behind another tx
t2  lock expires; nothing tells A
t3  B acquires the same lock legitimately, reads, writes
t4  A resumes and writes over B
```

Nothing in Redis or Postgres rejects A's write, because A's write carries no evidence that its lock is stale. Only a conditional predicate in A's `UPDATE`, or a constraint, rejects it.

Hence the rule in [race-conditions.md](race-conditions.md): **a lock may appear in a hotspot's mitigation, never as the whole mitigation.**

## Naming and granularity

`<domain>:<entity>:<id>:<operation>` — `user:123:purchase`, `broadcast:42:send`.

Lock the narrowest thing that preserves correctness. A global `purchase` lock serialises every user in the system; `purchase:user:123` serialises one. Lock keys that include a user id are usually right; lock keys that do not are usually a bottleneck waiting to be found under load.

## Ordering

Never acquire a Verrou lock **inside** a database transaction. Two lock orders across two code paths is a distributed deadlock with no detector — Postgres can detect its own deadlocks, but it cannot see Redis. Acquire first, then open the transaction, always.

## Checklist for any proposed lock

- [ ] Explicit TTL, longer than the worst case
- [ ] Explicit retry timeout, or `runImmediately` with a 409
- [ ] Released in a `finally`, or via `run()`
- [ ] The invariant is *also* guarded at the database level
- [ ] The key is as narrow as correctness allows
- [ ] Acquired outside any transaction
- [ ] Behaviour on failed acquisition is defined and returned to the caller
