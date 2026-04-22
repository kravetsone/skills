# Troubleshooting

Every symptom that production AdminJS-on-Elysia has produced, in order of frequency. Diagnose by symptom → find cause → apply fix.

## Login & auth

### Symptom: login succeeds, then loops back to `/admin/login`

**Cause:** cookie-name mismatch in `adminjs-elysia@^0.1.4` — login writes cookie `adminjs`, guard reads `adminUser`.

**Fix:** set `cookieName` explicitly in `AuthenticationOptions`:

```typescript
buildAuthenticatedRouter(admin, {
    provider,
    cookiePassword,
    cookieName: "adminjs",
}, {});
```

See [authentication.md](authentication.md).

### Symptom: "Invalid credentials" with correct email/password

**Causes:**
1. `authenticate()` returned `false` instead of `null` (sometimes differs in behavior).
2. Wrong `cookiePassword` — if you rotated the secret, existing sessions reject.
3. Form sent `application/x-www-form-urlencoded` but provider expects `email` / `password` as typed strings — check browser Network tab.

**Fix:** return `null` for reject, truthy object for success. Never `false`.

### Symptom: "UnauthorizedError" on every request after deploy

**Cause:** `ADMIN_COOKIE_SECRET` changed between deploys — all existing JWTs invalidated.

**Fix:** pin the secret; users re-login.

---

## Uploads

### Symptom: file upload succeeds but stored value is `undefined` or `[object Object]`

**Cause:** using `provider: { aws: { ... } }` (built-in AWS provider) under Elysia. The built-in provider reads `file.path` from formidable; under Elysia, `file` is a Web API Blob with no `.path`.

**Fix:** write a custom `BaseProvider` subclass, treat `file` as `Blob`:

```typescript
class S3Provider extends BaseProvider {
    async upload(file: UploadedFile, key: string) {
        await s3.write(key, file as unknown as Blob, { type: file.type });
    }
}
```

See [s3-uploads.md](s3-uploads.md).

### Symptom: `TypeError: fs.createReadStream is not a function` on upload

**Cause:** copy-pasted a custom provider from an Express example that does `fs.createReadStream(file.path)`.

**Fix:** replace with `await file.arrayBuffer()` or pass `file as Blob` directly.

### Symptom: image renders in show view but 404s in list view

**Cause:** missing `filePath` virtual property declaration — list view uses `filePath` to render thumbnails.

**Fix:** add `filePath: "imageFilePath"` (or similar) to the feature's `properties`.

### Symptom: two upload features on one resource — only one works

**Cause:** virtual property name collision. Both features default to `file`, `filePath`, `filesToDelete`.

**Fix:** give each feature unique virtual names:

```typescript
// feature 1
properties: { key: "avatarPath", file: "avatarFile", filePath: "avatarFilePath", filesToDelete: "avatarFilesToDelete" }
// feature 2
properties: { key: "bannerPath", file: "bannerFile", filePath: "bannerFilePath", filesToDelete: "bannerFilesToDelete" }
```

### Symptom: `LocalProvider` crashes with `ENOENT: no such file or directory`

**Cause:** `LocalProvider.upload()` doesn't auto-create nested dirs; and under Elysia, the formidable `{ buffer }` shape it expects is absent.

**Fix:** write an Elysia-compat LocalProvider — see [s3-uploads.md](s3-uploads.md) → "Dev fallback".

### Symptom: MinIO/R2 uploads succeed but `path()` returns a 301-looping URL

**Cause:** virtual-hosted vs path-style addressing mismatch.

**Fix:**
- For MinIO: use `https://<host>/<bucket>/<key>` (path-style). In AWS SDK set `forcePathStyle: true`. In Bun `S3Client`, the URL naturally comes out path-style.
- For R2: virtual-hosted works via `https://<account>.r2.cloudflarestorage.com/<bucket>/<key>`.

---

## Routing / mounting

### Symptom: `/admin` returns 404

**Causes:**
1. Forgot `await` on `buildRouter(...)` — router is a Promise, nothing mounted.
2. Double-prefixed: wrapping Elysia has `prefix: "/admin"` *and* `rootPath: "/admin"` on AdminJS → actual URL is `/admin/admin`.

