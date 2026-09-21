# Monolith layout

One process, one image, one deploy — serving REST, the bot, and background jobs. The directory structure is what keeps that from becoming a ball of mud.

```
src/
├── index.ts              # composition root: start, wire, graceful shutdown
├── config.ts             # the ONLY place process.env is read
├── db/
│   ├── index.ts          # drizzle client
│   ├── schema.ts         # tables, enums, constraints, relations
│   └── queries/          # reusable query functions, one file per aggregate
├── server/
│   ├── index.ts          # Elysia app: plugins, CORS, OpenAPI, error mapping
│   ├── plugins/          # auth, bearer-auth, rate-limit — cross-cutting
│   └── routes/           # one file per resource; validation + delegation only
├── bot/
│   ├── index.ts          # GramIO instance + plugins
│   ├── commands/         # autoloaded
│   └── scenes/           # multi-step dialogs
├── services/             # business logic — the layer both entry points share
│   ├── locks.ts
│   ├── redis.ts
│   ├── jobs/             # taskora task definitions
│   ├── analytics.ts
│   └── <domain>.ts
├── shared/               # constants, locales, keyboards, pure helpers
└── telemetry.ts          # OTel wiring, imported first
tests/
├── preload.ts            # PGlite + module mocks; runs before everything
├── api.ts                # Eden treaty client
└── e2e/
```

## The one rule that matters

**Entry points are thin; services hold the logic.**

`routes/` validates input, calls a service, maps the result to a status. `bot/commands/` parses an update, calls a service, renders a message. Neither opens a transaction.

This is not layering for its own sake. In this architecture the same operation is reachable from three places — REST, bot, and a job — and logic that lives in a route is available to exactly one of them. The reference projects show the consequence directly: near-identical endpoints implemented twice, drifting apart, with a concurrency fix applied to one of them.

```ts
// routes/boxes.ts — thin
.post("/:id/purchase", async ({ tgId, params, status }) => {
  const result = await purchaseBox({ userId: tgId, boxId: params.id });
  if ("error" in result) return status(result.httpStatus, result.error);
  return result.data;
}, { params: PurchaseParams, response: PurchaseResponses });
```

The service returns a discriminated result rather than throwing. Exceptions as control flow lose type information at exactly the boundary where the response union needs it.

## Dependency direction

```
routes/ ─┐
         ├─→ services/ ─→ db/queries/ ─→ db/schema.ts
bot/   ──┘                     ↑
jobs/  ────→ services/ ────────┘
```

Strictly downward. A service importing from `routes/` means the logic belongs in the service; a query function importing a service means the boundary is wrong. Both are worth catching in review because they are cheap to fix early and expensive later.

## Composition root

`index.ts` does four things in order: import telemetry first (instrumentation must be installed before the modules it patches), start the HTTP server, start the bot, register signal handlers.

```ts
import "./telemetry.ts";               // must be first
import { app } from "./server/index.ts";
import { bot } from "./bot/index.ts";

app.listen(config.PORT);

if (config.NODE_ENV === "production") {
  await bot.start({ webhook: { url: config.API_URL + "/tg/webhook" } });
} else {
  await bot.start();                   // polling in dev
}
```

## Graceful shutdown

Order is the reverse of startup, and it is not arbitrary — each step must not orphan the ones before it:

```ts
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await app.stop();              // 1. stop accepting HTTP
    await bot.stop();              // 2. stop accepting updates
    await taskora.stop();          // 3. let in-flight jobs finish
    await analytics.shutdown();    // 4. flush the last batch
    await redis.quit();            // 5. now the dependencies can go
    await sql.end();
    process.exit(0);
  });
}
```

Analytics before Redis, because flushing may need it. Jobs before Redis, for the same reason. Closing Redis first turns a clean stop into stalled jobs and lost events.

## Admin panel

AdminJS mounted on the same Elysia app, behind its own auth and its own cookie secret. It shares the schema, which is the point — content editing without a second service. Never share the user auth token with it.

## Where the plan describes this

A module map: each directory, its responsibility, and the `REQ-###` it serves. Plus the composition root's startup order and the shutdown sequence — both are things that get wrong on the first implementation attempt and are invisible until a deploy drops data.
