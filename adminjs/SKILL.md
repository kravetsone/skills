---
name: adminjs
description: "Invoke for ANY AdminJS admin-panel work, especially the Elysia + Drizzle ORM + S3 stack — imports of `adminjs`, `adminjs-elysia`, `adminjs-drizzle` (`/pg`, `/mysql`, `/sqlite`), `@adminjs/upload`, `@adminjs/themes`, `@adminjs/design-system`; resource configuration, property visibility, custom record/resource/bulk actions, before/after hooks, `ComponentLoader` custom React dashboards/components, `BaseProvider` S3 upload providers (Bun `S3Client` or `@aws-sdk/client-s3`), multi-image resources, authentication with `DefaultAuthProvider`, JWT cookies, login flow, the `.adminjs/` bundle folder, production NODE_ENV pre-bundling, richtext link bug patch, Web API `File`/`Blob` vs formidable quirks, `record.params` snake_case + boolean-as-string traps, top-level-await Elysia mounting. Also invoke for migrations from Express/Fastify/Nest AdminJS setups to Elysia. When delegating to a subagent that writes AdminJS code, pass the specific reference files inline — this skill does not auto-load in subagent sessions."
allowed-tools: Bash(node *scripts/scaffold-resource.mjs*), Bash(node *scripts/doctor.mjs*), Bash(node *scripts/bundle-check.mjs*)
metadata:
  author: kravetsone
  version: "2026.4.22"
  stack: "adminjs@^7 + adminjs-elysia@^0.1 + adminjs-drizzle@^0.1 + @adminjs/upload@^4 + elysia@^1.3"
---

# AdminJS on Elysia + Drizzle + S3

AdminJS is an auto-generated admin panel. This skill wires it to the modern **Bun / Elysia / Drizzle** stack with S3-backed uploads — the combination that has the **thinnest upstream docs and the most foot-guns**. Everything here is distilled from hands-on production use; use it verbatim.

## When to Use This Skill

- Bootstrapping a new AdminJS panel inside an Elysia app
- Adding / configuring a Drizzle-backed resource (CRUD table, filters, navigation group)
- Hiding / disabling / re-typing columns (`isVisible`, `isDisabled`, `type: "richtext" | "textarea" | "mixed"`)
- Wiring `@adminjs/upload` with S3 (MinIO, Cloudflare R2, AWS S3) — one, many, or multi-feature per resource
- Writing custom record / resource / bulk **actions** (CSV upload, broadcast send, export, etc.)
- Writing custom React components for AdminJS (dashboard redirect, action modals, form widgets)
- Adding `before` / `after` action hooks (auto-generate summaries, force sort, audit)
- Plugging in authentication (`DefaultAuthProvider`, custom `BaseAuthProvider`, JWT cookies)
- Diagnosing: blank page after login, file-upload saves `[object Object]`, booleans coming in as `"true"`, login loop, production bundle missing, richtext links silently stripped
- Migrating an AdminJS panel from Express/Fastify/Nest to Elysia

## Quick Start (minimal)

```bash
bun add adminjs adminjs-elysia adminjs-drizzle @adminjs/upload @adminjs/themes @elysiajs/jwt node-mocks-http react@18 react-dom@18
```

```typescript
// src/admin/index.ts
import AdminJS, { ComponentLoader } from "adminjs";
import * as PgAdapter from "adminjs-drizzle/pg";
import { buildRouter } from "adminjs-elysia";
import Elysia from "elysia";
import { db } from "../db";
import { usersTable } from "../db/schema";

AdminJS.registerAdapter(PgAdapter);

const componentLoader = new ComponentLoader();

const admin = new AdminJS({
    rootPath: "/admin",
    componentLoader,
    resources: [{ resource: { table: usersTable, db }, options: {} }],
});

export const adminRouter = new Elysia({ detail: { hide: true } })
    .use(await buildRouter(admin, {}));
```

```typescript
// src/index.ts
import Elysia from "elysia";
import { adminRouter } from "./admin";

new Elysia().use(adminRouter).listen(3000);
```

Visit `http://localhost:3000/admin`.

> **Runtime note.** `adminjs-elysia` serves static assets via `Bun.file()` — it **only runs on Bun**. For Node/Deno you need a fork or a workaround (see [setup-and-bundling](references/setup-and-bundling.md)).

## Introspection Scripts

Three Node scripts live under `scripts/`. They read the caller's `node_modules/` + source to answer AdminJS questions without scraping the web.