**Fix:**
```typescript
// ✅
export const adminRouter = new Elysia({ detail: { hide: true } })
    .use(await buildRouter(admin, {}));
```

Do not set a prefix on the wrapping Elysia — AdminJS's `rootPath` becomes the prefix automatically.

### Symptom: OpenAPI/Swagger lists ~100 `/admin/...` routes

**Cause:** `detail: { hide: true }` missing from the Elysia that wraps `adminRouter`.

**Fix:** `new Elysia({ detail: { hide: true } }).use(await buildRouter(admin, {}))`.

---

## Bundle / custom components

### Symptom: `GET /admin/frontend/assets/components.bundle.js` returns 404

**Causes:**
1. `.adminjs/` folder doesn't exist — AdminJS hasn't initialized (app crashed during startup).
2. Read-only filesystem blocks bundle write.

**Fix:**
- Check app logs for init errors.
- For read-only FS: mount `tmpfs` at `/app/.adminjs` or pre-compile during image build.

### Symptom: custom component renders blank

**Causes:**
1. React 19 installed (`bun pm ls react`) — AdminJS's bundle crashes with "Invalid hook call".
2. Missing `export default` in the TSX file.
3. Path passed to `componentLoader.add()` doesn't resolve from CWD.
4. Component imports server-only module (`drizzle-orm`, Node builtins).

**Fix:**
- Pin `react@18`.
- Ensure `export default MyComponent`.
- Use `path.join(import.meta.dir, "component-name")` instead of bare string.
- Move server-side data fetching to an action handler, not a component import.

### Symptom: custom component works in dev, blank in prod

**Cause:** path resolution differs because CWD differs between dev (`bun dev` from project root) and prod (container working dir).

**Fix:** `componentLoader.add("Name", path.join(import.meta.dir, "name"))` — always absolute via `import.meta.dir`.

### Symptom: richtext editor — can't add links

**Cause:** `@adminjs/design-system` ships a broken link command (`unsetLink` only).

**Fix:** run [templates/patch-adminjs-richtext.mjs](../templates/patch-adminjs-richtext.mjs) as a postinstall script.

### Symptom: richtext editor crashes with "Cannot read properties of undefined (reading 'schema')"

**Cause:** `@tiptap/extension-horizontal-rule` version mismatch with bundled tiptap core.

**Fix:** pin via `"overrides"` in package.json:

```json
{ "overrides": { "@tiptap/extension-horizontal-rule": "2.1.13" } }
```

### Symptom: dev works, but `bun build` / production bundle shows no components

**Cause:** `admin.watch()` is a no-op in production, and `.adminjs/bundle.js` wasn't pre-compiled.

**Fix:** pre-compile during image build (see [setup-and-bundling.md](setup-and-bundling.md) → Strategy A).

---

## Forms / records

### Symptom: JSON column edit silently corrupts data

**Cause:** adminjs-drizzle defaults JSON/JSONB columns to `type: "textarea"`, expecting valid JSON strings. Any typo (`{a:1}` vs `{"a":1}`) crashes on save but the form UX doesn't block it loudly.

**Fix:** always override:

```typescript
properties: {
    metadata: { type: "mixed" },
},
```

### Symptom: `record.params.myBoolean` is `"true"` instead of `true` in an action handler

**Cause:** AdminJS serializes record params through flat/JSON when transferring to the client, and some code paths stringify booleans.

**Fix:** normalize in every handler:

```typescript
const flag = record.params.my_boolean === true || record.params.my_boolean === "true";
```

Also note the **snake_case** — action handlers sometimes get the SQL column name, not the JS property name.

### Symptom: "Cannot read properties of undefined (reading 'id')" after clicking a custom action

**Cause:** handler didn't return `{ record: ctx.record.toJSON(ctx.currentAdmin) }`.

**Fix:** always end with:

```typescript
return {
    record: context.record.toJSON(context.currentAdmin),
    notice: { message: "OK", type: "success" as const },
};
```

### Symptom: dropdown for a foreign-key column is empty

**Cause:** the referenced table isn't registered as an AdminJS resource.

**Fix:** add `{ resource: { table: otherTable, db }, options: {} }` to the resources array.

