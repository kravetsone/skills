# Node Model

For non-JSX callers (raw JSON payloads, custom DSLs, server-to-server protocols), Takumi accepts a node tree directly. Three node kinds cover every use case — `container`, `text`, `image`.

The canonical format is JSON, which is universal and serializable. `fromJsx` is a convenience wrapper that emits the same structure from JSX.

## Container

Groups children and arranges them via CSS layout.

| Field | Type | Notes |
| ----- | ---- | ----- |
| `tagName` | `string` | Used for HTML-preset matching and CSS selectors. |
| `className` | `string` | For CSS-selector matching inside a stylesheet. |
| `id` | `string` | For CSS-selector matching. |
| `children` | `Node[]` | Child container/text/image nodes. |
| `preset` | `Style` | Default HTML-element styles (lowest priority). |
| `style` | `Style` | Inline styles (highest priority). |
| `tw` | `string` | Tailwind classes (medium priority, overrides `preset`). |

## Text

Displays a string of text.

| Field | Type | Notes |
| ----- | ---- | ----- |
| `tagName` | `string` | |
| `className` | `string` | |
| `id` | `string` | |
| `text` | `string` | **Required.** The string to render. |
| `preset` | `Style` | |
| `style` | `Style` | |
| `tw` | `string` | |

## Image

Displays a rasterized or SVG image.

| Field | Type | Notes |
| ----- | ---- | ----- |
| `tagName` | `string` | |
| `className` | `string` | |
| `id` | `string` | |
| `src` | `string` | **Required.** URL **or** a `persistentImages` key (see [images](images.md)). |
| `width` | `number` | Overrides the image's intrinsic width. |
| `height` | `number` | Overrides the image's intrinsic height. |
| `preset` | `Style` | |
| `style` | `Style` | |
| `tw` | `string` | |

## Style priority

When multiple sources contribute styles, the final value is resolved as:

```
preset (lowest)  <  stylesheet selector  <  tw  <  style (highest)
```

## Example — hand-built tree

```ts
import { Renderer } from "takumi-js/node";

const renderer = new Renderer();

const node = {
  tagName: "div",
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
    { tagName: "span", text: "Hello, world" },
  ],
};

const png = await renderer.render(node, { format: "png" });
```

## Style property reference

The full list (layout, flex, grid, typography, colors, borders, shadows, filters, 2D transforms, animations, SVG-specific) lives at https://takumi.kane.tw/docs/reference#style-properties. Fetch `https://takumi.kane.tw/docs/reference.md` when you need the authoritative table.
