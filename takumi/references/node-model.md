# Node Model

For non-JSX callers (raw JSON payloads, custom DSLs, server-to-server protocols), Takumi accepts a node tree directly. Three node kinds cover every use case — **container**, **text**, **image** — discriminated by a required `type` field.

The canonical format is JSON, which is universal and serializable. `fromJsx` is a convenience wrapper that emits the same structure from JSX.

> **The `type` discriminator is required.** Every node must carry `type: "container" | "text" | "image"`. Hand-writing it is easy to forget (`render` throws `InvalidArg, missing field 'type'`), so prefer the **builder helpers** from `@takumi-rs/helpers` — `container(props)`, `text(string, style?)` / `text(props)`, `image(props)` — which inject the right `type` for you. There's also a `style(...)` helper and unit helpers (`rem`, `em`, `percentage`, `vw`, `vh`, `fr`).

```ts
import { container, text, image } from "@takumi-rs/helpers";

const node = container({
  style: { display: "flex", alignItems: "center", gap: 12 },
  children: [
    image({ src: "https://…/avatar.png", width: 48, height: 48, style: { borderRadius: 24 } }),
    text("Hello, world", { fontSize: 24 }),
  ],
});
```

All nodes share `NodeMetadata`: `tagName?`, `className?`, `id?`, `dir?` (`"ltr" | "rtl"`), `attributes?`, `tw?`, `style?`, `preset?`.

## Container

Groups children and arranges them via CSS layout.

| Field | Type | Notes |
| ----- | ---- | ----- |
| `type` | `"container"` | **Required.** Node-kind discriminator. |
| `children` | `Node[]` | Child container/text/image nodes. |
| `tagName` | `string` | HTML-preset matching and CSS selectors. |
| `className` | `string` | For CSS-selector matching inside a stylesheet. |
| `id` | `string` | For CSS-selector matching. |
| `preset` | `CSSProperties` | Default HTML-element styles (lowest priority). |
| `style` | `CSSProperties` | Inline styles (highest priority). |
| `tw` | `string` | Tailwind classes (medium priority, overrides `preset`). |

## Text

Displays a string of text.

| Field | Type | Notes |
| ----- | ---- | ----- |
| `type` | `"text"` | **Required.** |
| `text` | `string` | **Required.** The string to render. |
| `tagName` / `className` / `id` | `string` | Optional metadata. |
| `preset` / `style` | `CSSProperties` | |
| `tw` | `string` | |

## Image

Displays a rasterized or SVG image.

| Field | Type | Notes |
| ----- | ---- | ----- |
| `type` | `"image"` | **Required.** |
| `src` | `string \| Uint8Array \| ArrayBuffer` | **Required.** URL, a `persistentImages` key, or raw bytes (see [images](images.md)). |
| `width` | `number` | Overrides the image's intrinsic width. |
| `height` | `number` | Overrides the image's intrinsic height. |
| `tagName` / `className` / `id` | `string` | Optional metadata. |
| `preset` / `style` | `CSSProperties` | |
| `tw` | `string` | |

## Style priority

When multiple sources contribute styles, the final value is resolved as:

```
preset (lowest)  <  stylesheet selector  <  tw  <  style (highest)
```

## Example — hand-built tree (raw `type`, no builders)

```ts
import { Renderer } from "takumi-js/node";

const renderer = new Renderer();

const node = {
  type: "container",                 // ← required discriminator
  style: {
    display: "flex",
    width: 1200,
    height: 630,
    backgroundColor: "#0f172a",
    color: "white",
    fontSize: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  children: [
    { type: "text", text: "Hello, world" },
  ],
};

const png = await renderer.render(node, { width: 1200, height: 630, format: "png" });
```

## Style property reference

The full list (layout, flex, grid, typography, colors, borders, shadows, filters, 2D transforms, animations, SVG-specific) lives at https://takumi.kane.tw/docs/reference#style-properties. Fetch `https://takumi.kane.tw/docs/reference.md` when you need the authoritative table.
</content>
