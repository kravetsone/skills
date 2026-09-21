# Analytics — <project>

> **Standing rule.** Whenever you add, modify or remove a `capture()` call,
> update this file in the same commit. It is the single source of truth for
> tracked events, their properties, and where they fire. Nothing breaks when
> analytics documentation is wrong, which is exactly why it rots fastest.

## Identity

- **distinctId:** <Telegram user id, as a string> — the same value in REST
  handlers, bot handlers and background jobs.
- **Anonymous before identification:** <yes / no; if yes, the aliasing strategy>

<!-- The failure mode this section exists to prevent: a job emitting under an
     internal row id while the API uses the Telegram id. One human becomes two
     users and every retention number is wrong. -->

## Environments

| Environment | Project | Key variable |
| --- | --- | --- |
| production | <name> | `POSTHOG_API_KEY` |
| staging | <name> | `POSTHOG_API_KEY` (different value) |

The client stays **enabled everywhere**. Disabling analytics outside production
makes staging blind, so analytics bugs become production-only discoveries.

## Events

| ID | Event | Fires when | Side | Where | Properties | Repeatable? | REQ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EV-001 | user_registered | first successful auth creates a user row | server | services/users.ts | source, ref_code | once per user | REQ-### |
| EV-002 | | | | | | | |

<!-- "Repeatable?" is the column people forget, and it is the one that decides
     whether a funnel means anything. -->

### EV-001 — user_registered

- **Fires:** after the user row is committed, never inside the transaction.
- **Properties:**
  - `source` — `string`, one of `bot` | `miniapp` | `deeplink`
  - `ref_code` — `string | null`, the referral code if present
- **Repeatable:** no — once per `distinctId`, enforced by the insert barrier in H-###.
- **Requirement:** REQ-###

## Funnels

| Funnel | Steps | Every step has an event? |
| --- | --- | --- |
| Purchase | app_opened → box_viewed → box_purchased | |

<!-- A funnel with a missing middle step is undetectable in the analytics tool
     and obvious here. This check alone pays for writing the spec first. -->

## Derived metrics

Defined in the analytics tool, not emitted as events.

| Metric | Computed from |
| --- | --- |
| conversion to purchase | EV-00x / EV-00y |

## Not tracked, deliberately

| Requested | Why not | Alternative |
| --- | --- | --- |
| scroll depth | the server never sees it | client-side event |

## Rules this file is checked against

1. Capture **after commit** — never inside a transaction. A rolled-back
   transaction still reports the event, and the network call extends every lock
   the transaction holds.
2. **No personal data** in properties: no phone numbers, emails, names, promo
   codes or message contents. Ids and categories only.
3. `await posthog.shutdown()` belongs in the graceful-shutdown sequence, before
   Redis and Postgres close, or every deploy drops the final batch.
4. Server-side for anything that must be accurate (money, rewards, purchases);
   client-side for intent and UI behaviour. Events that exist on both sides get
   **different names**.