Run from the user's project root (where `node_modules/` lives).

| Script | Use it when |
|--------|-------------|
| `scripts/scaffold-resource.mjs <tableName> [--navigation Name]` | You have a Drizzle table and want a ready-to-paste AdminJS resource entry. Reads the table's columns + foreign keys from `node_modules/drizzle-orm/pg-core` metadata and emits a resource block with sensible `listProperties`, `READONLY` on `id`/`createdAt`, `HIDDEN` on raw S3 path columns, and `type: "mixed"` on JSON columns. |
| `scripts/doctor.mjs` | The panel won't start, login loops, uploads vanish, or the `.adminjs/` bundle behaves weirdly. Diagnoses: missing peerDeps (`@elysiajs/jwt`, `node-mocks-http`), React version mismatch (`react@19` breaks AdminJS), ComponentLoader paths that don't resolve from CWD, `.adminjs/` folder freshness, richtext-link patch state, `S3_*` env vars. Prints a prioritized fix list. |
| `scripts/bundle-check.mjs` | You suspect the custom-components bundle is stale or missing in production. Verifies `.adminjs/entry.js` and `.adminjs/bundle.js` exist, checks their mtime against `src/admin/**/*.tsx`, and tells you whether `NODE_ENV=production` will serve a stale bundle. |

```bash
node scripts/scaffold-resource.mjs articlesTable --navigation Content
node scripts/doctor.mjs
node scripts/bundle-check.mjs
```

The scripts print **actionable fixes**, not just diagnostics — always start here before reading references.

## Critical Concepts

Read these **once** before writing any AdminJS code. Each is a gotcha that will silently break production if ignored.

1. **`UploadedFile` is a Web API `File` (Blob) under adminjs-elysia — NOT a formidable `{ path }` object.** `@adminjs/upload`'s built-in `AWSProvider` / `GCPProvider` call `fs.createReadStream(file.path)` and will crash or upload `undefined`. **You must write a custom `BaseProvider`** that reads `file` as a `Blob` (`file.arrayBuffer()`, `file.stream()`, or pass directly to `Bun.s3.write()` / S3 SDK `PutObjectCommand` with the `Body: file as Blob`). See [s3-uploads](references/s3-uploads.md) and [templates/upload-provider-bun.ts](templates/upload-provider-bun.ts).

   ```typescript
   // ❌ NEVER — @adminjs/upload's built-in providers rely on formidable's file.path
   provider: { aws: { bucket, accessKeyId, secretAccessKey, region } }

   // ✅ Always subclass BaseProvider and treat file as a Blob
   class S3Provider extends BaseProvider {
     async upload(file: UploadedFile, key: string) {
       await bunS3.write(key, file as unknown as Blob, { type: file.type });
     }
   }
   ```

2. **`adminjs-drizzle` gives you snake-cased keys AND boolean-as-string inside action handlers.** `record.params.isStarted` will be `undefined` — the key is `record.params.is_started`, and under certain code paths AdminJS will serialize it as the string `"true"` / `"false"` instead of a native boolean. Always normalize:

   ```typescript
   const isStarted =
       record.params.is_started === true ||
       record.params.is_started === "true";
   ```

   This quirk does **not** affect the UI forms — those use the camelCase DB path via the adapter's property mapping. It only hits you in custom action handlers that read raw `record.params`. See [drizzle-adapter](references/drizzle-adapter.md) → "params shape".

3. **JSON / JSONB columns will show up as textareas expecting a JSON string.** The adapter stringifies on read and `JSON.parse`s on write. If a user types anything non-JSON the entire record update throws. Always override:

   ```typescript
   properties: {
       metadata: { type: "mixed" }, // renders structured subfields instead of a raw textarea
   }
   ```

   See [drizzle-adapter](references/drizzle-adapter.md) → "JSON columns".

4. **`buildRouter` / `buildAuthenticatedRouter` *always return a Promise* — you must `await` at module scope.** `new Elysia().use(buildRouter(...))` without `await` mounts nothing. Because you're using top-level await, your tsconfig must have `"module": "esnext"` + `"target": "esnext"` (or `es2022`+) and Elysia must be imported synchronously. See [elysia-integration](references/elysia-integration.md).

   ```typescript
   // ✅ top-level await required
   export const adminRouter = new Elysia().use(await buildRouter(admin, {}));
   ```

