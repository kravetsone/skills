# Bot mode — GramIO

When `--mode bot` or `--mode both`, the plan gains a second contract. A bot is a backend: it has state, concurrency, authorisation and side effects. It just does not have a REST surface, so the artefacts differ.

## What replaces the endpoint table

| REST artefact | Bot artefact |
| --- | --- |
| Endpoint table | **Command and callback table** — trigger, auth, effect, errors |
| OpenAPI schema | **Scene state contract** — what each step stores and validates |
| Route flow | **Dialog graph** — commands, scenes, transitions, exits |
| HTTP status codes | User-visible outcomes: message, alert, silent no-op |

### Command / callback table

| Trigger | Kind | Auth | Effect | Failure shown as |
| --- | --- | --- | --- | --- |
| `/start` | command | auto-register | upsert user, send welcome | — |
| `/start ref_<id>` | deep link | auto-register | attribute referral (once) | silent if self-referral |
| `claim:<taskId>` | callback | existing user | claim reward | alert "уже получено" |

Deep-link payloads deserve attention: they are **user-controlled input** that usually skips validation because it looks like an internal parameter. Referral codes, promo payloads and preview tokens all arrive this way.

## Concurrency in bots is worse than in HTTP

Two properties make it so, and both surprise people:

1. **Telegram retries.** If your webhook does not answer within its timeout, Telegram sends the update again. Slow handlers therefore produce duplicate executions — a rate of double-processing that is proportional to your latency.
2. **Buttons are spammable.** A user can tap an inline button ten times in a second, and every tap is an independent update. Anything reachable by button is a Class-3 hotspot by default.

So: callback handlers that mutate state need the same guards as REST mutations — a unique-constraint barrier, or a conditional update. See [race-conditions.md](race-conditions.md).

Answer callback queries immediately (`@gramio/auto-answer-callback-query`), then do the work. An unanswered callback leaves a spinner on the user's button, which is the thing that makes them tap again.

## Webhook vs polling

Polling in development, **webhook in production**. With N replicas, polling means N consumers competing for one update stream — updates get processed by whichever replica wins, or duplicated.

The webhook path must not contain the token (see [anti-patterns.md](anti-patterns.md) A3). Use a fixed path plus `X-Telegram-Bot-Api-Secret-Token`, compared in constant time, configured via `WEBHOOK_SECRET`.

Set the webhook at startup, and treat a failed registration as a failed boot — a bot silently running with a stale webhook URL is a long debugging session.

## Scene state

`@gramio/scenes` with `@gramio/storage-redis`. Rules that save pain:

- Scene state is **ephemeral** — a Redis flush loses it. Nothing durable may live only there. Commit to Postgres at each meaningful step, not at the end of a five-step flow.
- Every scene needs an escape: `/cancel` plus a timeout. Users abandon flows, and a stuck scene means every later message is swallowed by a dialog they forgot about.
- Validate at every step, not at submission. Re-prompting on the step that was wrong is the difference between a usable flow and an abandoned one.
- Scene state is user-controlled by transitivity — never trust a value stored there for authorisation.

## Broadcasts

The classic bot-backend feature, and the classic source of incidents.

- Telegram rate limits hard (~30 messages/second overall, tighter per chat). Exceed it and you get 429s with `retry_after`, or a temporary ban.
- Sending to 100k users is a **job**, batched, resumable, with per-user status. Not a loop in a request handler.
- It must be idempotent: a restart mid-broadcast must not re-send to everyone. Track per-user delivery state, or chunk with a resumable cursor.
- `singleton: true` or a lock so one broadcast does not start twice — and a status model (`pending → sending → sent`) that distinguishes "jobs enqueued" from "messages delivered".
- Blocked users produce 403s. That is not an error to retry; it is a signal to mark the user inactive.

## Mini App bridge

When `--mode both`, the bot and the REST API share one domain layer. The bridge is `@gramio/init-data`: the bot opens the Mini App, the Mini App sends `x-init-data`, the API validates it against the same `BOT_TOKEN`. One identity, one user table, one analytics `distinctId`.

State explicitly in the plan which operations are available from which surface, and which are shared. An operation available from both must live in `services/` — see [monolith-layout.md](monolith-layout.md).

## Localisation

`@gramio/i18n` with locale files under `shared/locales/`. Even a single-language product benefits: user-facing strings in one place means a copywriter can change them without touching handlers, which they will want to do on day two.

## Testing bots

Test the **services**, not the framework. Handlers should be thin enough that testing them adds little. Where a handler does contain logic, extract it. The bot equivalent of an end-to-end test is expensive and brittle; the service test is neither.
