# Rendering APIs

Three layers, from high-level to low-level:

1. **`ImageResponse`** — Fetch-compatible `Response` subclass. Use from route handlers. See [image-response](image-response.md).
2. **`render(jsxOrNode, options)`** — one-shot helper, returns raw bytes. Good when you're not in a Response context.
3. **`Renderer` class + `fromJsx` helper** — explicit instance for reuse, persistent images, and animation.

## `render()` — one-shot

```ts
import { render } from "takumi-js";

const bytes = await render(<Component />, {
  width: 1200,
  height: 630,
  format: "png",
  // ...same options as ImageResponse
});
```

## `Renderer` + `fromJsx`

Use this when you want to reuse the engine across many renders (the only way to get good throughput), call `measure()`, or do animations.

```ts
import { Renderer } from "takumi-js/node";     // Node/Bun
// import { Renderer } from "takumi-js/wasm";  // edge/browser
import { fromJsx } from "takumi-js/helpers/jsx";

const renderer = new Renderer({
  fonts: [/* raw ArrayBuffers, loaded once at module scope */],
});

const { node, stylesheets } = await fromJsx(<Component />);

const bytes = await renderer.render(node, {
  width: 1200,
  height: 630,
  format: "png",
  stylesheets,
});
```

### Constructor options

```ts
new Renderer({
  fonts?: ArrayBuffer[],       // fonts loaded once for every subsequent render
  persistentImages?: ImageSource[], // preloaded once
});
```

### Methods

| Method | Purpose |
| ------ | ------- |
| `renderer.render(node, options)` | Render a single frame. Same options as `ImageResponse`. |
| `renderer.renderAnimation({ scenes, fps, format, stylesheets, width, height })` | Render animated WebP / APNG / GIF. Scenes are an array of `{ node, durationMs }`. |
| `renderer.measure(node, { stylesheets })` | Return `{ width, height }` without producing pixels. See [measure](measure.md). |
| `renderer.putPersistentImage({ src, data })` | Add/replace a persistent image at runtime. **v1**: takes an `ImageSource` object, not a raw `Buffer`. |

Note: on `takumi-js/wasm` the methods are synchronous; on `takumi-js/node` they return promises.

## `fromJsx` helper

`fromJsx(element)` walks the React element tree and produces a Takumi `{ node, stylesheets }` pair.

Rules (mirroring the [implementation](https://github.com/kane50613/takumi/blob/master/takumi-helpers/src/jsx/jsx.ts)):

- React (Server) Components are resolved to their final values before processing.
- `<img>` and `<svg>` become **Image** nodes with style applied.
- Any other React element becomes a **Container** node with styles and presets.
- Strings and numbers become **Text** nodes.
- `props.style` is passed through to the container node as-is.
- Top-level `<style>` tags inside the tree are extracted into `stylesheets`.

## `extractResourceUrls` / `fetchResources`

For fine-grained control over image fetching (e.g. a shared batch cache, offline preflight), pre-walk the node tree:

```ts
import { extractResourceUrls, fetchResources } from "takumi-js/helpers";
import { fromJsx } from "takumi-js/helpers/jsx";
import { Renderer } from "takumi-js/node";

const { node } = await fromJsx(<Og />);
const urls = extractResourceUrls(node);
const fetchedResources = await fetchResources(urls);

const renderer = new Renderer();
const bytes = await renderer.render(node, { fetchedResources });
```

This pattern is also what `extractEmojis(node, "twemoji")` composes with under the hood — see [fonts](fonts.md#emoji).

## Output formats

| Format | Use with | Notes |
| ------ | -------- | ----- |
| `"png"` | `render` / `ImageResponse` | Default. Lossless. |
| `"jpeg"` | `render` / `ImageResponse` | Smaller, lossy. |
| `"webp"` | `render` / `ImageResponse` / `renderAnimation` | Lossless or lossy depending on encoder. |
| `"ico"` | `render` / `ImageResponse` | Favicons. |
| `"gif"` | `renderAnimation` | Legacy animation. Larger. |
| `"apng"` | `renderAnimation` | Higher quality animation. |
| `"raw"` | `render` | Raw RGBA bytes — pipe into ffmpeg for MP4/WebM. See [animation](animation.md). |

All format strings are lowercase in v1.
