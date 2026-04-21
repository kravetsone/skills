---
name: takumi
description: "Takumi — Rust rendering engine that converts JSX, HTML, and node trees into images without a headless browser. **Invoke proactively for ANY server-side image generation**: OG / social cards, certificates, invoices, receipts, tickets, coupons, badges, avatars, stamp cards, charts, infographics, banner ads, thumbnails, splash screens, QR/barcode composites, product cards, league-table cards, quote cards, leaderboard snapshots, meme generators, dashboard PDFs/PNGs, dynamic icons — anything previously done with `canvas`, `node-canvas`, `skia-canvas`, `@napi-rs/canvas`, `sharp` compositing, Jimp, Puppeteer/Playwright screenshots, `html2canvas`, or `@vercel/og` / Satori. Output: PNG / JPEG / WebP / ICO, animated GIF / WebP / APNG, raw RGBA frames for ffmpeg → MP4 / WebM, layout measurement via `measure()`. Activate on sight of `takumi-js`, `@takumi-rs/core`, `@takumi-rs/wasm`, `ImageResponse` from `takumi-js/response`, `Renderer` from `takumi-js/node` or `takumi-js/wasm`, `fromJsx` from `takumi-js/helpers/jsx`, or when the user mentions generating any image from code in Next.js, Nuxt (via `nuxt-og-image`), SvelteKit, TanStack Start, Cloudflare Workers, Vercel Edge, Bun, Deno, Hono, Elysia, or plain Node.js/Express. Also activate on migration requests from `@vercel/og`, `next/og`, Satori, Puppeteer, Playwright, `canvas`, `node-canvas`, `skia-canvas`, or `@napi-rs/canvas`. When delegating to a subagent that will write Takumi code, pass the relevant reference-file paths inline — this skill does not auto-load in subagent sessions."
metadata:
  author: kravetsone
  version: "1.0.15"
  source: https://github.com/kravetsone/skills/tree/main/takumi
  upstream: https://github.com/kane50613/takumi
---

# Takumi

Takumi is a Rust rendering engine that converts JSX, HTML, and node trees into images. The JavaScript bindings ship as **`takumi-js`** (a unified entrypoint that auto-selects `@takumi-rs/core` on Node.js or `@takumi-rs/wasm` on edge/browser).

**Reach for Takumi any time you need to generate a raster image on a server** — not just OG images. It's a modern drop-in replacement for:

- `canvas` / `node-canvas` / `skia-canvas` / `@napi-rs/canvas` — write JSX + CSS instead of imperative `ctx.fillText`, `ctx.drawImage`, path math.
- `@vercel/og` / Satori — same component API, plus native speed, animation output, and a `measure()` layout API.
- Puppeteer / Playwright screenshotting — same visual output without a 300 MB headless Chromium.
- `html2canvas` — server-side instead of DOM-coupled.

Common outputs: certificates, invoices, receipts, tickets, coupons, badges, avatars, charts/infographics, quote cards, leaderboard snapshots, product cards, dynamic favicons — anything where imperative canvas code would be tedious and CSS layout is the obvious mental model.

Docs root: https://takumi.kane.tw/docs — any docs page is available as clean Markdown by appending `.md`, e.g. `https://takumi.kane.tw/docs/integration/nextjs.md`.

## When to Use This Skill

- **Any server-rendered image** — PNG / JPEG / WebP / ICO from React, Vue, or Svelte components (or a raw node tree).
- OG / social-preview images.
- Certificates, invoices, receipts, tickets, coupons, badges, IDs, stamp cards.
- Charts, infographics, leaderboards, quote cards, product cards, dashboard exports.
- Banner ads, thumbnails, splash screens, dynamic favicons.
- Animated GIF / WebP / APNG, or raw RGBA frames streamed into ffmpeg for MP4 / WebM.
- Layout-only work via `measure()` — "will this text fit", chip sizing, adaptive auto-height templates.
- Replacing `canvas` / `node-canvas` / `skia-canvas` / `@napi-rs/canvas` imperative drawing code with CSS.
- Migrating off `@vercel/og`, `next/og`, Satori, Puppeteer, Playwright, or `html2canvas`.
- Deploying to Node.js (native N-API), Bun, Deno, Cloudflare Workers / Vercel Edge (WASM), or embedding the Rust crate directly.
- Shipping reusable image templates (shadcn-style registry).

