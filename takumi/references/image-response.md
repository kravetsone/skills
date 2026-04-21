# ImageResponse

`ImageResponse` is the high-level API — it extends the Web `Response` class, so return it directly from any route handler that speaks the Fetch API (Next.js App Router, SvelteKit `+server.ts`, TanStack Start `server.handlers`, Cloudflare Workers, Bun.serve, Hono, Elysia).

```ts
import { ImageResponse } from "takumi-js/response";

return new ImageResponse(jsxElement, options);
```

Default output: 1200×630 PNG.

## Constructor

```ts
new ImageResponse(
  content: JSX.Element | string, // JSX or pre-rendered HTML string
  options?: ImageResponseOptions,
)
```

Common options:

| Option | Type | Default | Notes |
| ------ | ---- | ------- | ----- |
| `width` | `number` | `1200` | Output width in px. |
| `height` | `number` | `630` | Output height in px. Omit for content-driven auto-height. |
| `format` | `"png" \| "jpeg" \| "webp" \| "ico"` | `"png"` | Lowercase only in v1. For animation use `renderAnimation()` instead. |
| `fonts` | `Font[]` | `[]` | See [fonts](fonts.md). Each font: `{ name, data }` where `data` is `ArrayBuffer` or `() => Promise<ArrayBuffer>`. |
| `emoji` | `"twemoji" \| "from-font"` | none | `twemoji` matches `@vercel/og`. `from-font` uses a COLR emoji font loaded in `fonts`. |
| `persistentImages` | `ImageSource[]` | `[]` | Preload assets by key, referenced from `src="..."` or `background-image: url(...)`. |
| `stylesheets` | `string[]` | `[]` | Raw CSS (e.g. Tailwind-compiled `?inline`). Enables class-based styling. |
| `renderer` | `Renderer` | internal | Pass a reused `Renderer` instance for perf. Required in CF Workers. |
| `keyframes` | `Keyframes` | none | Animation definitions for `animate-[...]`; renders a single frame. Pair with `timeMs`. |
| `timeMs` | `number` | `0` | Timestamp along the animation time axis for this frame. |
| `drawDebugBorder` | `boolean` | `false` | Draws a border around every node. Debug-only. |
| `resourcesOptions` | `{ cache?: Map<string, ArrayBuffer> }` | — | Dedup fetches of external images across renders. |

## Minimal example

```tsx
import { ImageResponse } from "takumi-js/response";

export function GET() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0f172a",
        color: "white",
        fontSize: 72,
      }}
    >
      Hello Takumi
    </div>,
  );
}
```

## With fonts

```tsx
return new ImageResponse(<Og />, {
  width: 1200,
  height: 630,
  fonts: [
    {
      name: "Inter",
      data: () => fetch("https://example.com/fonts/inter.woff2").then((r) => r.arrayBuffer()),
    },
  ],
});
```

## With preloaded images + external-fetch cache

```tsx
const imageFetchCache = new Map<string, ArrayBuffer>();

return new ImageResponse(<Og />, {
  persistentImages: [
    { src: "logo", data: () => fetch("/logo.png").then((r) => r.arrayBuffer()) },
  ],
  resourcesOptions: { cache: imageFetchCache },
});
```

Reference `persistentImages` by their `src` key anywhere a URL is expected:

```tsx
<img src="logo" />
<div style={{ backgroundImage: "url(logo)" }} />
```

## With a compiled Tailwind stylesheet

```tsx
import stylesheet from "~/styles/global.css?inline";

return new ImageResponse(
  <div className="bg-slate-900 text-white flex items-center justify-center w-full h-full text-4xl">
    Hello Tailwind
  </div>,
  { width: 1200, height: 630, stylesheets: [stylesheet] },
);
```

## Reusing a Renderer instance (edge / CF Workers)

```ts
import { ImageResponse } from "takumi-js/response";
import { initSync, Renderer } from "takumi-js/wasm";
import wasmModule from "takumi-js/wasm/takumi_wasm_bg.wasm";
import interFont from "./inter.ttf";

initSync(wasmModule);
const renderer = new Renderer({ fonts: [interFont] });

export default {
  fetch(request) {
    return new ImageResponse(<Og />, { renderer, width: 1200, height: 630 });
  },
};
```

See [performance](performance.md) for why this matters.

## Animated output

`ImageResponse` is for a single frame. For animated GIF/WebP/APNG, use `renderer.renderAnimation({...})` from `takumi-js/node` or `takumi-js/wasm` — see [animation](animation.md).
