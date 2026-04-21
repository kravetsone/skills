# Upgrade v0 → v1

Install the v1 line:

```bash
npm i takumi-js@1
```

v1 locks down the public API with backward-compat guarantees across all `1.x`.

## `display` defaults to `inline` (breaking)

v0 defaulted `display` to `flex` to simplify common layouts. v1 matches the CSS spec: the default is `inline`.

**Action:** audit every container that relies on flex/grid layout and add `display: "flex"` (or `flex`/`grid` Tailwind class) explicitly:

```tsx
<div
  style={{
    display: "flex",              // ← required in v1
    alignItems: "center",
    justifyContent: "center",
  }}
>
  {children}
</div>
```

The change was made so LLMs (and humans) produce spec-correct components without guessing.

## Unified runtime entrypoint

v0 required choosing between NAPI and WASM imports manually. v1 ships a single `takumi-js` entrypoint that auto-detects the environment.

```ts
import { ImageResponse } from "@takumi-rs/image-response"; // ❌ v0
import { ImageResponse } from "takumi-js/response";        // ✅ v1
```

Similarly:
- `takumi-js/node` — explicit Node/Bun `Renderer`.
- `takumi-js/wasm` — explicit edge/browser `Renderer`.
- `takumi-js/helpers/jsx` — `fromJsx`.
- `takumi-js/helpers/emoji` — `extractEmojis`.

## `emoji` option for dynamic emojis

v1 adds the `emoji` option to `ImageResponse`, matching `@vercel/og` compatibility:

```tsx
new ImageResponse(<div>Hi 😀</div>, {
  emoji: "twemoji",           // fetch from Twemoji CDN (satori-compatible)
  // or
  emoji: "from-font",         // use a COLR emoji font loaded via `fonts`
});
```

See [fonts](fonts.md#emoji).

## Lowercase image format strings

Every `format` value is lowercase now:

```ts
const image = await renderer.render(node, {
  format: "WebP",   // ❌ v0
  format: "webp",   // ✅ v1
});
```

Affects `"png"`, `"jpeg"`, `"webp"`, `"ico"`, `"gif"`, `"apng"`, `"raw"`.

## `putPersistentImage()` takes `ImageSource`

v0 accepted `(key, buffer)`. v1 takes `({ src, data })`:

```ts
const data = await readFile("foo.png");

await renderer.putPersistentImage("foo.png", data);        // ❌ v0
await renderer.putPersistentImage({ src: "foo.png", data }); // ✅ v1
```

## Deprecated exports removed from `@takumi-rs/core`

Anything marked `@deprecated` in v0 is gone. Update to the non-deprecated alternative before upgrading.

## Rust-side changes (skip if JS-only)

- `RenderOptions::builder()` replaces `RenderOptionsBuilder` (typed-builder, compile-time validation, no `.unwrap()`).
- `FetchTaskCollection` removed — use `Node::resource_urls` / `Style::resource_urls`.
- `parse_svg_str` removed — use `SvgSource::from_str`.
- `SpacePair::from_reversed_pair` removed — construct `SpacePair` directly with values in correct order.
- `TakumiError` type alias removed — use `takumi::error::Error`.
- `Viewport` no longer implements `From<(u32, u32)>` — use `Viewport::new((w, h))`.
- `ImageSource::size()` is now private.
- `detailed_css_error` Cargo feature removed (detailed errors are always on now).

## Migration checklist

- [ ] Every layout container has explicit `display: "flex"` / `"grid"`.
- [ ] All imports point at `takumi-js/*`, not `@takumi-rs/image-response` or `@takumi-rs/core` directly.
- [ ] `format` strings are lowercase.
- [ ] `putPersistentImage` calls pass `{ src, data }` objects.
- [ ] If needed, `emoji: "twemoji"` added for parity with a previous `@vercel/og` setup.
- [ ] No imports of deprecated APIs (`@takumi-rs/core` purged them).
