# Testing strategy

`bun:test` with **PGlite** — Postgres compiled to WASM, running in-process. Real SQL, real constraints, real migrations, no Docker, no external service, and fast enough to run on every save.

This matters more than usual for this architecture: almost every correctness guarantee in [race-conditions.md](race-conditions.md) lives in the database. A test suite that mocks the database tests none of them.

## Preload

`bunfig.toml` points at `tests/preload.ts`, which runs before any test module is imported. Order inside it is load-bearing.

```ts
import { mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import redisMock from "ioredis-mock";

// 1. env BEFORE anything imports config.ts (it reads at module load)
Object.assign(process.env, {
  DATABASE_URL: "postgres://test:test@localhost:5432/test",
  BOT_TOKEN: "123:TEST",
  WEBHOOK_SECRET: "test-secret",
  NODE_ENV: "test",
  LOCK_STORE: "memory",
});

// 2. swap the postgres driver for PGlite
const pglite = new PGlite();
export const db = drizzle(pglite);
mock.module("postgres", () => ({ default: () => pglite }));
mock.module("drizzle-orm/postgres-js", () => ({ drizzle }));

// 3. in-memory Redis
mock.module("ioredis", () => ({ Redis: redisMock, default: redisMock }));

// 4. real migrations — the schema under test is the schema that ships
await migrate(db, { migrationsFolder: "./drizzle" });
```

Step 1 before step 2 is not stylistic: `config.ts` reads `process.env` at import time, so a reordering surfaces as "required variable missing" in an unrelated test.

Step 4 is the valuable one. Running the **actual** migration files means a migration that fails, or drops a constraint, fails the test suite rather than production.

`LOCK_STORE: "memory"` is why [locks-verrou.md](locks-verrou.md) recommends the store switch — lock-using code runs unmodified with no Redis.

## Mock only at the edges

Mock third parties: the LLM provider, the payment gateway, Telegram's API, the partner system. Do **not** mock your own database, your own services, or your own queries. The bugs this architecture actually produces live in SQL and in transaction boundaries, and a mocked database hides exactly those.

Deterministic fakes beat recorded fixtures for external APIs — a fake that returns a fixed response is readable; a 200-line recorded payload is not.

## What to test, in priority order

### 1. Concurrency hotspots — every `H-###` gets a test

Non-negotiable. This is the reason the register exists.

```ts
test("H-003: concurrent purchase issues exactly one code", async () => {
  await seedUser({ id: 1, balance: 100 });
  await seedBox({ id: 1, price: 100, codes: 2 });

  const results = await Promise.all([
    api.boxes({ id: 1 }).purchase.post(null, { headers: auth }),
    api.boxes({ id: 1 }).purchase.post(null, { headers: auth }),
  ]);

  expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  expect(await getBalance(1)).toBe(0);            // debited exactly once
  expect(await countClaimedCodes(1)).toBe(1);     // one code issued
});
```

Always both assertions: **exactly one winner**, and **the invariant holds afterwards**. The second one is what catches a guard that returns the right status while still corrupting state.

### 2. Constraint enforcement

That the database rejects what the plan says is impossible. A negative balance, a duplicate claim, a second active subscription — each should throw.

These tests fail loudly when someone later "simplifies" a migration by dropping a constraint.

### 3. Contract tests per endpoint

Via Eden treaty, which type-checks the call against the route schema, so a contract change breaks the test at compile time.

Happy path, each error branch, auth rejection, and validation rejection. The error branches are the ones that get skipped and the ones the frontend depends on.

### 4. Business logic in services

Plain unit tests. Cheap, so cover the arithmetic: rewards, caps, tier boundaries, period rollovers. Off-by-one errors in an economy are embarrassing and entirely preventable.

## What not to test

Framework behaviour, Drizzle's query builder, schema validation itself. If `t.Number()` stops rejecting strings, that is not your bug.

## Seeding

Helpers, not fixture files. `seedUser({ balance: 100 })` reads clearly and stays valid when the schema changes; a JSON fixture silently drifts and nobody notices which fields matter.

Reset between tests by truncating, not by recreating the database — recreation re-runs migrations and dominates the runtime.

## In the plan

A short section: what is mocked, what is not, the hotspot test list (one line per `H-###`), and the constraint test list. Both lists come straight from the design stage, so writing them costs nothing and makes the implementation's definition of done unambiguous.
