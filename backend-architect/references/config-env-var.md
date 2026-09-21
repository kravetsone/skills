# Configuration — env-var

One module, `src/config.ts`, is the only place `process.env` is read. Everything else imports `config`. This is not style: it makes the process **fail at startup** on a missing variable instead of failing at 2 a.m. on the one code path that needed it.

## Shape

```ts
import env from "env-var";

export const config = {
  NODE_ENV: env.get("NODE_ENV").default("development")
    .asEnum(["production", "test", "development"]),

  PORT: env.get("PORT").default(3000).asPortNumber(),
  DATABASE_URL: env.get("DATABASE_URL").required().asString(),
  REDIS_HOST: env.get("REDIS_HOST").default("localhost").asString(),

  BOT_TOKEN: env.get("BOT_TOKEN").required().asString(),
  WEBHOOK_SECRET: env.get("WEBHOOK_SECRET").required().asString(),

  LOCK_STORE: env.get("LOCK_STORE").default("memory").asEnum(["memory", "redis"]),
  FRONTEND_URL: env.get("FRONTEND_URL").required().asString(),
  OWNER_IDS: env.get("OWNER_IDS").default("").asArray().map(Number),
  TIMEZONE: env.get("TIMEZONE").default("Europe/Moscow").asString(),

  GAME_MAX_SCORE_PER_SESSION: env.get("GAME_MAX_SCORE_PER_SESSION").default(300).asIntPositive(),
};
```

Useful accessors: `asIntPositive`, `asPortNumber`, `asUrlString`, `asEnum`, `asArray`, `asBool`, `asJson`. Prefer the narrow one — `asIntPositive` rejects `-1` and `"abc"` at boot, where `asString` plus a `Number()` at the call site fails silently as `NaN`.

`.example("Europe/Moscow")` attaches a sample to the error message. On a deploy failure at 23:50 that is the difference between a fix and an investigation.

## Rules

### Secrets are required, never defaulted

```ts
POSTHOG_API_KEY: env.get("POSTHOG_API_KEY").default("it's a secret").asString(),   // WRONG
```

A defaulted secret cannot fail. It boots happily with a junk credential, and you discover the misconfiguration from an empty analytics dashboard a week later. If a secret is genuinely optional, model that explicitly:

```ts
POSTHOG_API_KEY: env.get("POSTHOG_API_KEY").asString(),          // undefined = disabled
// and downstream:
export const analyticsEnabled = Boolean(config.POSTHOG_API_KEY);
```

"Optional" must mean a feature switches off, never that it runs with a wrong value.

### No production identifiers as defaults

```ts
BOT_USERNAME: env.get("BOT_USERNAME").default("realproductionbot").asString(),   // WRONG
TG_LOG_CHAT_ID: env.get("TG_LOG_CHAT_ID").default("-1002416577602").asInt(),     // WRONG
```

A real chat id as a default means a staging deploy that forgot the variable posts into the production channel. Real identifiers are `.required()`. Defaults are for values that are genuinely safe everywhere — page sizes, retry counts, `localhost`.

### Never derive the environment from a string match

```ts
const IS_STAGING = PUBLIC_DOMAIN.includes("staging");   // WRONG
```

This makes the domain name a control plane. Rename the staging host, or ship a production host that happens to contain the substring, and behaviour changes with no code change and no deploy note. It is worse when the flag gates CORS or auth. Use `NODE_ENV`, or an explicit `APP_ENV` with the values development, staging, production.

### Constants belong here, not in code

Every number from the spec's "Verbatim numbers" list becomes a config entry with a domain prefix (`GAME_*`, `TAPS_*`, `CHAT_*`). Then tuning the economy is a variable change, and the plan can state which knobs exist without anyone reading the source.

### Derived values as getters

```ts
get STATIC_BASE_URL() {
  if (this.STATIC_URL) return this.STATIC_URL;
  if (!this.S3_ENDPOINT) return "";
  const base = this.S3_ENDPOINT.startsWith("http")
    ? this.S3_ENDPOINT
    : "https://" + this.S3_ENDPOINT;
  return base + "/" + this.S3_BUCKET;
},
```

Keeps the fallback chain in one readable place instead of spread across call sites.

### Validate production-only requirements explicitly

Some variables are optional in development and mandatory in production. `env-var` cannot express that, so assert it right after the object:

```ts
if (config.NODE_ENV === "production") {
  if (config.LOCK_STORE !== "redis")
    throw new Error("LOCK_STORE must be 'redis' in production");
  if (!config.SENTRY_DSN)
    throw new Error("SENTRY_DSN is required in production");
}
```

The `LOCK_STORE` assertion is the important one: an in-memory lock across multiple replicas always succeeds, which looks like everything working while the invariant it protects quietly rots. See [locks-verrou.md](locks-verrou.md).

## Tests

Tests set `process.env` **before** anything imports `config.ts` — in a preload file. Because the config module reads at import time, an ordering mistake surfaces as a confusing "required variable missing" in an unrelated test. See [testing.md](testing.md).

## In the plan

A table: variable, type, required?, default, source (platform / secret / application), purpose. Mark which are new and therefore need a CI change — see [platform-contract.md](platform-contract.md).
