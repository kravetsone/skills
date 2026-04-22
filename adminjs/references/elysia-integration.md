# Elysia integration (`adminjs-elysia`)

`adminjs-elysia` is a thin adapter that mounts AdminJS's internal router as an Elysia app. This file is the single source of truth for how it actually behaves — the README on npm is three lines long and several documented options are silently ignored.

## What it exports

```typescript
// from node_modules/adminjs-elysia/dist/index.d.ts
export { buildRouter } from "./buildRouter";
export {
    buildAuthenticatedRouter,
    type AuthenticationOptions,
    type AuthenticatedRouterOptions,
} from "./buildAuthenticatedRouter";
```

Concrete signatures (pulled from the shipped `.d.ts`):

```typescript
export const buildRouter: (
    admin: AdminJS,
    options: RouterOptions,                    // type RouterOptions = {}
) => Promise<Elysia<string>>;

export const buildAuthenticatedRouter: (
    admin: AdminJS,
    auth: AuthenticationOptions,
    options: AuthenticatedRouterOptions,       // type AuthenticatedRouterOptions = {}
) => Promise<Elysia<string>>;

export type AuthenticationOptions = {
    cookiePassword: string;
    cookieName?: string;
    provider: BaseAuthProvider<Context>;
};
```

## Mounting (the only correct pattern)

Both builders return `Promise<Elysia>`. Because Elysia's `.use()` is synchronous, the common mistake is:

```typescript
// ❌ router is a Promise — nothing is mounted
export const adminRouter = new Elysia().use(buildRouter(admin, {}));
```

You must resolve the promise at module scope with top-level `await`, then hand the resulting `Elysia` into `.use()`:

```typescript
// ✅
export const adminRouter = new Elysia({ detail: { hide: true } })
    .use(await buildRouter(admin, {}));
```

`detail: { hide: true }` excludes the entire admin sub-app from `@elysiajs/openapi` / Swagger — without it, a hundred auto-generated `/admin/...` endpoints bloat your OpenAPI doc.

Your tsconfig needs:

```json
{
    "compilerOptions": {
        "module": "esnext",
        "target": "esnext",          // or es2022
        "moduleResolution": "bundler"
    }
}
```

Bun honors top-level await out of the box. Node 20+ honors it when the entrypoint is ESM (`"type": "module"` in `package.json` or `.mts` extension).

## What the builder actually does

From `node_modules/adminjs-elysia/dist/buildRouter.js`:

1. `await admin.initialize()` — discovers resources, compiles the custom-components bundle into `.adminjs/bundle.js`.
2. `await admin.watch()` — starts the watcher that re-bundles when a custom component file changes.
3. Creates a `new Elysia({ prefix: admin.options.rootPath })` — the `rootPath` you passed to `new AdminJS({ rootPath })` becomes the Elysia mount prefix.
4. Walks `AdminJSRouter.routes` and registers each via `router.route(method, path, handler)`, after converting Express-style `{param}` placeholders to Elysia `:param` placeholders.
5. Serves static assets with `Bun.file(asset.src)`.

Because step 5 uses `Bun.file`, **this adapter requires Bun at runtime.** On Node/Deno the asset routes respond with a crash.

## Body handling for multipart uploads

Elysia auto-parses:
- `application/json` → `ctx.body` is a plain object
- `application/x-www-form-urlencoded` → plain object
- `multipart/form-data` → object where file fields are **Web API `File` objects** (Blob-compatible)

The adapter simply spreads `ctx.body` into `actionRequest.payload`. Downstream, `@adminjs/upload` reads the file field and hands it to your `BaseProvider.upload(file, key, ctx)`. So the `file` you receive is a `File`/`Blob`, **not** the formidable `{ path, type, name }` object that the official AdminJS providers expect. This is the root of the "custom S3 provider is mandatory" requirement — see [s3-uploads](s3-uploads.md).

No extra Elysia body parser config is needed for uploads.

## Options that don't work (v0.1.4)

The types publish `RouterOptions = {}` and `AuthenticatedRouterOptions = {}`. The implementation reads **no properties** from either object. Code like this compiles but has no effect:

```typescript
// These options are inert in v0.1.4 — silently ignored
await buildRouter(admin, { logErrors: true, logAccess: true } as any);
```

If you need request logging, attach it on the parent Elysia app **before** `.use(adminRouter)`:

```typescript
new Elysia()
    .onRequest(({ request }) => {
        if (request.url.includes("/admin")) console.log(request.method, request.url);
    })
    .onError(({ error, code }) => console.error("[admin]", code, error))
    .use(adminRouter);
```

