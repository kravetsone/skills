# Troubleshooting

## Layout is wrong / elements collapse

- **First check: `display: "flex"` is set.** In v1 the default is `inline`. See [layout-engine](layout-engine.md#display-defaults-v1-gotcha).
- Turn on node debug borders:
  ```tsx
  new ImageResponse(<Og />, {
    width: 100,
    height: 100,
    drawDebugBorder: true,
  });
  ```
- Check the supported CSS surface — pseudo-elements, `position: sticky`, 3D transforms, and JS-driven styling are not implemented.
- If it still looks off, file an issue: https://github.com/kane50613/takumi/issues

## `Error: Cannot find native binding`

The platform-specific `@takumi-rs/core-*` optional dep isn't hoisted. In virtual-store package managers (pnpm, classic yarn) add to `.npmrc`:

```ini
public-hoist-pattern[]=@takumi-rs/core-*
```

Then reinstall.

Also confirm `serverExternalPackages: ["@takumi-rs/core"]` is set in `next.config.ts` for Next.js projects — otherwise the bundler tries to inline the native binary.

## `TypeError: fetch failed` in Node.js

Node's built-in fetch (undici) can be flaky for external image fetches (tracked in [#349](https://github.com/kane50613/takumi/issues/349)). Workarounds:

- Run on [Bun](https://bun.sh) (fetch is more stable).
- Preload images via `persistentImages` and avoid per-request fetches (see [images](images.md)).
- Wrap external fetches in a retry loop before passing the buffer to `persistentImages.data`.

## Text renders as tofu / empty boxes

The glyphs aren't in any loaded font. Either:

- The embedded default font doesn't cover the script (Geist / Manrope = Latin+Cyrillic-ish only — not CJK/Arabic/Hindi).
- You passed the font via `fonts` but the `fontFamily` in your styles doesn't match the `name`.

Fix: pass an explicit `fonts` entry covering the script, and set `fontFamily` to match its `name` exactly.

## Image `src` 404s silently

External images that fail to fetch render as empty space. To debug:

- Log fetch failures yourself — pre-walk with `extractResourceUrls` + `fetchResources` (see [rendering-apis](rendering-apis.md#extractresourceurls--fetchresources)).
- Prefer `persistentImages` for anything under your control; it errors early at preload.
- Provide explicit `width`/`height` on `<img>` so layout stays correct even when the fetch fails.

## `serverExternalPackages` not recognized

If you're on an older Next.js (< 15) it was named `experimental.serverComponentsExternalPackages`:

```ts
const config: NextConfig = {
  experimental: { serverComponentsExternalPackages: ["@takumi-rs/core"] },
};
```

Upgrade to Next 15+ and move it to top-level `serverExternalPackages`.

## `ImageResponse` returns blank output

- Did you set `width` and `height`? Default is 1200×630 but if you override one to a tiny value, the other dimension may collapse.
- Is the root element styled to fill the viewport? `width: "100%"; height: "100%"; display: "flex"` on the top-level `<div>`.
- Check that fonts load successfully — if they throw asynchronously they can produce a blank render with no visible error.

## Tailwind classes have no effect

- If you're using compiled stylesheets: confirm the import is `?inline` and that you passed the string to `stylesheets: [stylesheet]`.
- If you're using the native parser: use the `tw` prop, not `className` (the native parser only reads `tw`).
- Remember the priority: inline `style` > `tw` > stylesheet selector > preset.

## CF Workers: slow cold starts

- Initialize the WASM module and `Renderer` outside `fetch()` (see [performance](performance.md#cloudflare-workers-pattern)).
- Prefer TTF over WOFF2 so there's no decompression on first request.
- Bundle fonts as binary assets rather than fetching them from R2/KV on first hit.

## Migrating from v0 and surprises

See [upgrade-v0-v1](upgrade-v0-v1.md). Most common: `display` default changed, `ImageResponse` import moved, `putPersistentImage` now takes an `ImageSource` object.
