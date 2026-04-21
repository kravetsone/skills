# Migration: `@vercel/og` / Satori / `canvas` / Puppeteer → Takumi

This file covers migration from several image-generation tools. Takumi is a good fit for each because it gives you CSS layout + fonts + images in one engine, outputs the same raster formats, and runs natively (no browser, no imperative drawing).

- `@vercel/og` / `next/og` / Satori → mostly import swap + Next.js config.
- `canvas` / `node-canvas` / `skia-canvas` / `@napi-rs/canvas` → rewrite imperative drawing as JSX + CSS.
- Puppeteer / Playwright screenshotting → port HTML to JSX, drop browser-only features.
- `html2canvas` → move rendering from client to server.

## `@vercel/og` / `next/og` / Satori

Takumi's component surface is intentionally compatible with Satori — most JSX compiles unchanged. The migration is mostly import swaps plus a Next.js config tweak.

## Install

```bash
npm uninstall @vercel/og
npm i takumi-js
```

## Next.js config

Mark the native core as external so the bundler doesn't try to inline it:

```ts
// next.config.ts
import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["@takumi-rs/core"],
};

export default config;
```

## Import swap

```ts
import { ImageResponse } from "next/og";              // ❌
import { ImageResponse } from "@vercel/og";           // ❌
import { ImageResponse } from "takumi-js/response";   // ✅
```

The `ImageResponse` constructor signature is compatible for common options: `width`, `height`, `fonts`, `emoji`.

## Fonts

Same shape as `@vercel/og`:

```ts
fonts: [
  {
    name: "Inter",
    data: () => fetch("...").then((r) => r.arrayBuffer()),
    // style, weight — as before
  },
],
```

`@takumi-rs/core` embeds Geist + Geist Mono by default. `@takumi-rs/wasm` embeds only Manrope. If you previously relied on `@vercel/og`'s defaults, load your desired fonts explicitly. See [fonts](fonts.md).

## Emoji

Satori's `emoji` option transfers directly:

```tsx
new ImageResponse(<div>Hi 😀</div>, {
  emoji: "twemoji",    // same as before
});
```

