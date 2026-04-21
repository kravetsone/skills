# `measure()` API

Return the computed box size of a node tree **without** producing pixels. Useful for:

- "Will this text fit?" decisions before committing to a render.
- Sizing follow-on UI elements (chips, badges, buttons) to their rendered text.
- Pre-computing layout for adaptive templates (if `title` wraps to two lines, bump the image height).
- Dynamic auto-height OG images where you need the exact output dimensions before calling `render()`.

## Node (Bun / Node.js)

```ts
import { Renderer } from "takumi-js/node";
import { fromJsx } from "takumi-js/helpers/jsx";

const renderer = new Renderer();
const { node, stylesheets } = await fromJsx(
  <span style={{ fontSize: 24 }}>I'm a text node</span>,
);

const { width, height } = await renderer.measure(node, { stylesheets });
```

## WASM (edge / browser)

Same API, but `measure()` is synchronous (no `await`):

```ts
import { Renderer } from "takumi-js/wasm";
import { fromJsx } from "takumi-js/helpers/jsx";

const renderer = new Renderer();
const { node, stylesheets } = await fromJsx(
  <span style={{ fontSize: 24 }}>I'm a text node</span>,
);

const { width, height } = renderer.measure(node, { stylesheets });
```

## Notes

- `measure()` runs the full layout pipeline (Taffy + Parley), so text wrapping, font metrics, padding, borders, and flex sizing are all accurate.
- Fonts must be loaded on the renderer (or be embedded defaults) for text to measure at the correct size — otherwise fallback metrics will skew the result.
- For a constrained-width measurement, wrap the node in a container with an explicit `width` and let layout compute `height`.
