# Production bundling with `@adminjs/bundler`

AdminJS's default behavior is to **compile the custom-components bundle on server startup**. That:

- Delays the first request by 1–3 seconds while it bundles.
- Burns 200–500 MB of memory during bundling (can OOM small containers).
- Writes to `.adminjs/` on the filesystem (fails on read-only FS).
- Defeats immutable/stateless container deployments.

The correct fix is **`@adminjs/bundler`** — AdminJS's official standalone pre-bundler. You run it once in CI/CD, commit the output to your container image, and set `ADMIN_JS_SKIP_BUNDLE="true"` so the server serves the pre-built files without touching `.adminjs/` at all.

## Install

```bash
bun add -d @adminjs/bundler
```

It's a dev dependency — only used at build time.

## The critical env var

```bash
ADMIN_JS_SKIP_BUNDLE="true"
```

**Note: string, not boolean.** AdminJS does `process.env.ADMIN_JS_SKIP_BUNDLE === "true"`. Passing a boolean through your config loader that serializes as `"True"` or `"1"` **will not work** — the server will still try to bundle.

Set it in prod env. Do **not** set in dev — you want watch-mode rebuilds locally.

## The bundle script

Create `scripts/bundle.ts` (one-time pre-bundle that drops output into `public/admin-assets/`):

```typescript
// scripts/bundle.ts
import { bundle } from "@adminjs/bundler";
import { componentLoader } from "../src/admin";

await bundle({
    destinationDir: "public/admin-assets",
    componentLoader,
    // Optional — enable versioned file names like `app.bundle.abc123.js`
    versioning: {
        manifestPath: "public/admin-assets/manifest.json",
    },
});

console.log("✓ AdminJS bundle written to public/admin-assets/");
```

For this to work, `src/admin/index.ts` must **export** `componentLoader`:

```typescript
// src/admin/index.ts
export const componentLoader = new ComponentLoader();
// ... componentLoader.add(...) calls ...
```

Then wire `assets.coreScripts` in your `AdminJS` config to read from the manifest:

```typescript
import manifest from "../public/admin-assets/manifest.json" with { type: "json" };

const admin = new AdminJS({
    rootPath: "/admin",
    componentLoader,
    assets: {
        coreScripts: [
            { src: `/admin-assets/${manifest.entry}`, cors: true },
            { src: `/admin-assets/${manifest.bundle}`, cors: true },
            { src: `/admin-assets/${manifest.designSystemBundle}`, cors: true },
            { src: `/admin-assets/${manifest.components}`, cors: true },
        ],
    },
    // ... rest of config
});
```

And serve the `public/admin-assets` folder:

```typescript
import { staticPlugin } from "@elysiajs/static";

new Elysia()
    .use(staticPlugin({ assets: "public/admin-assets", prefix: "/admin-assets" }))
    .use(adminRouter);
```

Full template: [templates/bundle.ts](../templates/bundle.ts).

## Without versioning — minimum viable

If you don't need CDN cache-busting, skip `versioning`:

```typescript
await bundle({
    destinationDir: "public/admin-assets",
    componentLoader,
});
```

AdminJS will serve `bundle.js` / `entry.js` / `components.bundle.js` with fixed names. Set them in `assets.coreScripts` statically. Simple, but cache invalidation is manual.

## Docker integration (the golden path)

```dockerfile
FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .

# Pre-bundle AdminJS — zero server-side bundling in prod
RUN bun run scripts/bundle.ts
RUN test -f public/admin-assets/manifest.json  # fail build if bundle missing

FROM oven/bun:1-alpine
WORKDIR /app
COPY --from=build /app /app

ENV NODE_ENV=production
ENV ADMIN_JS_SKIP_BUNDLE=true

CMD ["bun", "./src/index.ts"]
```

Add a `package.json` script:

```json
{
    "scripts": {
        "bundle:admin": "bun run scripts/bundle.ts"
    }
}
```

CI/CD runs `bun run bundle:admin` as part of the build step. The generated `public/admin-assets/` ends up in the image. The server starts instantly.