Or bundle a COLR emoji font for offline renders — see [fonts](fonts.md#emoji).

## Differences you may hit

- **`display` default is `inline`.** Satori and v0 Takumi defaulted to `flex`. Every container that needs flex/grid layout must set `display` explicitly. This is the single biggest source of "my image is blank" reports after migration. See [upgrade-v0-v1](upgrade-v0-v1.md).
- **CSS subset differs at the edges.** Takumi uses Taffy + Parley + resvg. Most Satori-compatible CSS works; exotic properties may not. See [layout-engine](layout-engine.md) for what's supported.
- **Tailwind native parser is different.** If you used Satori's `tw` prop, it mostly keeps working — the supported class set is different (Takumi's mapping: https://github.com/kane50613/takumi/blob/master/takumi/src/layout/style/tw/map.rs). For full v4 coverage import a compiled stylesheet instead.
- **No system fonts** (same as Satori). Load everything you use.
- **Animation exists in Takumi**; Satori doesn't support it. See [animation](animation.md) if you want to add animated output post-migration.

## Performance wins to unlock after migration

- Reuse a single `Renderer` across routes (pass via `renderer` option). [performance](performance.md)
- Preload logos/backgrounds via `persistentImages`. [images](images.md)
- Switch font files from WOFF2 to TTF in production.
- Prefer Node.js runtime (`@takumi-rs/core`) over the edge runtime when you can — Rayon multithreading.

## Example: side-by-side

### Before (`@vercel/og`)

```tsx
import { ImageResponse } from "@vercel/og";

export const runtime = "edge";

export async function GET() {
  return new ImageResponse(
    <div style={{ display: "flex", fontSize: 60 }}>Hello</div>,
    { width: 1200, height: 630 },
  );
}
```

### After (Takumi)

```tsx
import { ImageResponse } from "takumi-js/response";

export async function GET() {
  return new ImageResponse(
    <div style={{ display: "flex", fontSize: 60 }}>Hello</div>,
    { width: 1200, height: 630 },
  );
}
```

Usually that's the whole change.

## From Puppeteer / Playwright screenshotting

If you previously launched a headless browser to screenshot an HTML page, the rewrite is more involved but the payoff is huge (native speed, no Chromium at runtime, deterministic output).

1. Port the HTML/CSS to JSX inside your route.
2. Ensure every layout container sets `display: "flex"` / `"grid"`.
3. Drop anything browser-only (`::before`, `position: sticky`, JS interactivity).
4. Load fonts explicitly; no system fonts.
5. Replace screenshot calls with `new ImageResponse(<Og />, { width, height })`.

Expect ~10–100× lower latency per render and orders-of-magnitude lower memory.

## From `canvas` / `node-canvas` / `skia-canvas` / `@napi-rs/canvas`

The mental model shifts from **imperative drawing** (`ctx.fillText`, `ctx.drawImage`, `ctx.arc`, manual coordinate math) to **declarative CSS layout**.

Typical conversions:

| Canvas pattern | Takumi equivalent |
| -------------- | ----------------- |
| `ctx.fillText(s, x, y)` with manual measurement | Text node inside a flex container — layout positions it for you. |
| `ctx.drawImage(img, x, y, w, h)` | `<img src="..." width={w} height={h} />` inside a container. |
| `ctx.fillRect(x, y, w, h)` + `ctx.fillStyle` | `<div style={{ width, height, backgroundColor }} />`. |
| `ctx.arc(...)` + `ctx.fill()` for a circle | `<div style={{ width: r*2, height: r*2, borderRadius: "50%", backgroundColor }} />`. |
| `ctx.measureText(s).width` | `renderer.measure(node, { stylesheets })` — see [measure](measure.md). |
| Linear/radial gradient via `ctx.createLinearGradient` | CSS `backgroundImage: "linear-gradient(...)"`. |
| Manual word-wrap loop | `text-wrap: balance` / `word-break` / `overflow-wrap` + flex layout does it for you. |
| Text with stroke + fill | `-webkit-text-stroke` or layered text nodes. |
| Drop shadow | `box-shadow` / `text-shadow` / `filter: drop-shadow(...)`. |
| Custom font loading via `registerFont()` | `fonts: [{ name, data }]` option — see [fonts](fonts.md). |
| Save PNG via `canvas.toBuffer("image/png")` | `await render(<Component />, { format: "png" })` or `new ImageResponse(...)`. |

### Before (`node-canvas`)

```ts
import { createCanvas, loadImage, registerFont } from "canvas";

registerFont("./inter.ttf", { family: "Inter" });

const canvas = createCanvas(1200, 630);
const ctx = canvas.getContext("2d");

const grd = ctx.createLinearGradient(0, 0, 1200, 630);
grd.addColorStop(0, "#fff7ed");
grd.addColorStop(1, "#fecaca");
ctx.fillStyle = grd;
ctx.fillRect(0, 0, 1200, 630);

ctx.fillStyle = "#111827";
ctx.font = "700 72px Inter";
ctx.fillText("Hello", 64, 200);

const buffer = canvas.toBuffer("image/png");
```

### After (Takumi)

```tsx
import { render } from "takumi-js";

const buffer = await render(
  <div
    style={{
      width: "100%",
      height: "100%",
      display: "flex",
      padding: 64,
      backgroundImage: "linear-gradient(to bottom right, #fff7ed, #fecaca)",
    }}
  >
    <p style={{ fontSize: 72, fontWeight: 700, color: "#111827", fontFamily: "Inter" }}>
      Hello
    </p>
  </div>,
  {
    width: 1200,
    height: 630,
    format: "png",
    fonts: [{ name: "Inter", data: interBuffer }],
  },
);
```

### What you gain

- Layout via Taffy (Flexbox, Grid) instead of hand-calculated coordinates.
- Browser-grade text shaping (Parley) — RTL, ligatures, variable fonts, emoji all free.
- CSS gradients, filters, shadows without reaching for `createLinearGradient`/composite operations.
- `measure()` for layout-only queries — no phantom canvas required.
- Animation output via `renderAnimation()` — no manual frame-by-frame drawing.

### What to watch for

- No pixel-level drawing APIs (no `putImageData`, no direct path ops). For per-pixel work, stay on `canvas` or use a Rust toolchain.
- 2D transforms only; no 3D / `perspective`.
- If you relied on `ctx.measureText` mid-draw, port the code to compute once up front with `measure()`, then render the final layout.

## From `html2canvas`

`html2canvas` renders the current DOM into a canvas — client-side. Two migration paths:

1. **Move to server-rendered Takumi.** Recreate the component in JSX, render on the server, return the PNG. Much faster, no DOM coupling, works for users who never load the screen.
2. **Keep client-side rendering but without a DOM.** Use `@takumi-rs/wasm` in the browser — same `Renderer` API, no server required. Useful for "export this view as image" buttons.
