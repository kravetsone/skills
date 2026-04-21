# Performance & Optimization

## Renderer

### Reuse the `Renderer` instance

Single biggest win. The `Renderer` owns fonts, persistent images, and internal caches — throwing it away per request means re-initializing all of them.

`ImageResponse` manages an internal renderer automatically, **but** you can pass your own via the `renderer` option — required in Cloudflare Workers / Edge runtimes where per-request construction tanks throughput.

#### Cloudflare Workers pattern

Initialize the WASM module and renderer **outside** `fetch()` so they live for the lifetime of the isolate:

```tsx
import { ImageResponse } from "takumi-js/response";
import { initSync, Renderer } from "takumi-js/wasm";
import module from "takumi-js/wasm/takumi_wasm_bg.wasm";
import archivo from "./Archivo.ttf";

initSync(module);

const renderer = new Renderer({ fonts: [archivo] });

export default {
  fetch(request) {
    return new ImageResponse(<Og />, {
      width: 1200,
      height: 630,
      renderer,
    });
  },
};
```

#### Node.js / Bun pattern

```ts
import { Renderer } from "takumi-js/node";
import inter from "./inter.ttf" with { type: "bytes" };

export const renderer = new Renderer({ fonts: [inter] });
```

Import and reuse `renderer` from every route handler.

### Preload frequently-used images

Any image loaded from a URL or bytes at render time is a bottleneck. Register hot assets via `persistentImages` on the renderer (or per-request via `ImageResponse`) to avoid re-decoding. See [images](images.md).

### Parallel rendering

Always prefer `@takumi-rs/core` over `@takumi-rs/wasm` when you can — the native build uses Rayon multithreading for parallel rendering. WASM is single-threaded.

On Node/Bun, concurrent `render()` calls on the same `Renderer` naturally parallelize.

## Component design

### Stack filters on a single node

Every filter (`filter`, `backdrop-filter`, `mix-blend-mode`, `opacity` on a compositing layer) allocates a composition layer the size of the viewport. Apply multiple filters to the **same** node rather than nesting wrappers that each need their own layer:

```tsx
// ✅ one composition layer
<div style={{ filter: "blur(8px) brightness(0.9) saturate(1.2)" }}>...</div>

// ❌ three composition layers, 3× memory
<div style={{ filter: "blur(8px)" }}>
  <div style={{ filter: "brightness(0.9)" }}>
    <div style={{ filter: "saturate(1.2)" }}>...</div>
  </div>
</div>
```

## Fonts

### Prefer TTF over WOFF2 in production

WOFF2 is compressed; the engine must decompress it before use. TTF is raw and maps directly into memory.

- Use **TTF** when render latency matters (the typical case).
- Use **WOFF2** only if bundle-size minimization matters more than render latency (e.g. cold-start-sensitive edge workers with small asset budgets).

### Load fonts at module scope

Never `fetch()` a font inside a per-request handler if you can avoid it:

```ts
// ✅ cold-start once
import inter from "./inter.ttf" with { type: "bytes" };
const renderer = new Renderer({ fonts: [inter] });

// ❌ refetch per request
new ImageResponse(<Og />, {
  fonts: [{ name: "Inter", data: () => fetch("...").then((r) => r.arrayBuffer()) }],
});
```

The lazy factory form is fine if your bundler can't inline the font binary — just ensure the factory is called on a **reused** renderer so it fires only once.

## Quick checklist

1. One long-lived `Renderer` per process / Worker isolate.
2. Fonts loaded as ArrayBuffers at module scope, in TTF when possible.
3. `persistentImages` for logos/backgrounds/avatars used across renders.
4. A shared `resourcesOptions.cache` `Map` for deduplicating external image fetches.
5. `@takumi-rs/core` (Node) in preference to `@takumi-rs/wasm` (edge) when both are options.
6. Filters stacked on one node instead of nested wrappers.