## Authentication flow internals

`buildAuthenticatedRouter` wraps the unauthenticated router with:

1. `@elysiajs/jwt` plugin using `auth.cookiePassword` as the HS256 secret (hard-coded).
2. A `GET {loginPath}` that renders the login page (`admin.renderLogin({...providerProps})`).
3. A `POST {loginPath}` that calls `auth.provider.handleLogin({ headers, query, params, data })` — on success, signs the returned user as a JWT and sets it as the auth cookie, then 302-redirects to either `cookie.redirectTo.value` (set when the user was bounced from a protected route) or `admin.options.rootPath`.
4. A `GET /logout` that clears both cookies and redirects to `rootPath` (which will then bounce to login).
5. An `.onBeforeHandle` guard that reads the JWT from the cookie, verifies it, and if missing/invalid, stashes the current path into `cookie.redirectTo` and 302s to `loginPath`. The bundle route (`/admin/frontend/assets/components.bundle.js`) is intentionally bypassed so login page can load its JS.

### The cookie-name bug

In v0.1.4 the login POST and the guard use different defaults. From `buildAuthenticatedRouter.js`:

```javascript
const buildLoginLogout = (admin, auth, router) => {
    let cookieName = auth.cookieName ?? "adminjs";     // ← "adminjs" when unset
    // ...writes/clears this cookie on login + logout
};

const buildAuth = (admin, auth, router) => {
    let cookieName = auth.cookieName ?? "adminUser";   // ← "adminUser" when unset!
    // ...reads this cookie to check if user is logged in
};
```

If you don't pass `cookieName`, login sets `adminjs=<jwt>` but the guard looks for `adminUser=<jwt>` — authentication appears to succeed and then every request 302s back to `/admin/login`. **Always set `cookieName` explicitly:**

```typescript
buildAuthenticatedRouter(admin, {
    provider,
    cookiePassword: config.ADMIN_COOKIE_SECRET, // ≥32 chars recommended
    cookieName: "adminjs",                       // force both branches to agree
}, {});
```

## Prefix and `rootPath`

The Elysia app is built with `new Elysia({ prefix: admin.options.rootPath })`. The `rootPath` you pass to `new AdminJS({ rootPath: "/admin" })` is the prefix — **do not re-prefix** when mounting:

```typescript
// ✅
new Elysia().use(await buildRouter(admin, {}));

// ❌ double-prefixed: ends up at /admin/admin
new Elysia({ prefix: "/admin" }).use(await buildRouter(admin, {}));
```

If you need the admin panel at `/backoffice`, set `rootPath: "/backoffice"` on the AdminJS constructor — that flows into the Elysia prefix automatically.

## Peer dependencies

These are **peer** deps and must be installed explicitly in your project:

```json
{
    "peerDependencies": {
        "adminjs": "^7.8.8",
        "elysia": "^1.1.5",
        "@elysiajs/jwt": "^1.1.0",
        "node-mocks-http": "^1.15.1"
    }
}
```

Bun/pnpm won't auto-install these — `doctor.mjs` checks for them.

The adapter uses `node-mocks-http` internally to build a mock Express response that the AdminJS controllers write to — that's the shim layer between Express-shaped AdminJS controllers and Elysia's response model. You never touch it directly, but if it's missing you get a cryptic `Cannot find module 'node-mocks-http'` on the first request.

## Full production entrypoint

See [templates/admin-index.ts](../templates/admin-index.ts) for a complete, copy-paste file that:

- Registers the Drizzle adapter
- Creates a `ComponentLoader` and adds custom dashboard + action components
- Builds `AdminJS` with themes, branding, and resources
- Chooses `buildRouter` vs `buildAuthenticatedRouter` based on whether admin creds are configured
- Hides the whole subtree from OpenAPI via `detail: { hide: true }`

## Mounting alongside CORS and OpenAPI

```typescript
import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";

new Elysia()
    .use(cors({ origin: "*" }))                     // affects /admin too — usually fine
    .use(openapi({ exclude: ["/admin"] }))          // redundant w/ detail: { hide: true } but harmless
    .use(adminRouter)                                // admin router already hidden via detail
    .use(apiRouter)
    .listen(3000);
```

If you see double-prefixed routes or the Swagger UI listing hundreds of `/admin/...` endpoints, check that `detail: { hide: true }` is on the `Elysia` that wraps `adminRouter`, not on a grandparent.
