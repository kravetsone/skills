# API design — Elysia

The contract is the product. Everything else is an implementation detail that can be rewritten; the contract is what the frontend builds against and what you cannot change on a Friday.

## Shape

REST over JSON. Resource-oriented paths, plural nouns, verbs only for genuine actions that are not CRUD (`/boxes/:id/purchase`, `/articles/:id/claim`). No `/api` prefix — the deployment already namespaces by host.

```ts
export const boxesRoutes = new Elysia({ prefix: "/boxes", tags: ["boxes"] })
  .get("/", handler, { query: ListQuery, response: { 200: BoxList } })
  .use(authElysia)                       // everything below requires auth
  .post("/:id/purchase", handler, {
    params: t.Object({ id: t.Number() }),
    response: {
      200: t.Object({ code: t.String(), balance: t.Number() }),
      400: t.Literal("INSUFFICIENT_BALANCE"),
      404: t.Literal("BOX_NOT_FOUND"),
      409: t.Literal("OUT_OF_STOCK"),
    },
  });
```

Order matters: public routes before `.use(authElysia)`, protected routes after. It reads as a guard boundary and it is one.

## Every response is typed, including errors

The `response` map is not documentation — Elysia enforces it, and it generates the OpenAPI schema the frontend's client is built from. An endpoint whose failure modes are not in the union has failure modes the frontend cannot handle.

Error codes are `SCREAMING_SNAKE` string literals in a union, not free-form `{ message }`. The frontend switches on them; a message is for humans and will be rewritten by a copywriter.

```ts
400: t.Union([t.Literal("INSUFFICIENT_BALANCE"), t.Literal("INVALID_QUANTITY")]),
```

## Status codes that carry meaning

| Code | Meaning | Common mistake |
| --- | --- | --- |
| 200 | done | — |
| 201 | created, with a `Location` | using 200 for creation and losing the id semantics |
| 400 | the request is malformed or violates a precondition you own | — |
| 401 | **who are you?** — credentials absent, invalid or expired | returning 401 for "you may not do this" |
| 403 | **I know who you are, and no** — banned, wrong role, not the owner | returning 401, which makes clients log the user out |
| 404 | does not exist, or must not be revealed to exist | returning 403 and leaking existence |
| 409 | state conflict — already claimed, out of stock, concurrent edit | returning 400, which the client cannot distinguish from a bug |
| 422 | syntactically valid, semantically impossible | — |
| 429 | rate limited, with `Retry-After` | not having one at all |

The 401/403 confusion is worth care: a 401 tells most clients to drop the session, so returning it for a banned user logs them out instead of telling them they are banned. Race-condition outcomes (Classes 2, 3, 9) are **409** — that is precisely "you were right when you asked, and wrong by the time I answered".

## Validation

- Validate `body`, `query`, `params` and `headers` with TypeBox on every route. No exceptions.
- **Never** `additionalProperties: true` combined with `body as any`. That combination silently accepts unvalidated fields and is how mass-assignment bugs enter a codebase that "has validation".
- Numeric bounds belong in the schema (`t.Number({ minimum: 1, maximum: 100 })`), not in the handler.
- Pagination: `limit` defaults to 20, hard maximum 100, enforced in the schema. An unbounded `limit` is a denial-of-service endpoint with good intentions.

## Authentication

Telegram Mini App: `x-init-data` header, HMAC-validated against the bot token. Implemented once as a scoped plugin (`templates/auth-plugin.ts`), never re-implemented per route.

```ts
export const authElysia = new Elysia({ name: "auth" })
  .guard({ headers: t.Object({ "x-init-data": t.String() }),
           response: { 401: t.Literal("UNAUTHORIZED") } })
  .resolve(({ headers, status }) => {
    const result = validateAndParseInitData(headers["x-init-data"], secretKey);
    if (!result?.user) return status(401, "UNAUTHORIZED");
    return { tgId: result.user.id, user: result.user };
  })
  .as("scoped");
```

`.as("scoped")` is what propagates the resolved context to the parent instance. Without it the plugin type-checks and does nothing.

Machine-to-machine (partner webhooks, internal callers): a bearer token compared in constant time, on its own plugin. **Not in the URL path** — see [race-conditions.md](race-conditions.md) Class 7.

Admin: separate auth, separate cookie, separate secret. Never role-check off the same token as user auth.

## Aggregate endpoints

Figma hub screens need many things at once. One `GET /user` returning profile + balance + active state is right; five round-trips on a mobile network is not. But keep aggregation **shallow** — one level of nesting, no recursive expansion. If the frontend needs a different shape later, add a field; do not add a query-language.

Always include `serverTime` (ISO-8601) in the bootstrap response. Every countdown, cooldown and "available tomorrow" in the UI must be computed against server time, or a user with a skewed clock gets a different product.

## Idempotency and mutation semantics

State in the contract, per mutating endpoint, which of these it is:

1. **naturally idempotent** — `PUT`-style replace, safe to retry;
2. **guarded by a natural key** — retry returns 409 `ALREADY_*` (Class 3);
3. **requires an `Idempotency-Key` header** — retry replays the stored response (Class 5).

Option 3 is mandatory for anything involving money or an irreversible external effect. Decide this at design time; it is in the contract, not in the implementation.

## Lists

- Ordering is explicit and **stable** — order by a unique tiebreaker (`ORDER BY sort_order, id`), or concurrent inserts will duplicate and skip rows across pages.
- Offset pagination is fine for admin-ish lists and short feeds; cursor pagination for anything append-heavy. Say which, and why, in the plan.
- Return the array directly for simple lists; wrap in `{ items, total }` only when the client genuinely needs the total — `count(*)` on a large table is not free.

## Media

Store paths, return URLs. A helper that prefixes the CDN base at query time keeps the column portable across environments. Uploads are presigned direct-to-S3; the API never proxies bytes it does not need to inspect.

## CORS

An explicit origin list from config. `cors()` with no arguments allows every origin, which for a cookie- or header-authenticated API is a vulnerability, not a convenience. See [anti-patterns.md](anti-patterns.md) A6.

## Rate limiting

Every unauthenticated endpoint and every expensive authenticated one gets a limit. Redis `INCR` + `EXPIRE` keyed by ip or user id is enough. Name the limits in the plan; "we'll add it later" means an LLM-backed endpoint bills someone's credit card.

## OpenAPI exposure

`@elysiajs/openapi` generates the spec from the route schemas. In production, gate it behind an unguessable path from config (`OPENAPI_PATH`, empty = disabled) rather than leaving `/swagger` open. It is a complete map of your attack surface.

## Route files hold no business logic

A route validates, calls a service or query function, maps the result to a status. The moment a transaction appears inline in a route, that logic is untestable without HTTP and unreusable from the bot. Layering: `routes/` → `services/` → `db/queries/`. See [monolith-layout.md](monolith-layout.md).

## The endpoint table

The plan's primary artefact is a table, one row per endpoint:

| Method | Path | Auth | Request | Success | Errors | Requirement | Hotspot |
| --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/boxes/:id/purchase` | init-data | — | `{code, balance}` | 400 `INSUFFICIENT_BALANCE`, 404 `BOX_NOT_FOUND`, 409 `OUT_OF_STOCK` | REQ-014 | H-003 |

The last two columns are what `coverage-report.mjs` checks. An endpoint with no requirement is scope creep; a requirement with no endpoint is a hole.