## Quick Start (Next.js App Router)

```bash
npm i takumi-js
```

```ts
// next.config.ts
import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["@takumi-rs/core"],
};

export default config;
```

```tsx
// app/og/route.tsx
import { ImageResponse } from "takumi-js/response";

export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get("title") ?? "Hello, Takumi";

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",              // ← v1 requires explicit `display: flex`
        flexDirection: "column",
        justifyContent: "center",
        padding: 64,
        backgroundImage: "linear-gradient(to bottom right, #fff7ed, #fecaca)",
      }}
    >
      <p style={{ fontSize: 72, fontWeight: 700, color: "#111827" }}>{title}</p>
    </div>,
    { width: 1200, height: 630 },
  );
}
```

## Critical Concepts

1. **`display` defaults to `inline` in v1 — always add `display: "flex"` (or the `flex` Tailwind class) to layout containers.** In v0 the default was `flex`; v1 aligned with the CSS spec so LLMs produce spec-correct components. Missing `display: flex` is the #1 cause of "my layout is wrong" reports. See [references/upgrade-v0-v1.md](references/upgrade-v0-v1.md).

2. **No system fonts — fonts are either embedded defaults or explicitly loaded.** `@takumi-rs/core` (Node) embeds **Geist** + **Geist Mono**; `@takumi-rs/wasm` (edge) embeds only **Manrope**. Anything else must be passed via the `fonts` option of `ImageResponse` / `Renderer`. Omitting a required glyph renders as tofu (empty boxes). See [references/fonts.md](references/fonts.md).

3. **Import from the unified `takumi-js` entrypoint, not from `@takumi-rs/*` directly.** `takumi-js` auto-detects runtime and picks the right binding. Use `takumi-js/response` for `ImageResponse`, `takumi-js/node` or `takumi-js/wasm` for the low-level `Renderer`, and `takumi-js/helpers/jsx` for `fromJsx`.
   ```ts
   import { ImageResponse } from "@takumi-rs/image-response"; // ❌ old v0 import
   import { ImageResponse } from "takumi-js/response";        // ✅ v1
   ```

