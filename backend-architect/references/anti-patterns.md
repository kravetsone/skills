# Anti-patterns — the lint register

Twelve groups, every one of them extracted from a real shipped service on this exact stack. Rule ids are stable and are what `plan-lint.mjs` reports. Use this file for two jobs: checking an emitted plan, and reviewing existing code.

Each entry is **symptom → why it breaks → fix**. The middle part is the one worth reading; a rule you understand you will apply in situations the rule never anticipated.

---

## A1 — Concurrency guarded by a lock alone

**Symptom.** A balance debit, stock decrement or one-shot claim protected by `verrou` with an unconditional `UPDATE` inside.

**Why it breaks.** Verrou has no fencing token. TTL expiry mid-transaction admits a second writer, and the unconditional `UPDATE` has no way to notice. See [locks-verrou.md](locks-verrou.md).

**Fix.** Conditional `UPDATE ... WHERE col >= n RETURNING`, or a unique constraint, or `FOR UPDATE SKIP LOCKED`. The lock becomes optional.

**Observed.** A service locked the user, then wrote `balance - price` unconditionally. The same team later wrote the box purchase correctly, with a guarded update — the two implementations sat in the same repo.

---

## A2 — `acquire()` with no timeout, or a lock with no explicit TTL

**Symptom.** `await lock.acquire()` bare; `createLock(key)` with no duration.

**Why it breaks.** Retry timeout defaults to `Infinity` — under contention, requests pile up until the connection pool is exhausted, and the symptom is "the whole service hung", not "this endpoint is slow". The default 30 s TTL is meanwhile shorter than many real critical sections.

**Fix.** Always `acquire({ retry: { attempts, delay, timeout } })` or `runImmediately()` with a 409. Always an explicit TTL sized to the worst case.

---

## A3 — Secret in the URL path

**Symptom.** `POST /:botToken`, `/webhook/:secret`.

**Why it breaks.** Paths are logged everywhere — nginx, the ingress, the APM, the trace span, the browser history of anyone who opens it. The credential ends up in half a dozen systems with different retention policies. Rotating it changes the URL, so rotation requires a coordinated change with the sender.

**Fix.** A header (`X-Telegram-Bot-Api-Secret-Token`), compared in constant time, on a fixed path.

**Observed.** Both reference projects. One of them also logged the full request.

---

## A4 — Home-made scheduler

**Symptom.** `setInterval` plus a `lastRunAt` check, plus a manual timezone offset (`now + 3h` for MSK).

**Why it breaks.** Three ways at once: every replica runs its own timer, so N replicas means N fires; the `lastRunAt` guard is itself a read-modify-write race; the hand-computed offset is wrong across DST and silently wrong forever if the rule changes. The guard makes it *look* handled, which is why it survives review.

**Fix.** `taskora` schedules — leader election, IANA timezones, missed-run policies. Plus a `UNIQUE (job_name, scheduled_for)` row so even a double fire writes once. See [jobs-taskora.md](jobs-taskora.md).

---

## A5 — In-process queue for durable work

**Symptom.** `p-queue`, `p-debounce` or a bare array holding writes that matter.

**Why it breaks.** No persistence, no retry across restarts, no visibility. A deploy — which happens several times a day — silently drops everything in flight. It fails invisibly, which is the worst property a queue can have.

**Fix.** taskora for anything that must survive. An in-process queue is acceptable only for work whose loss is genuinely free (cache warming, best-effort prefetch), and that should be stated.

---

## A6 — Open CORS

**Symptom.** `.use(cors())` with no arguments, or an origin derived from a domain substring.

**Why it breaks.** Any site can call your API from a victim's browser with their credentials attached. For a header-authenticated Mini App this is less catastrophic than for cookies, but it still hands a full attack surface to anyone who wants it.

**Fix.** An explicit origin list from config (`FRONTEND_URL`), with methods and headers enumerated.

---

## A7 — Secrets with defaults

**Symptom.** `env.get("POSTHOG_API_KEY").default("it's a secret")`.

**Why it breaks.** Configuration errors stop being loud. The service boots with a junk credential, and the misconfiguration is discovered later, from missing data, by someone who does not know it can be misconfigured.