5. **The options object on `buildRouter(admin, options)` is currently a no-op in v0.1.4.** If you pass `{ logErrors: true, logAccess: true }` — as many older snippets do — the values are silently ignored. Don't rely on them. If you need access logs, attach an Elysia `.onRequest` before mounting. See [elysia-integration](references/elysia-integration.md) → "Options that don't work".

6. **The login cookie name is inconsistent in `buildAuthenticatedRouter` (v0.1.4).** The login handler writes cookie `adminjs`, the protection middleware reads cookie `adminUser`. Always set `cookieName` explicitly in `AuthenticationOptions` to force both branches to agree:

   ```typescript
   buildAuthenticatedRouter(admin, {
       provider,
       cookiePassword: config.ADMIN_COOKIE_SECRET,
       cookieName: "adminjs", // ← force consistency
   }, {});
   ```

   Without this, auth appears to succeed but every protected route redirects back to login. See [authentication](references/authentication.md).

7. **`ComponentLoader.add(name, path)` resolves `path` relative to process CWD, not the caller file.** In dev that's usually fine (CWD == project root); in production it bites. Prefer passing a path that's obviously correct from anywhere:

   ```typescript
   import path from "node:path";
   componentLoader.add("Dashboard", path.join(import.meta.dir, "dashboard"));
   ```

   The bare `componentLoader.add("Dashboard", "dashboard")` form works only because the TSX file sits in the same directory you launch `bun` from. See [custom-components](references/custom-components.md).

8. **AdminJS pins React 18 for the UI bundle.** React 19 installed as a peer causes a silent runtime crash ("Invalid hook call") inside the AdminJS design-system bundle. Pin with `"react": "18"` + `"react-dom": "18"` and `"@types/react": "18"`. See [setup-and-bundling](references/setup-and-bundling.md).

9. **Richtext link button is broken in `@adminjs/design-system`** — the `link` command only calls `unsetLink()` and never `setLink()`, so **editors cannot add links**, only remove them. Fix via a postinstall patch script: [templates/patch-adminjs-richtext.mjs](templates/patch-adminjs-richtext.mjs). Registering the patch in `package.json`:

   ```json
   { "scripts": { "postinstall": "node scripts/patch-adminjs-richtext.mjs" } }
   ```

10. **Record action handlers *must* return `{ record: ctx.record.toJSON(ctx.currentAdmin), notice?, redirectUrl? }`.** Omitting `record` crashes the frontend with an opaque "Cannot read properties of undefined" after the action POSTs. Always end with:

    ```typescript
    return {
        record: context.record.toJSON(context.currentAdmin),
        notice: { message: "Done", type: "success" as const },
    };
    ```

    See [custom-actions](references/custom-actions.md).

11. **Multiple `uploadFileFeature` entries on the same resource MUST use distinct virtual property names** (`file`, `filePath`, `filesToDelete`) — otherwise the features collide and only one works. Example: a resource with both `image` and `currencyImage`:

    ```typescript
    uploadFileFeature({ /*...*/ properties: {
        key: "imagePath", file: "imageFile", mimeType: "imageMimeType",
        filePath: "imageFilePath", filesToDelete: "imageFilesToDelete",
    }}),
    uploadFileFeature({ /*...*/ properties: {
        key: "currencyImagePath", file: "currencyImageFile", mimeType: "currencyImageMimeType",
        filePath: "currencyImageFilePath", filesToDelete: "currencyImageFilesToDelete",
    }}),
    ```

    See [s3-uploads](references/s3-uploads.md) → "Multiple upload features per resource".

12. **Production MUST pre-bundle with `@adminjs/bundler` + `ADMIN_JS_SKIP_BUNDLE="true"` (STRING, not boolean).** Default behavior — bundling on server startup — delays first request 1–3s, burns 200–500 MB RAM (can OOM small containers), writes to `.adminjs/` (breaks read-only FS). The official `@adminjs/bundler` runs once in CI, outputs to a static folder, and the server serves it with zero runtime bundling. **The skip env var is a string `"true"`** — AdminJS does `=== "true"`; a boolean `true` or the string `"True"` is silently ignored. See [production-bundling](references/production-bundling.md) and [templates/bundle.ts](templates/bundle.ts).

13. **Never call `require("@adminjs/upload")` from TypeScript without a guard.** The user's reference code does `require("@adminjs/upload").LocalProvider` to load the local-dev provider lazily — this works under Bun but throws under strict ESM Node setups. Prefer a top-level dynamic `import()` or conditional inside an `async` function. See [s3-uploads](references/s3-uploads.md) → "Dev fallback pattern".