## Read-only filesystems

Because `ADMIN_JS_SKIP_BUNDLE=true` prevents any writes to `.adminjs/` at runtime, you can run the container with `readOnlyRootFilesystem: true` (Kubernetes) or `--read-only` (Docker) safely. No tmpfs mount needed for `.adminjs/`.

## Asset versioning — cache-busting on CDN

With `versioning` enabled, the bundle writes files like:

```
public/admin-assets/
├── manifest.json
├── entry.<hash>.js
├── bundle.<hash>.js
├── components.bundle.<hash>.js
└── design-system.bundle.<hash>.js
```

`manifest.json`:

```json
{
    "entry": "entry.abc123.js",
    "bundle": "bundle.def456.js",
    "components": "components.bundle.ghi789.js",
    "designSystemBundle": "design-system.bundle.jkl012.js"
}
```

Wire it into AdminJS's `assets.coreScripts` as shown above. When you rebuild, hashes change, browsers re-fetch — no stale caches.

Serve with long cache headers:

```typescript
staticPlugin({
    assets: "public/admin-assets",
    prefix: "/admin-assets",
    headers: { "Cache-Control": "public, max-age=31536000, immutable" },
});
```

## What `@adminjs/bundler` actually does

Source-verified from `node_modules/@adminjs/bundler/dist/bundle.js`:

1. Calls `adminJS.initialize()` with `ADMIN_JS_SKIP_BUNDLE="false"` temporarily forced. This triggers the same internal bundling AdminJS does on startup.
2. Copies the generated `.adminjs/` files to your `destinationDir`.
3. Copies `node_modules/adminjs/lib/frontend/assets/scripts/` (AdminJS's own scripts).
4. Copies `node_modules/@adminjs/design-system/bundle.*.js`.
5. If `versioning` is set: hashes each file, writes a manifest JSON, renames files.

You can override paths (`adminJsAssetsDir`, `designSystemDir`) but rarely need to.

## Development — don't use the bundler

In dev, keep the default behavior:
- `ADMIN_JS_SKIP_BUNDLE` **unset** (or `"false"`).
- `admin.watch()` rebuilds `.adminjs/` on TSX save.
- Fast iteration, no manual re-bundle step.

The bundler is strictly a production/CI tool.

## Troubleshooting

### `Cannot find module './public/admin-assets/...'`

- Bundle hasn't been run — `bun run scripts/bundle.ts` first.
- Check `destinationDir` in the script matches `assets.coreScripts` paths.

### Server still bundles on startup despite `ADMIN_JS_SKIP_BUNDLE=true`

- Check spelling and string quotes: `"true"` (lowercase) as a string, not `true` as a boolean.
- Check that `assets.coreScripts` actually points somewhere — if missing, AdminJS may fall back to its internal bundler even with the skip flag.

### Bundle out of date after deploy

- Missing CI step — add `bun run bundle:admin` to the build pipeline, before building the image.
- With versioning: hashes changed but browser cached the old `index.html`? Browsers re-parse `assets.coreScripts` on every page load, so stale hashes are rare — but a CDN with aggressive HTML caching can serve a stale AdminJS page. Set `Cache-Control: no-store` on `/admin` itself.

### "OOM during `bun run scripts/bundle.ts`"

- The bundler needs 200–500 MB. In a 256 MB CI runner: increase memory, or run outside of strict containers.
- `NODE_OPTIONS="--max-old-space-size=1024"` helps on Node runtimes.

## Trade-offs — when NOT to use the bundler

- **Single-instance low-traffic admin** — the cold-start cost doesn't matter, skip the bundler and save the build-step complexity.
- **Frequently changing custom components during prod hotfix** — you'd have to rebuild + redeploy for every TSX tweak. Dev-mode bundling is more flexible.
- **You haven't changed any custom components** — stock AdminJS with no custom components doesn't need `@adminjs/bundler` since there's nothing to bundle.

For anything else (multi-replica prod, slow cold-start unacceptable, read-only FS, OOM-prone instances), **always pre-bundle**.
