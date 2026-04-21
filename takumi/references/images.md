# Images

## External images

By default, Takumi fetches external images referenced in `src` attributes and in CSS `background-image` / `mask-image`. No opt-in required:

```tsx
<img src="https://example.com/photo.png" />
<div style={{ backgroundImage: "url(https://example.com/bg.jpg)" }} />
```

## `resourcesOptions.cache` — dedup fetches

Pass a shared `Map<string, ArrayBuffer>` to deduplicate external fetches across renders. Keep the map at module scope so it survives across requests in the same worker:

```ts
import { render } from "takumi-js";

const cache = new Map<string, ArrayBuffer>();

export async function handler() {
  return render(<Element />, {
    resourcesOptions: { cache },
  });
}
```

## `persistentImages` — preload hot assets

For logos, backgrounds, avatars that appear in most renders, pass them as `persistentImages`. The image is decoded once and stored on the renderer; reference it later by its `src` key instead of a URL:

```tsx
import { ImageResponse } from "takumi-js/response";
import type { ImageSource } from "takumi-js";

export function GET() {
  return new ImageResponse(<OgImage />, {
    persistentImages: [
      { src: "my-logo",    data: () => fetch("/logo.png").then((r) => r.arrayBuffer()) },
      { src: "background", data: () => fetch("/bg.png").then((r) => r.arrayBuffer()) },
    ],
  });
}

function OgImage() {
  return (
    <div style={{ backgroundImage: "url(background)" }}>
      <img src="my-logo" />
    </div>
  );
}
```

Keys are arbitrary strings — `"my-logo"`, `"avatar"`, `"hero-bg"`. They take precedence over URL resolution, so a `src="my-logo"` is matched against `persistentImages` before any HTTP fetch is attempted.

## `putPersistentImage()` (v1 signature)

On a long-lived `Renderer`, you can add or replace persistent images at runtime. In v1, the method takes an `ImageSource` object, not a raw buffer:

```ts
const data = await readFile("foo.png");

await renderer.putPersistentImage({ src: "foo.png", data });  // ✅ v1
// await renderer.putPersistentImage("foo.png", data);         // ❌ v0
```

## Intrinsic vs explicit size

- An `<img>` with no `width`/`height` uses the decoded image's intrinsic size.
- Pass explicit `width` and `height` to force a specific box.
- For external URLs you don't control, **always** pass explicit dimensions — if the fetch fails or returns unexpected metadata, layout collapses without them.

```tsx
<img src="https://example.com/photo.png" width={1200} height={600} />
```

## SVG

Inline SVG is rasterized via [resvg](https://github.com/linebender/resvg) — no extra setup:

```tsx
<svg viewBox="0 0 24 24" width={48} height={48}>
  <path d="M12 2 L22 22 L2 22 Z" fill="#0ea5e9" />
</svg>
```

External SVG files referenced via `src` are also supported.

## Format hints

Common inputs that decode correctly: PNG, JPEG, WebP (static and animated first-frame), GIF, SVG, ICO. For best performance prefer PNG or WebP; animated inputs only use their first frame unless you handle the timeline yourself via `keyframes`.
