# Setup and bundling

This file covers the **install + build** side of AdminJS on Elysia: peer dependencies, React pin, the `.adminjs/` bundle folder, production strategies, and Docker.

## Install order

```bash
bun add \
    adminjs@^7 \
    adminjs-elysia@^0.1 \
    adminjs-drizzle@^0.1 \
    @adminjs/upload@^4 \
    @adminjs/themes@^1 \
    @elysiajs/jwt@^1 \
    node-mocks-http@^1 \
    react@18 \
    react-dom@18

bun add -d @types/react@18
```

Drizzle ORM and Elysia are assumed present. If not:

```bash
bun add drizzle-orm@^0.44 postgres elysia@^1.3
```

## Peer dependencies — the ones `bun install` won't auto-fetch

`adminjs-elysia`'s `package.json` lists:

```json
"peerDependencies": {
    "adminjs": "^7.8.8",
    "elysia": "^1.1.5",
    "@elysiajs/jwt": "^1.1.0",
    "node-mocks-http": "^1.15.1"
}
```

pnpm and bun **don't** auto-install peers. Install them manually. `scripts/doctor.mjs` flags missing ones.

## React 18 pin (non-negotiable)

AdminJS's admin bundle is compiled against React 18's hook runtime. React 19 breaks it with runtime "Invalid hook call". Pin:

```json
{
    "dependencies": {
        "react": "18",
        "react-dom": "18"
    },
    "devDependencies": {
        "@types/react": "18"
    }
}
```

Verify after install: `bun pm ls react react-dom` must show 18.x only.

## `@tiptap/extension-horizontal-rule` override

Certain recent `@tiptap/extension-horizontal-rule` versions are incompatible with the pinned tiptap core inside `@adminjs/design-system`, manifesting as "Cannot read properties of undefined (reading 'schema')" the moment the richtext editor mounts. Override:

```json
{
    "overrides": {
        "@tiptap/extension-horizontal-rule": "2.1.13"
    }
}
```

(`overrides` works for Bun and npm; for yarn use `resolutions`.)

## The `.adminjs/` folder

`admin.initialize()` (called from `buildRouter` / `buildAuthenticatedRouter`) writes to `./.adminjs/`:

```
.adminjs/
├── entry.js      // auto-generated import manifest — lists every componentLoader.add()
└── bundle.js     // compiled browser bundle served at /admin/frontend/assets/components.bundle.js
```

In dev: `admin.watch()` re-bundles on TSX change.
In prod: bundle is generated once on startup (slow first request) unless pre-compiled.

### `.gitignore`

```gitignore
.adminjs/
```

Always ignore in dev. In prod, choose one of the strategies below.

## Production bundle strategies

### Strategy A — pre-compile in the Docker build (recommended)

Run the app once during the build so `.adminjs/bundle.js` exists when the container starts. This costs one extra build step but kills the cold-start delay.

```dockerfile
FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun build ./src/index.ts --target=bun --outdir=./dist || true
# Pre-compile the AdminJS bundle by running the app for 1 second
RUN timeout 5 bun ./src/index.ts || true
RUN test -f .adminjs/bundle.js

FROM oven/bun:1-alpine
WORKDIR /app
COPY --from=build /app /app
CMD ["bun", "./src/index.ts"]
```

The `timeout 5 bun ./src/index.ts || true` gives the app long enough to compile the bundle, then kills it. The `test -f` line fails the build if the bundle didn't appear.

### Strategy B — accept cold-start delay

Skip the pre-compile step. First request to `/admin` after container start is slow (1–3 s). Subsequent requests are fast. Works for low-traffic admin panels.

### Strategy C — ship the bundle in the image

Commit `.adminjs/` to version control. Simple but couples the bundle to your release history; adds noise to PRs. Only viable if custom components are stable.

### Read-only filesystems

If your container runs with a read-only root FS (common in Kubernetes with strict security), `.adminjs/` can't be written — the first request crashes. Fixes:

- Mount a `tmpfs` or writable volume at `/app/.adminjs`.
- Pre-compile (Strategy A) and then set the FS read-only.

## `NODE_ENV`

