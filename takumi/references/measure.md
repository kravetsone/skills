# `measure()` API

Run the full layout pipeline (Taffy + Parley) and get the computed geometry **without** producing pixels. Useful for:

- "Will this text fit?" decisions before committing to a render.
- Sizing follow-on UI elements (chips, badges, buttons) to their rendered text.
- Pre-computing layout for adaptive templates (if `title` wraps to two lines, bump the image height).
- Dynamic auto-height images where you need the exact output dimensions before `render()`.
- **Pixel-perfect verification** — comparing the rendered box/position of every node against a design's coordinates (see [figma-pixel-perfect](figma-pixel-perfect.md)).

## It returns the full layout tree

`measure()` returns a **`MeasuredNode` tree**, not just the root box — every node's size, transform, and children, mirroring the input structure:

```ts
type MeasuredNode = {
  width: number;
  height: number;
  transform: [number, number, number, number, number, number]; // 2×3 affine [a,b,c,d,e,f]
  children: MeasuredNode[];
  runs: MeasuredTextRun[];   // text runs (for text nodes)
};
```

- **Size**: `width` / `height` are the node's content-box dimensions.
- **Position**: the affine `transform` is the node's **absolute (root-relative) world transform** —
  `transform[4]` = x, `transform[5]` = y of the node within the whole image. Use it **directly**;
  do **not** accumulate it down the tree (that double-counts parent offsets). `a,b,c,d` carry
  scale/rotation if you use them — cards usually don't.
- **children** mirror the input node's children order (anonymous — no `id`/`tagName`, so map positionally).

```ts
import { Renderer } from "takumi-js/node";
import { fromJsx } from "takumi-js/helpers/jsx";

const renderer = new Renderer();
const { node, stylesheets } = await fromJsx(<Card {...props} />);

const m = await renderer.measure(node, { width: 1200, height: 630, stylesheets });
// m.width, m.height                              → root box
// m.children[0].transform[4], …[5]               → first child x, y (within root)
// m.children[0].width / m.children[0].height     → first child box
```

## Options

`measure(node, options)` takes the same shape as `render` minus the encoder — notably:

- `width` / `height` — **constrain** the layout (required when the root uses `width: "100%"`/`"100%"` or you want a fixed canvas). Returns the constrained sizes.
- `stylesheets` — pass the `fromJsx` stylesheets so selector styles apply.

## WASM (edge / browser)

Same API, but synchronous (no `await`):

```ts
import { Renderer } from "takumi-js/wasm";
const m = renderer.measure(node, { width: 1200, stylesheets });
```

## Notes

- Fonts must be loaded on the renderer (or be embedded defaults) for text to measure at the correct size — otherwise fallback metrics skew the result. Load the same fonts you render with.
- For a constrained-width auto-height measure, pass `width` and read back `height`.
- Because the measured tree is positional (no ids), to compare against a design map nodes by their position in the tree, or keep your JSX structure aligned with the design's node order.
</content>