### Symptom: sort is broken / throws on first page load

**Causes:**
1. `sortBy` column name in snake_case, but adapter expects JS (camelCase) property name.
2. Missing `before` hook setting default sort.

**Fix:** use camelCase in `sortBy`:

```typescript
options: {
    sort: { sortBy: "createdAt", direction: "desc" },
},
```

---

## Performance

### Symptom: list page slow for large tables

**Cause:** `BaseResource.count()` runs a `SELECT count(*)` on every page load — unindexed tables are slow.

**Fix:** index the filter columns. For very large tables, consider adding `options.listProperties` to limit column count (fewer columns = smaller result set + less work).

### Symptom: admin initial load takes 3+ seconds

**Cause:** `.adminjs/bundle.js` is being compiled on first request.

**Fix:** pre-compile (see [setup-and-bundling.md](setup-and-bundling.md)).

### Symptom: dev server rebuilds slowly on every TSX save

**Cause:** `admin.watch()` re-bundles the whole component tree.

**Fix:** extract hot-iteration UI to a non-AdminJS page while iterating; it's normal to see 500ms–2s rebundle on save.

---

## Infrastructure

### Symptom: Docker image crashes on first request with `Cannot find module 'node-mocks-http'`

**Cause:** missing peer dependency — Bun/pnpm don't auto-install peers.

**Fix:** `bun add node-mocks-http @elysiajs/jwt`.

### Symptom: app crashes with `Bun is not defined`

**Cause:** running `adminjs-elysia` under Node or Deno — `buildAssets` uses `Bun.file()`.

**Fix:** run under Bun, or fork `adminjs-elysia` to use `fs.createReadStream`.

### Symptom: `NODE_TLS_REJECT_UNAUTHORIZED=0` required but unsafe

**Cause:** internal S3 / Postgres with self-signed certs.

**Fix:** acceptable in dev; in prod add the CA to the container's trust store (`/etc/ssl/certs/`) instead of disabling validation globally.

---

## Database

### Symptom: `update` succeeds but UI shows old value

**Cause:** `after` hook returned stale `record`.

**Fix:** fetch the fresh record in the hook:

```typescript
const fresh = await db.select().from(itemsTable).where(eq(itemsTable.id, id));
response.record.params = { ...response.record.params, ...fresh[0] };
return response;
```

### Symptom: create/update throws `value too long for type character varying(N)`

**Cause:** form accepts strings unbounded; DB column has a VARCHAR cap.

**Fix:** add client-side max-length via `properties.<col>.props.maxLength`, and/or lift the VARCHAR cap in the schema.

### Symptom: `NOT NULL violation` on a column that has `default(...)` in Drizzle

**Cause:** the form submitted an empty string instead of omitting the field.

**Fix:** either mark the property `{ isRequired: false }` (doesn't propagate to DB) or add a `before` hook on `new` that strips empty strings.

---

## Type errors

### Symptom: `Type 'Resource' is not assignable to type 'ResourceWithOptions'` in `new AdminJS({ resources })`

**Cause:** `adminjs-drizzle`'s Resource type is over-generic; TS can't reconcile it with AdminJS's expected shape.

**Fix:** add `// @ts-expect-error` above the `resources:` line, or return `any[]` from `getResources`.

### Symptom: editor can't resolve `adminjs-drizzle/pg`

**Cause:** older TS `moduleResolution` ("node") doesn't understand subpath exports.

**Fix:** `tsconfig.json` → `"moduleResolution": "bundler"` (or `"node16"` / `"nodenext"`).

---

## How to debug

1. **Check the browser Network tab** for the failing request — response body usually has a helpful AdminJS error.
2. **Check the app logs** — most AdminJS errors log with stack traces.
3. **Run `node scripts/doctor.mjs`** from the user's project root — catches peer-dep / React / bundle issues.
4. **Grep `node_modules/`** for the exact error message — AdminJS source is readable and usually explains what's happening.
5. **Bisect by feature** — temporarily remove all `features: [uploadFileFeature(...)]` / custom actions / hooks to isolate which one breaks.

If none of that helps, open an issue on `adminjs-elysia` upstream with a minimal repro.
