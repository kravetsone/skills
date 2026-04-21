# Fonts

## Rule 1: No system fonts

Takumi does **not** read system fonts. Every font beyond the embedded defaults must be supplied explicitly.

## Embedded defaults

| Binding | Embedded fonts |
| ------- | -------------- |
| `@takumi-rs/core` (Node/Bun) | **Geist** + **Geist Mono** (full variable axis) |
| `@takumi-rs/wasm` (edge/browser) | **Manrope** only (single variable Latin font) |

If your text uses CJK / Arabic / Cyrillic / any other script, or you want a monospace family on edge, you must bundle it yourself.

## Loading fonts

Pass an array to the `fonts` option of `ImageResponse` (or the `Renderer` constructor):

```tsx
import { ImageResponse } from "takumi-js/response";
import type { Font } from "takumi-js";

export function GET() {
  return new ImageResponse(<div>Hello</div>, {
    fonts: [
      {
        name: "Inter",
        data: () => fetch("/fonts/inter.woff2").then((r) => r.arrayBuffer()),
      },
    ],
  });
}
```

`data` accepts:

- An `ArrayBuffer` directly (best — load at module scope).
- A `() => Promise<ArrayBuffer>` factory (lazy — called once per renderer).

**Hot-path tip:** import the font file as a buffer at module load. Don't `fetch(...)` inside a per-request handler:

```ts
import inter from "./inter.ttf" with { type: "bytes" }; // Bun
// or use your bundler's file loader to emit an ArrayBuffer import

const renderer = new Renderer({ fonts: [inter] });
```

## Variable fonts

For variable fonts, `font-weight` maps to the `wght` axis automatically. Control any axis via `font-variation-settings`, and OpenType features via `font-feature-settings`:

```tsx
<div
  style={{
    fontFamily: "Manrope",
    fontVariationSettings: "'wght' 700, 'wdth' 150",
    fontFeatureSettings: "'ss01'",
  }}
>
  Variable Font Text
</div>
```

## Emoji

Two supported strategies, controlled by the `emoji` option on `ImageResponse`:

### `emoji: "twemoji"` — dynamic fetch (matches `@vercel/og`)

```tsx
return new ImageResponse(<div>Hello 👋😁</div>, {
  emoji: "twemoji",
});
```

Under the hood it calls `extractEmojis(node, "twemoji")` which separates emoji segments from text and inserts image nodes fetched from the Twemoji CDN. For manual control:

```tsx
import { extractEmojis } from "takumi-js/helpers/emoji";
import { fromJsx } from "takumi-js/helpers/jsx";
import { extractResourceUrls, fetchResources } from "takumi-js/helpers";
import { Renderer } from "takumi-js/node";

let { node } = await fromJsx(<div>Hello 👋😁</div>);
node = extractEmojis(node, "twemoji");

const urls = extractResourceUrls(node);
const fetchedResources = await fetchResources(urls);

const renderer = new Renderer();
const image = await renderer.render(node, { fetchedResources });
```

### `emoji: "from-font"` — bundled COLR emoji font

Offline-safe, faster, and typically smaller than fetching PNGs per emoji:

```tsx
import notoEmoji from "@fontsource/noto-color-emoji/files/noto-color-emoji-emoji-400-normal.woff2";

return new ImageResponse(<div>Hello 😀</div>, {
  emoji: "from-font",
  fonts: [{ name: "Noto Color Emoji", data: notoEmoji }],
});
```

Takumi supports the COLR font format natively — typical COLR emoji fonts (Twemoji-COLR, Noto Color Emoji) are much smaller than rasterized alternatives.

## RTL and bidirectional text

Right-to-left scripts (Arabic, Hebrew) are handled automatically by Parley. There is no manual `direction` override yet (tracked in [issue #330](https://github.com/kane50613/takumi/issues/330)).

## `text-overflow: ellipsis` + `line-clamp`

Takumi respects `line-clamp` with ellipsis without requiring `white-space: nowrap`, so multi-line truncation works:

```tsx
<div style={{ textOverflow: "ellipsis", lineClamp: 3 }}>
  Super Long Text that will truncate after three lines...
</div>
```

## Text wrapping

Both `balance` and `pretty` wrap modes are supported (algorithm adapted from Satori's implementation):

```tsx
<div style={{ textWrap: "balance" }}>Headline that wraps nicely</div>
```

## Performance

- **Prefer TTF over WOFF2** in production. WOFF2 is compressed and must be decompressed before use; TTF is ready to use. Only prefer WOFF2 if bundle size matters more than render latency. (See [performance](performance.md#fonts).)
- Load font data **once at module scope**, not per-request.