**Fix.** `.required()`, or genuinely optional with an explicit feature flag. See [config-env-var.md](config-env-var.md).

**Observed.** Both projects, verbatim, including the joke string.

---

## A8 — Production identifiers as code defaults

**Symptom.** `TG_LOG_CHAT_ID.default("-1002416577602")`, `BOT_USERNAME.default("realbot")`, a production URL as a fallback.

**Why it breaks.** A staging deploy missing a variable writes to production. The failure is directional — it works fine until it corrupts something real.

**Fix.** `.required()` for anything identifying a real resource.

---

## A9 — Environment inferred from a string

**Symptom.** `const IS_STAGING = PUBLIC_DOMAIN.includes("staging")`, then `IS_STAGING` gating CORS, auth or analytics.

**Why it breaks.** The domain name becomes a control plane. Renaming a host changes runtime behaviour with no code change and no deploy note — and nobody renaming a host expects to be changing security posture.

**Fix.** `NODE_ENV`, or an explicit `APP_ENV`.

---

## A10 — Personal data in error reports and logs

**Symptom.** `Sentry.setContext({ headers, body })`; `console.log` of a full request or a parsed CSV.

**Why it breaks.** Headers carry the auth token and the Telegram init-data; bodies carry phone numbers and message content. The error tracker becomes an unplanned personal-data store with a different retention policy and a wider audience than your database.

**Fix.** A redacted allow-list: route, user id, request id, error code, trace id. See [telemetry.md](telemetry.md).

---

## A11 — Analytics that lies

**Symptom (a).** `capture()` inside the transaction — reports rolled-back events and adds network latency to the lock-hold window.
**Symptom (b).** `new PostHog(key, { disabled: NODE_ENV !== "production" })` — staging is blind, so analytics bugs can only be found in production.
**Symptom (c).** `distinctId` differing between the API and background jobs — one human becomes two users.

**Fix.** After commit; separate key per environment; one documented identity. See [analytics.md](analytics.md).

---

## A12 — Unsafe or sloppy query construction

**Symptom (a).** `sql.raw` built by concatenating values — even "our own" ids, which came from the request.
**Symptom (b).** `additionalProperties: true` together with `body as any` — validation that validates nothing, and a mass-assignment vector.
**Symptom (c).** Business logic inline in route handlers, duplicated across near-identical routes.
**Symptom (d).** Unbounded `limit` on list endpoints.

**Why it breaks.** (a) is SQL injection wearing a safe-looking costume. (b) accepts fields you never declared. (c) means the bot and the API drift apart, and neither can be tested without HTTP. (d) is a denial-of-service endpoint with good intentions.

**Fix.** Parameter binding (`unnest($1::text[])`); strict schemas with no `as any`; logic in `services/` and `db/queries/`; `limit` bounded in the schema. See [api-design.md](api-design.md), [monolith-layout.md](monolith-layout.md).

---

## Two more that do not fit a group but fail lint

**Swallowed `uncaughtException`.** Logging and continuing leaves the process in an undefined state. Report, then exit.

**Wrong status codes.** 401 for a banned user logs them out instead of telling them they are banned; 400 for a concurrency conflict is indistinguishable from a client bug. 401 = who are you, 403 = no, 409 = state conflict.

---

## What these projects got right

Worth copying, and worth saying out loud, because a review that only lists faults is a bad review:

- `config.ts` as the single env boundary, with `env-var` validation at boot.
- `LOCK_STORE: memory | redis` — tests run lock-aware with no Redis and no conditional code.
- The limited-pool claim via `FOR UPDATE SKIP LOCKED` + `LATERAL` — genuinely good SQL.
- The box purchase: row lock, atomic claim, guarded debit, all in one transaction.
- Idempotent claims via `onConflictDoNothing` returning `ALREADY_CLAIMED`.
- Composite primary keys used as dedupe barriers.
- Inbox-style webhook: store the raw payload first, process by id.
- Typed error unions in Elysia response schemas.
- `serverTime` from the server; `stock` derived rather than stored.
- Layered anti-cheat: hard cap, violation counter, ban, daily limit.
- Tests on PGlite with real migrations and `mock.module` — fast, and against real SQL.
- Migrations run before the process starts.
- A `CLAUDE.md` carrying the endpoint table and the "always update this" instruction.
