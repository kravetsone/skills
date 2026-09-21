# Data model — Drizzle + PostgreSQL

The schema outlives the code. Handlers get rewritten every quarter; a wrong primary key is still there in three years, with four workarounds built on top of it.

## Write the invariants first

Before any table, list the sentences that must be true at every commit boundary:

- A user's balance is never negative.
- A promo code belongs to at most one user.
- A user has at most one pet of each type.
- A task is completed at most once per user per day.

Each sentence becomes a **constraint**, and each constraint becomes a test. A sentence you cannot express as a constraint is a hotspot — go to [race-conditions.md](race-conditions.md) Class 8.

## Identity

Pick the primary key on the strength of the identity, not on habit.

| Kind | Use | When |
| --- | --- | --- |
| External natural id | `bigint` PK (e.g. the Telegram user id) | the external system already guarantees uniqueness and you will always look up by it |
| Surrogate | `integer generated always as identity` | ordinary internal entities |
| Surrogate, unguessable | `uuid` | ids that appear in URLs a stranger might guess |
| Composite natural | `PRIMARY KEY (user_id, task_id)` | join tables — and the PK doubles as the dedupe barrier |

Use the Telegram id directly as the users PK when the product is Telegram-only: it removes a lookup from every authenticated request. Add a surrogate the day a second identity provider appears, not before.

**A composite primary key on a join table is a free concurrency guard.** `PRIMARY KEY (user_id, article_id)` makes "claim the reward twice" impossible at the storage layer — no application check involved.

## Constraints are the plan, not decoration

```ts
export const usersTable = pgTable("users", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  balance: integer("balance").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("balance_non_negative", sql`${t.balance} >= 0`),
]);

export const petsTable = pgTable("pets", {
  id: integer().generatedAlwaysAsIdentity().primaryKey(),
  userId: bigint("user_id", { mode: "number" }).notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  type: petTypeEnum("type").notNull(),
}, (t) => [
  unique("one_pet_per_type").on(t.userId, t.type),
]);
```

Rules:

- `notNull()` by default. Nullable is a decision that needs a reason, because every nullable column doubles the branches downstream.
- Foreign keys always, with an explicit `onDelete`. Choosing between `cascade` and `restrict` forces you to decide what deletion means — which is a product question that specs skip.
- `CHECK` for every numeric invariant.
- `UNIQUE` for every uniqueness sentence, partial (`WHERE status = 'active'`) when the rule is conditional.
- Enums via `pgEnum` for closed sets. Adding a value is a migration, which is correct — an open `text` column means a typo becomes a new state.

## Timestamps

`timestamp(..., { withTimezone: true })`, always, and `defaultNow()`. A naive timestamp column is a bug scheduled for the next DST change. Period boundaries ("once per day") are computed in SQL from `now()` at a named timezone, never from a client value and never from a hand-rolled offset.

## Money and points

Integers in the smallest unit. Never `float`/`real`/`double` — `0.1 + 0.2` is a support ticket. `numeric` when a decimal is genuinely required and arithmetic is done in SQL.

## Naming

`snake_case` in the database, `camelCase` in TypeScript, mapped explicitly in the Drizzle column definition. Tables plural, join tables `a_to_b`, booleans prefixed `is_`/`has_`, timestamps suffixed `_at`. Consistency here is worth more than any individual choice.

## Indexes

Index what you filter and sort on, not everything.

- every foreign key used in a join,
- every column in a `WHERE` on a hot path,
- composite indexes in the order the query filters (equality columns first, then range),
- partial indexes for the common filtered case (`WHERE user_id IS NULL` on a claimable pool).

State the query each index serves, in the plan. An index with no named query is either dead weight on writes or, worse, evidence that nobody knows the access pattern.

## Migrations

`drizzle-kit generate` from schema changes; never hand-write, and never `push` against production. Migrations run **before** the process starts, as a separate step in `bun start`, so a failed migration means a failed deploy rather than a half-migrated running service.

Expand-contract for anything non-trivial: add the new column nullable, backfill, start writing both, switch reads, drop the old one — each a separate deploy. A rename in one migration is a rollback that loses data.

## Soft delete

Only when the product needs to *see* deleted rows. Otherwise it poisons every query with `WHERE deleted_at IS NULL` and every unique constraint with a partial predicate. If you adopt it, adopt it everywhere and say so in an ADR.

## Prepared statements

For genuinely hot queries (`.prepare()` with `sql.placeholder`), which skips re-planning per call. Worth it on the bootstrap endpoint; not worth the rigidity elsewhere.

## The schema section of the plan

Per table: purpose, columns with types and nullability, constraints (and which invariant sentence each enforces), indexes (and which query each serves), and the `REQ-###` that motivated it. Emit `out/schema.draft.ts` as real Drizzle code — a draft that compiles is reviewable; a prose description of a schema is not.
