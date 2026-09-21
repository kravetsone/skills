# Analytics — the event spec

Specs describe analytics badly and late: a section near the end listing "метрики" as prose, with no properties, no identity model, and no statement of where an event fires. Backends then scatter capture calls across handlers, and six months later nobody can answer what a funnel step actually counts.

So analytics is a **first-class deliverable**: `out/analytics.md`, produced at the same time as the API contract, reviewed at the same gate, and maintained under a standing rule.

## The standing rule

> **Whenever you add, modify or remove a `capture()` call, update `docs/analytics.md` in the same commit.** That file is the single source of truth for tracked events, their properties, and where they fire.

Put that sentence in the repo's `AGENTS.md`. Analytics documentation rots faster than anything else in a codebase, because nothing breaks when it is wrong.

## The spec format

One table, plus a section per event.

```markdown
| ID | Event | Fires when | Where | Properties | Requirement |
| --- | --- | --- | --- | --- | --- |
| EV-001 | user_registered | first successful auth creates a user row | services/users.ts | source, ref_code | REQ-002 |
| EV-002 | box_purchased | after the purchase transaction commits | routes/boxes.ts | box_item_id, price, balance_after | REQ-014 |
| EV-003 | game_finished | after a session row is written | routes/game.ts | score, xp_awarded, already_played_today | REQ-031 |
```

Then, per event: the exact property types, allowed values, and — the field most often forgotten — **whether the event is emitted once or can repeat**. "Can this event fire twice for the same user?" is the question that decides whether a funnel is meaningful.

## Naming

`snake_case`, object then verb in past tense: `box_purchased`, `article_claimed`, `game_finished`. Not `purchaseBox`, not `Box Purchase`, not `user_clicked_button_3`.

Consistency matters more than elegance — analysts write queries by pattern-matching prefixes, so `box_purchased` / `box_viewed` / `box_shared` is worth more than three individually nicer names.

## Identity

Decide once and write it down: **what is `distinctId`?**

For a Telegram product it is the Telegram user id, as a string, everywhere — bot handlers, REST handlers, background jobs. The failure mode to avoid is a job emitting events under an internal row id while the API uses the Telegram id; the same human then appears as two users and every retention number is wrong.

If anonymous events exist before identification, state the aliasing strategy explicitly.

## The three rules that cause the actual bugs

### 1. Fire after commit, never inside the transaction

```ts
// WRONG — reports events for transactions that roll back,
// and puts a network call inside your lock-hold window
await db.transaction(async (tx) => {
  await doWork(tx);
  posthog.capture({ event: "box_purchased", ... });
});

// RIGHT
const result = await db.transaction(async (tx) => doWork(tx));
posthog.capture({ event: "box_purchased", distinctId, properties: { ... } });
```

Both halves matter. The rollback case corrupts the data; the latency case is subtler — an HTTP call inside a transaction extends every lock that transaction holds, turning an analytics hiccup into database contention.

### 2. Never disable analytics outside production

```ts
const posthog = new PostHog(key, { disabled: config.NODE_ENV !== "production" });   // WRONG
```

This makes staging blind, so every analytics bug is discovered in production. Use a **separate project and key per environment** and keep the client enabled everywhere. Then staging events are real, testable, and harmless.

### 3. No personal data in properties

Phone numbers, emails, full names, promo codes, message contents — none of it goes into an event. Send ids and categories. Analytics stores are widely readable inside a company and are exported to third-party tools; they are the last place personal data should accumulate.

## Shutdown

PostHog batches. `await posthog.shutdown()` belongs in the graceful-shutdown sequence, before closing Redis and Postgres, or every deploy silently drops the final batch of events.

## Server-side or client-side?

State it per event. The rule of thumb: anything that *must* be accurate (purchases, rewards, anything with money attached) is server-side, because a client can fail to send. Anything about intent or UI behaviour (scrolls, taps, screen views) is client-side, because the server never sees it.

Events that exist on both sides need different names. The same name from two sources with different semantics is the single most common way an analytics dataset becomes untrustworthy.

## Extracting analytics from the spec

If the ТЗ has an analytics section, pull it as its own document — see [ingest-google-docs.md](ingest-google-docs.md) — and map every line to an `EV-###`. Expect to find:

- **events with no properties** — ask which dimensions the analyst intends to slice by; an event without properties answers only "how many", which is rarely the question;
- **metrics, not events** — "conversion to purchase" is a *derived* metric; it needs the two events that produce it. Emit the events, define the metric in the analytics tool;
- **events the backend cannot see** — screen views, scroll depth. Mark them client-side and say so, rather than inventing a server endpoint whose only purpose is to receive them.

## Funnels

When the spec names a funnel, list its steps explicitly and verify every step has an event. A funnel with a missing middle step is undetectable in the analytics tool and obvious here — this check alone justifies producing the spec before the code.