14. **`features: [uploadFileFeature(...)]` runs AFTER `options.properties` overrides — so hide the raw `_path` / `_mimeType` columns via `HIDDEN`, and *do not* define `file` / `filePath` in `properties`** (they're virtual). If you see two columns for the same file, you've duplicated.

15. **Subagent delegation** — when spawning an agent that writes AdminJS code, explicitly pass the relevant reference paths in the prompt (e.g. `skills/adminjs/references/s3-uploads.md`, `skills/adminjs/references/custom-actions.md`) or inline the key rules. This skill does not auto-activate inside subagents.

## Visibility Helper Constants (copy-paste into every project)

These three constants — extracted from the user's reference project — are the cleanest way to keep resource definitions readable. Add them once at the top of `resources.ts`:

```typescript
const READONLY   = { isDisabled: true };
const HIDDEN     = { isVisible: false };
const SHOW_ONLY  = { isVisible: { list: false, show: true, edit: false, filter: false } };
const FILTER_ONLY = { isVisible: { list: false, show: true, edit: false, filter: true } };
const EDIT_ONLY  = { isVisible: { list: false, show: true, edit: true, filter: false } };
```

Use them as `properties: { id: READONLY, internalNotes: HIDDEN, termsAcceptedAt: SHOW_ONLY }`.

## References

### Core integrations

| Topic | Description | File |
|-------|-------------|------|
| Elysia integration | `buildRouter` / `buildAuthenticatedRouter` internals, top-level await, mounting, body parsing, assets, hiding from OpenAPI, options that don't work | [elysia-integration](references/elysia-integration.md) |
| Drizzle adapter | `/pg` vs `/mysql` vs `/sqlite`, registration forms, type mapping table, snake_case param keys, JSON columns, bigint, enums, foreign-key auto-reference | [drizzle-adapter](references/drizzle-adapter.md) |
| S3 uploads | `BaseProvider` contract, Web File vs formidable, Bun `S3Client` + `@aws-sdk/client-s3` providers, MinIO / R2 / AWS config, multi-feature resources, dev fallback, validation | [s3-uploads](references/s3-uploads.md) |
| Resources configuration | `listProperties`, property overrides, navigation groups, richtext/textarea/mixed, filters, enums, `description` helptext, translations | [resources-configuration](references/resources-configuration.md) |
| Custom actions | `actionType`, handler signature, `guard`, `isAccessible`, before/after hooks, action from within a custom component (fetch to `/admin/api/resources/:r/records/:id/:action`) | [custom-actions](references/custom-actions.md) |
| Custom components | `ComponentLoader`, path resolution, `@adminjs/design-system` primitives, dashboard redirect, action modal pattern, form widgets | [custom-components](references/custom-components.md) |
| Authentication | `DefaultAuthProvider`, cookie gotchas, DB-backed auth, JWT, role gating via `isAccessible`, dev bypass | [authentication](references/authentication.md) |
| Setup & bundling | Install order, peerDeps, React 18 pin, `@tiptap/extension-horizontal-rule` override, `.adminjs/` dev folder, Docker basics | [setup-and-bundling](references/setup-and-bundling.md) |
| Production bundling | `@adminjs/bundler` + `ADMIN_JS_SKIP_BUNDLE="true"`, asset versioning manifest, CI/CD pipeline, read-only FS, cache-busting on CDN | [production-bundling](references/production-bundling.md) |
| Official features | `@adminjs/passwords`, `@adminjs/logger`, `@adminjs/import-export`, `@adminjs/leaflet`, `@adminjs/relations` (premium), `@adminjs/firebase-auth` — Drizzle-compatible examples | [official-features](references/official-features.md) |
| Community components | `@rulab/adminjs-components`: Singleton, ColorStatus, Slug, UUID, Editor (EditorJS — the Tiptap escape hatch), StringList, SortableList (drag-drop reorder), Tabs, Preview | [community-components](references/community-components.md) |
| Troubleshooting | Symptom → cause → fix for every known trap (blank page, login loop, `[object Object]` uploads, booleans as strings, stale bundle, broken richtext links, CORS, OpenAPI spam) | [troubleshooting](references/troubleshooting.md) |

### Templates (ready to copy)

| Template | Purpose | File |
|----------|---------|------|
| `admin-index.ts` | Full AdminJS + Elysia entrypoint with auth + themes + componentLoader | [templates/admin-index.ts](templates/admin-index.ts) |
| `resources.ts` | `getResources(db, componentLoader)` skeleton with helper constants and one fully-configured example | [templates/resources.ts](templates/resources.ts) |
| `upload-provider-bun.ts` | Bun-native S3 provider (Bun 1.x `S3Client`) with local fallback | [templates/upload-provider-bun.ts](templates/upload-provider-bun.ts) |
| `upload-provider-aws-sdk.ts` | Same contract, `@aws-sdk/client-s3` (for Node/Deno) | [templates/upload-provider-aws-sdk.ts](templates/upload-provider-aws-sdk.ts) |
| `dashboard.tsx` | Redirect-only dashboard — jumps straight to a chosen resource | [templates/dashboard.tsx](templates/dashboard.tsx) |
| `custom-record-action.tsx` | Modal-style record action: file input → POST to action endpoint → success notice | [templates/custom-record-action.tsx](templates/custom-record-action.tsx) |
| `patch-adminjs-richtext.mjs` | postinstall script fixing the broken richtext link button | [templates/patch-adminjs-richtext.mjs](templates/patch-adminjs-richtext.mjs) |
| `bundle.ts` | Standalone `@adminjs/bundler` pre-bundle script — runnable in CI to eliminate server-side bundling | [templates/bundle.ts](templates/bundle.ts) |

### Examples (complete runnable files)

| Example | Description | File |
|---------|-------------|------|
| Minimal | Single table, no auth, local filesystem upload | [examples/minimal.ts](examples/minimal.ts) |
| Auth + S3 + custom action | Full production-shape setup: auth, Bun S3 provider, custom record action, before/after hooks, navigation groups | [examples/with-auth-and-upload.ts](examples/with-auth-and-upload.ts) |

## Red Flags — stop and reconsider if...

- You're using `provider: { aws: {...} }` or `{ gcp: {...} }` inside `uploadFileFeature` while on Elysia → will fail silently, write a `BaseProvider` subclass instead.
- You wrote `new Elysia().use(buildRouter(admin, {}))` **without `await`** → router is a Promise, nothing is mounted.
- You have `react@19` / `react-dom@19` installed → AdminJS UI will hook-crash at runtime.
- You access `record.params.someCamelCaseBoolean` in an action handler → the Drizzle adapter gives you snake_case + possibly a string; normalize with `x === true || x === "true"`.
- You're storing a JSON column without `type: "mixed"` override → the form will silently corrupt the value on first edit.
- You define a custom S3 provider but read `file.path` → it's undefined, the file is a Blob.
- You have a multi-image resource with two `uploadFileFeature` blocks sharing default virtual names → second feature silently wins, first overwrites.
- You pre-baked `.adminjs/` in a Docker build but mount it on a read-only volume → first request crashes trying to write the bundle. **Use `@adminjs/bundler` instead** — no runtime writes.
- You set `ADMIN_JS_SKIP_BUNDLE=true` as a boolean (e.g. in a typed config loader) → AdminJS still bundles on startup. Must be literal string `"true"`.
- You're hand-rolling slug / sort / tabs / status-badge components → check `@rulab/adminjs-components` first; it likely ships what you need.
- You're using AdminJS's built-in Tiptap richtext for serious content editing → swap to `EditorFeature` (EditorJS) from `@rulab/adminjs-components`. Tiptap in AdminJS has a long tail of bugs.
- You need M2M UI and assume `@adminjs/relations` is free → it's **paid** (requires `ADMIN_JS_LICENSE_KEY` via `@adminjs/license`). On OSS/hobby, register the join table as its own resource or write a custom `attach`/`detach` action.
- You expect `buildRouter(admin, { logErrors: true })` to log errors → options object is inert in v0.1.4; add your own `.onError` on the parent Elysia app.

## Version Notes

Signatures verified against:

- `adminjs@^7.8.17`
- `adminjs-elysia@^0.1.4` — auth cookie bug and empty options object confirmed in shipped `dist/`
- `adminjs-drizzle@^0.1.2` — reads `peerDependencies: { "drizzle-orm": ">=0.44" }`
- `@adminjs/upload@^4.0.2`
- `elysia@^1.3.21`
- `@elysiajs/jwt@^1.4.0`

If a user is on older versions, the snake_case and cookie-name quirks may differ — re-check `node_modules/adminjs-elysia/dist/buildAuthenticatedRouter.js` and `node_modules/adminjs-drizzle/dist/pg/resource.js` before asserting a fix.