- `development` → `admin.watch()` keeps running, re-bundling on TSX change. `bundle.development.js` is served (un-minified).
- `production` → `admin.watch()` is a no-op. `bundle.production.js` is served (minified). Source maps omitted.

Always set `NODE_ENV=production` in prod — the dev bundle is ~4× larger and ships with warnings and tracing.

## Richtext patch (postinstall)

`@adminjs/design-system`'s richtext editor has a broken link button — it only *removes* links, never adds them. Fix via a postinstall patch that edits `node_modules/@adminjs/design-system/bundle.*.js`:

```json
// package.json
{
    "scripts": {
        "postinstall": "node scripts/patch-adminjs-richtext.mjs"
    }
}
```

See [templates/patch-adminjs-richtext.mjs](../templates/patch-adminjs-richtext.mjs). The script is idempotent (detects already-patched files), safe to rerun.

Because this edits `node_modules`, re-runs on every `bun install` / `npm install`. CI flows that run `install` also run the patch.

## tsconfig essentials

```json
{
    "compilerOptions": {
        "target": "esnext",
        "module": "esnext",
        "moduleResolution": "bundler",
        "jsx": "react-jsx",
        "allowJs": true,
        "esModuleInterop": true,
        "strict": true,
        "skipLibCheck": true,
        "resolveJsonModule": true,
        "isolatedModules": true,
        "noEmit": true
    },
    "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

- `module: esnext` + `target: esnext` → top-level `await buildRouter(...)` works.
- `moduleResolution: bundler` → Bun-style subpath exports (`adminjs-drizzle/pg`) resolve.
- `jsx: react-jsx` → no `import React from "react"` needed in TSX files.
- `skipLibCheck: true` → AdminJS's types have some gnarly generics that conflict across versions; skip.

## `@ts-expect-error` on `resources`

`adminjs-drizzle` returns `Resource[]` whose `table` property is typed as `PgTableWithColumns<TableConfig>`, but your actual tables are `PgTableWithColumns<{ name, columns, schema, dialect }>` — strict mode flags the assignability. Two options:

```typescript
const admin = new AdminJS({
    // @ts-expect-error — adminjs-drizzle's Resource type is over-generic
    resources: getResources(db, componentLoader),
    componentLoader,
});
```

Or narrow the return type of `getResources()` to `any[]` (pragmatic, less verbose).

This is a known type-level friction, not a runtime issue.

## Elysia + OpenAPI — hide the admin subtree

If you use `@elysiajs/openapi` / Swagger, the `/admin/**` routes will bloat your OpenAPI document with dozens of auto-generated paths. Hide them:

```typescript
export const adminRouter = new Elysia({ detail: { hide: true } })
    .use(await buildRouter(admin, {}));
```

The `detail: { hide: true }` on the Elysia wrapping the admin router propagates down to every route registered on it.

## Static file serving for uploads (dev only)

If you use `LocalProvider` in dev, serve the uploads folder:

```typescript
import { staticPlugin } from "@elysiajs/static";

new Elysia()
    .use(staticPlugin({ assets: "uploads", prefix: "/uploads" }))
    .use(adminRouter);
```

In prod with S3, the uploads never hit your server — S3 serves them directly.

## Container image size

AdminJS pulls in a **lot**: design-system, tiptap, various icon packs, React, react-router. A production bun image is typically 350–500 MB. Minimize:

- Use `oven/bun:1-alpine` (not `oven/bun:1`).
- Multi-stage: `bun install --production` in a final stage (skips devDeps).
- Run `bun pm untrusted` and audit what's been allowed to execute postinstall.

## Zero-downtime deploys

If you rotate `ADMIN_COOKIE_SECRET` during a deploy, all existing sessions become invalid mid-request. Strategies:

- **Pin the secret** across deploys. Rotate by issuing a new secret + keeping the old one as `ADMIN_COOKIE_SECRET_PREV` for a grace period, and having a custom auth provider try both.
- Accept a one-time forced logout on secret rotation.

## Verification after upgrade

After bumping any AdminJS package:

```bash
node scripts/doctor.mjs
```

Checks React version, peer deps, richtext patch freshness, and `.adminjs/` bundle presence.