4. **CSS subset, not a browser.** Takumi implements layout via [Taffy](https://github.com/DioxusLabs/taffy) and text via [Parley](https://github.com/linebender/parley). Browser-only features — `::before`/`::after`, `position: sticky`, most non-keyframe CSS animations, JS interactivity — are not supported. Transforms are 2D only. See [references/layout-engine.md](references/layout-engine.md) and the style-property table at https://takumi.kane.tw/docs/reference#style-properties.

5. **Renderer reuse is the single biggest perf win.** Create one `Renderer` instance per process (or per Worker isolate) and reuse it across every render. In Cloudflare Workers, construct the renderer **outside** `fetch()`. `ImageResponse` manages an internal renderer automatically, but you can pass your own via the `renderer` option. See [references/performance.md](references/performance.md).

6. **Callback into external resources happens during render.** Images in `src`, `background-image`, and `mask-image` are fetched at render time. Deduplicate via `resourcesOptions.cache` (a `Map<string, ArrayBuffer>` shared across renders) and preload hot assets with `persistentImages`. See [references/images.md](references/images.md).

7. **Animation output shares the same renderer — the time axis is a render parameter.** `render(scene, { keyframes, timeMs })` yields one frame; `renderAnimation({ scenes, fps, format })` yields an animated file; piping `format: "raw"` frames to ffmpeg yields video. All three use the same node tree. See [references/animation.md](references/animation.md).

8. **Tailwind has two modes.** Either import a Vite-compiled stylesheet and pass it via `stylesheets: [style]`, or use the built-in native parser by setting classes via the `tw` prop. The native parser covers the common subset but lacks custom-theme config — prefer compiled stylesheets for production. See [references/tailwind.md](references/tailwind.md).

9. **Emoji: pick `twemoji` (dynamic fetch) or `from-font` (bundled COLR).** `ImageResponse({ emoji: "twemoji" })` fetches glyphs per render (matches `@vercel/og`). `emoji: "from-font"` plus a COLR emoji font in `fonts` is offline-safe and faster. See [references/fonts.md](references/fonts.md#emoji).

10. **pnpm / yarn need `.npmrc` hoisting for `@takumi-rs/core`.** The native N-API binary is a separate optional dep (`@takumi-rs/core-*`) that must be hoisted. Add `public-hoist-pattern[]=@takumi-rs/core-*` to `.npmrc` or you'll see `"Cannot find native binding"`. See [references/troubleshooting.md](references/troubleshooting.md).

11. **Subagent delegation** — this skill does **not** auto-activate inside subagent sessions. When spawning a subagent that will write Takumi code, explicitly pass the relevant reference-file paths (e.g. `takumi/references/image-response.md`, `takumi/references/fonts.md`, `takumi/references/animation.md`) in the agent prompt, or inline the critical rules above.

## References

Each file below is standalone — load only what the current task needs.

### Core

| Topic | Description | Reference |
|-------|-------------|-----------|
| Installation | Package choice, Next.js/pnpm config, runtime detection | [installation](references/installation.md) |
| `ImageResponse` | Constructor options, stylesheets, fonts, persistentImages, emoji, debug | [image-response](references/image-response.md) |
| Rendering APIs | `render()`, `Renderer`, `renderAnimation()`, `fromJsx`, `extractResourceUrls` | [rendering-apis](references/rendering-apis.md) |
| Node model | `container` / `text` / `image` nodes for non-JSX callers | [node-model](references/node-model.md) |
| Layout engine | Box model, auto sizing, intrinsic image size, CSS subset | [layout-engine](references/layout-engine.md) |
| `measure()` | Layout-only dimension queries without rendering pixels | [measure](references/measure.md) |

### Styling & Assets

| Topic | Description | Reference |
|-------|-------------|-----------|
| Fonts | Loading, variable fonts, emoji (twemoji / from-font), RTL, WOFF2 vs TTF | [fonts](references/fonts.md) |
| Images | External fetching, `resourcesOptions.cache`, `persistentImages`, intrinsic size | [images](references/images.md) |
| Tailwind CSS | Compiled stylesheet vs native `tw` parser, dynamic classes, v4 support | [tailwind](references/tailwind.md) |
| Animation | Keyframes object vs `@keyframes` stylesheet, `renderAnimation`, ffmpeg | [animation](references/animation.md) |

### Infrastructure

| Topic | Description | Reference |
|-------|-------------|-----------|
| Performance | Renderer reuse, preloads, parallel rendering, filter stacking, TTF > WOFF2 | [performance](references/performance.md) |
| Troubleshooting | `drawDebugBorder`, pnpm hoisting, undici fetch issues | [troubleshooting](references/troubleshooting.md) |
| Upgrade v0 → v1 | `display` default, unified entrypoint, emoji option, `ImageSource` | [upgrade-v0-v1](references/upgrade-v0-v1.md) |

### Framework Integrations

| Framework | Reference |
|-----------|-----------|
| Next.js (App Router) | [integration-nextjs](references/integration-nextjs.md) |
| Nuxt (via `nuxt-og-image`) | [integration-nuxt](references/integration-nuxt.md) |
| SvelteKit | [integration-sveltekit](references/integration-sveltekit.md) |
| TanStack Start | [integration-tanstack](references/integration-tanstack.md) |

### Migration & Templates

| Topic | Description | Reference |
|-------|-------------|-----------|
| Migrations — `@vercel/og` / Satori / `canvas` / `node-canvas` / `skia-canvas` / `@napi-rs/canvas` / Puppeteer / Playwright / `html2canvas` | Side-by-side rewrites, imperative → declarative, CSS differences | [migration-vercel-og](references/migration-vercel-og.md) |
| Official templates | Blog post, Docs, Product card — shadcn-registry + raw source URLs | [templates](references/templates.md) |

## On-demand docs pages

Any Takumi docs page can be fetched as clean Markdown by appending `.md`. Useful entry points:

- `https://takumi.kane.tw/docs.md` — introduction
- `https://takumi.kane.tw/docs/architecture.md`
- `https://takumi.kane.tw/docs/reference.md` — full style-property table (large)
- `https://takumi.kane.tw/docs/performance-and-optimization.md`
- `https://takumi.kane.tw/docs/troubleshooting.md`
- `https://takumi.kane.tw/llms-full.txt` — everything in one file (~72 KB)

Fetch these when the local reference files don't cover a specific edge case.
