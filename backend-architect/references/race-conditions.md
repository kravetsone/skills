# Race conditions — the hotspot register

This is the part of the plan that pays for itself. Everything else can be fixed in a follow-up PR; a concurrency bug ships silently, corrupts data for weeks, and is discovered by an accountant.

## The governing rule

> **Every hotspot must be closed by a mechanism the database enforces.**

An application-level lock is a *throughput* and *coordination* tool. It is not an integrity guarantee, for a concrete reason:

`@verrou/core` — like every Redis-backed lock in the Redlock family — hands you a boolean, not a **fencing token**. If your lock TTL is 30 s and your transaction stalls for 31 s (GC pause, slow query, a `for update` waiting behind another transaction), the lock silently expires, a second worker acquires it legitimately, and now two writers both believe they hold exclusive access. Neither Redis nor Postgres will stop the second write. Only a constraint or a conditional predicate in the write statement itself will.

So the register has two columns that matter: **guard** (the DB-level mechanism) and **lock** (optional, for reducing contention or protecting non-transactional side effects). A row with a lock and no guard fails `hotspot-scan.mjs`.

See [locks-verrou.md](locks-verrou.md) for where locks *are* the right answer.

## Register format — `design/hotspots.md`

```markdown
### H-003 — Purchase a box from a finite promo-code pool
- **Invariant:** a promo code is assigned to at most one user; a user's balance never goes negative.
- **Class:** 2 (limited-pool claim) + 1 (balance mutation)
- **Breaking interleaving:** two requests from the same user both read balance=100, both see price=100, both claim a code; balance ends at -100 with two codes issued.
- **Guard:** one transaction — (a) claim a code with `UPDATE ... WHERE id = (SELECT id ... FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING`; (b) debit with `UPDATE users SET balance = balance - :price WHERE id = :id AND balance >= :price RETURNING`; zero rows on (b) ⇒ rollback ⇒ 400. `CHECK (balance >= 0)` as the backstop.
- **Lock:** none needed.
- **Failure response:** 409 `OUT_OF_STOCK` / 400 `INSUFFICIENT_BALANCE`.
- **Test:** `Promise.all` of two purchases with balance for exactly one ⇒ exactly one 200.
- **Source:** REQ-014, REQ-015, SCR-012
```

Required fields: invariant, class, breaking interleaving, guard, lock, failure response, test, source. **"Breaking interleaving" must be a concrete two-request story**, not "if two requests happen at once". If you cannot write the story, you have not found a real hotspot — delete the row instead of padding the register.

---

## The 12 classes

### Class 1 — Balance / counter mutation

Read-modify-write on a numeric column. The classic lost update.

**Never:**
```ts
const user = await db.select().from(users).where(eq(users.id, id));   // read
if (user.balance < price) return status(400, "INSUFFICIENT");         // decide
await db.update(users).set({ balance: user.balance - price });        // write — lost update
```

**Guard — make the predicate part of the write:**
```ts
const [row] = await tx
  .update(usersTable)
  .set({ balance: sql`${usersTable.balance} - ${price}` })
  .where(and(eq(usersTable.id, id), gte(usersTable.balance, price)))
  .returning({ balance: usersTable.balance });

if (!row) return { error: "INSUFFICIENT_BALANCE" as const };  // zero rows = someone beat us
```

Plus `CHECK (balance >= 0)` in the schema. The check is what turns a future careless `UPDATE` into a loud error instead of a silent negative.

> **On `SELECT ... FOR UPDATE` + write.** Row-locking the user and *then* writing is also correct, and more readable when several columns feed the decision. But it is only correct if the same transaction does both, and it serialises every operation on that user. Default to the conditional `UPDATE`; reach for `.for("update")` when you must read several columns and decide across them.

**Capped increment** (progress bars, daily caps):
```ts
set({ taps: sql`LEAST(${usersTable.taps} + ${n}, ${cap})` })
```

**Floor-clamped decrement:** `GREATEST(col - n, 0)` — but only when clamping is the *business rule*. If overspending must fail, clamping hides the bug.

---

### Class 2 — Limited-pool claim

Promo codes, seats, ticket numbers, pre-generated gift cards, reserved slots. A finite set of rows, each assignable once.

**Never** `SELECT ... WHERE user_id IS NULL LIMIT 1` followed by `UPDATE ... WHERE id = :id`. Two requests select the same row.

**Guard — claim and assign in one statement:**
```sql
UPDATE promo_codes
SET user_id = $1, claimed_at = now()
WHERE id = (
  SELECT id FROM promo_codes
  WHERE box_item_id = $2 AND user_id IS NULL
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED      -- ← the whole trick
)
RETURNING code;
```

`SKIP LOCKED` makes concurrent claimers step over each other's in-flight rows instead of queueing behind them. Zero rows returned ⇒ genuinely out of stock ⇒ 409.

For **batch** issuance across several pools at once, the same idea with `JOIN LATERAL`:

```sql
WITH pending AS (
  SELECT t.task_id
  FROM unnest($2::text[]) AS t(task_id)
  LEFT JOIN promo_codes pc ON pc.task_id = t.task_id AND pc.user_id = $1
  WHERE pc.code IS NULL                       -- idempotency: skip already-issued
),
picked AS (
  SELECT p.task_id, c.id
  FROM pending p
  JOIN LATERAL (
    SELECT id FROM promo_codes
    WHERE task_id = p.task_id AND user_id IS NULL
    ORDER BY created_at LIMIT 1
    FOR UPDATE SKIP LOCKED
  ) c ON true
)
UPDATE promo_codes pc SET user_id = $1, updated_at = now()
FROM picked WHERE pc.id = picked.id
RETURNING pc.task_id, pc.code;
```

Bind the id array as a parameter (`$2::text[]`). **Do not build it by string-concatenating ids into `sql.raw`** — that is a SQL injection in a query that looks safe because the values "come from our own code". They came from the request. Working template: `templates/limited-pool-claim.ts`.

**Stock display:** derive it (`count(*) FILTER (WHERE user_id IS NULL)`), never maintain a `stock` column alongside the rows. A denormalised counter is a third thing that can disagree.

---

### Class 3 — One-shot action / idempotent claim

"Claim the reward for article X", "complete task Y", "collect the daily bonus". Double-tap, retry-on-timeout, and two devices all produce duplicates.

**Guard — a unique constraint plus insert-or-nothing:**
```ts
const inserted = await tx
  .insert(userToArticleTable)
  .values({ userId, articleId })
  .onConflictDoNothing()
  .returning({ userId: userToArticleTable.userId });

if (inserted.length === 0) return status(409, "ALREADY_CLAIMED");

// only now award the reward — same transaction
await tx
  .update(usersTable)
  .set({ experience: sql`${usersTable.experience} + ${reward}` })
  .where(eq(usersTable.id, userId));
```

The insert is the mutex. The `returning` row count is how you learn whether you won. The order is not negotiable: **claim first, reward second, one transaction** — reward-then-claim double-pays on the losing branch.

Composite natural keys make excellent barriers. `PRIMARY KEY (user_id, task_id, completed_on)` where `completed_on` is a `date` gives you "once per user per task per day" with no application logic at all.

---

### Class 4 — Upsert on a natural key

"Save my pet profile", "set my address". Concurrent first-writes both try to insert.

**Guard:** a real `UNIQUE` constraint on the natural key, then `onConflictDoUpdate`. The constraint must actually exist — `onConflictDoUpdate` targeting a non-unique column set is a runtime error, and an application-level "check if exists, then insert or update" is a race.

```ts
await db
  .insert(petsTable)
  .values({ userId, type, breed, age })
  .onConflictDoUpdate({
    target: [petsTable.userId, petsTable.type],
    set: { breed, age },
  });
```

Cardinality rules belong here too: "one cat and one dog per user" is `UNIQUE (user_id, type)`, not a count query in a handler.

---

### Class 5 — Request-level idempotency (double submit)

Class 3 covers naturally one-shot actions. This class covers *any* mutating endpoint a flaky network will retry: payments, external side effects, anything non-idempotent a client can send twice.

**Guard:** an `idempotency_keys` table.

```sql
CREATE TABLE idempotency_keys (
  key           text PRIMARY KEY,
  user_id       bigint NOT NULL,
  endpoint      text NOT NULL,
  request_hash  text NOT NULL,
  response      jsonb,
  status        text NOT NULL DEFAULT 'in_progress',  -- in_progress | done
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

Flow: `INSERT ... ON CONFLICT DO NOTHING` on the key. Won ⇒ do the work, store the response, mark `done`. Lost ⇒ if `done`, replay the stored response; if `in_progress`, return 409 `IN_FLIGHT` and let the client retry. Compare `request_hash` — the same key with a different body is a client bug and deserves 422, not a replay.

Decide *at design time* which endpoints need this and say so in the plan. Retrofitting idempotency after launch means reconciling the duplicates you already created.

---

### Class 6 — Scheduled fan-out (double fire)

A cron-like task that must run once per tick across N replicas.

**Never** the in-process pattern: `setInterval` plus "skip if `lastRunAt` was within the last 30 minutes". It fails three ways — every replica has its own timer; the timestamp heuristic is itself a read-modify-write race; and a hand-computed timezone offset (`now + 3h` for MSK) is wrong across DST boundaries and silently wrong forever if the rule changes.

**Guard:** `taskora` schedules, which perform **leader election** so exactly one replica fires a tick, plus missed-run policies for the case where every replica was down. Timezone handling belongs to the scheduler, configured with an IANA zone (`Europe/Moscow`), never an hour offset. See [jobs-taskora.md](jobs-taskora.md).

Additionally make the *effect* idempotent: a run row with `UNIQUE (job_name, scheduled_for)` so that even a double fire writes once.

---

### Class 7 — Inbound webhook replay

External systems retry. Payment providers retry aggressively, and will resend an event after you already returned 200.

**Guard:** an inbox table with `UNIQUE (source, external_id)`.

1. Insert the **raw** payload with `onConflictDoNothing`. Conflict ⇒ already seen ⇒ 200 immediately.
2. Return 200 now. Process asynchronously by row id.
3. Processing is a state machine on the row (`pending → processing → done|error`) with the error serialised into the row.

This buys three things beyond dedupe: the endpoint answers fast enough not to trip the sender's timeout; a parsing bug becomes replayable instead of lost; and you still have the original bytes when the partner insists they sent something else. Template: `templates/inbox-webhook.ts`.

**Never put the secret in the URL path.** A bot-token-as-path webhook (`POST /:botToken`) leaks the credential into every access log, proxy log and trace span, and rotating it changes the URL. Use a header (`X-Telegram-Bot-Api-Secret-Token`) compared in constant time, on a fixed path.

---

### Class 8 — Cross-entity invariant

"A user has at most one active subscription." "A team has exactly one owner." "Only one promotion is active at a time."

**Guard:** a partial unique index — the constraint your application check was pretending to be.

```sql
CREATE UNIQUE INDEX one_active_sub_per_user
  ON subscriptions (user_id) WHERE status = 'active';
```

For invariants spanning rows in a way no index can express (sum of allocations ≤ quota), the options in order of preference: restructure so an index *can* express it; `SELECT ... FOR UPDATE` on a single parent row every writer must take, making the parent the serialisation point; `SERIALIZABLE` isolation with a documented retry loop. Say which one you chose, and why, in an ADR.

---

### Class 9 — Read-then-act on a stale derived value

The list endpoint says `stock: 3`; by the time the user taps, it is 0.

This is **not** fixable by reading harder, and trying to fix it in the read path is the mistake. The read is advisory; the write re-checks. The API contract must therefore carry an explicit failure for "it was true when you looked, it is not now" — 409, with a code the frontend renders as the designer's out-of-stock state. If Figma has no such state, that is a Gate-1 gap: the design assumes an impossibility.

---

### Class 10 — Two-phase external side effect

Charge a card then grant the entitlement; send a Telegram message then mark it sent; upload to S3 then insert the row. The process can die between the two, and the external call is not transactional.

**Guard — the outbox/intent pattern.** Write the *intent* in the same transaction as the local state change; a worker performs the external call and records the result.

```
tx:     INSERT outbox(kind, payload, status='pending')  +  local state change   ← atomic
worker: claim pending row (FOR UPDATE SKIP LOCKED) → external call → status='done'
```

Because the external call can succeed while the status write fails, the call must be idempotent on the provider's side — pass an idempotency key derived from the outbox row id. Design for **at-least-once and make the effect idempotent**; exactly-once across a process boundary does not exist.

A rule follows directly: **analytics and notifications fire after commit, never inside the transaction.** A `capture()` before commit reports events that were rolled back, and adds network latency to the transaction's lock-hold time.

---

### Class 11 — Anti-cheat / rate counters

Client-submitted scores, tap counters, daily limits.

**Guard:** layered, each layer atomic —

1. a hard cap per submission, checked server-side against a config constant;
2. a violation counter incremented atomically, with the ban applied in the same statement:
   `UPDATE users SET violations = violations + 1, banned_at = CASE WHEN violations + 1 >= :threshold THEN now() ELSE banned_at END WHERE id = :id RETURNING`;
3. per-period awards limited by a uniqueness barrier (Class 3) rather than a "did they already play today" read;
4. soft throttling in Redis (`INCR` + `EXPIRE`) — cheap, approximate, and explicitly *not* the integrity layer.

Never trust a client-supplied timestamp for period boundaries; derive periods from `now()` in the database.

---

### Class 12 — Cache / derived-state staleness

A TTL cache in front of a query whose underlying data changes on write.

Usually not a correctness race — but it becomes one the moment the cached value is used to *authorise* a write ("your cached balance says you can afford this"). Rule: **cached values may render, never decide.** Every write path re-reads inside the transaction.

When a cache exists, name its invalidation trigger in the plan. An unnamed invalidation strategy means there isn't one.

---

## Isolation levels

Postgres defaults to `READ COMMITTED`, and every pattern above is written to be correct at that level — deliberately. Escalate only with a reason:

| Level | Use when | Cost |
| --- | --- | --- |
| `READ COMMITTED` (default) | conditional UPDATE / SKIP LOCKED / unique constraints cover the invariant | none |
| `REPEATABLE READ` | a multi-statement read must see one consistent snapshot (reports) | serialisation failures ⇒ retry loop required |
| `SERIALIZABLE` | a multi-row invariant no index can express (Class 8 fallback) | throughput hit + mandatory retry loop |

If you pick anything but the default, the retry loop is part of the deliverable, not an implementation detail.

## Deadlock avoidance

Multi-row transactions must take rows in a **documented, consistent order** (always ascending by primary key; always the user row before the wallet row). A deadlock is Postgres detecting that two transactions ordered their locks differently. State the order in the plan for every transaction touching more than one table.

## Writing the concurrency tests

Each hotspot gets one test shaped like this:

```ts
const results = await Promise.all([
  api.boxes({ id: 1 }).purchase.post(null, { headers: authHeaders }),
  api.boxes({ id: 1 }).purchase.post(null, { headers: authHeaders }),
]);

const ok = results.filter((r) => r.status === 200);
expect(ok).toHaveLength(1);                                   // exactly one winner
expect(await balance(userId)).toBe(startingBalance - price);  // debited exactly once
```

Two properties every time: **exactly one winner**, and **the invariant still holds afterwards**. Under PGlite these run in-process against real SQL and real constraints — see [testing.md](testing.md).
