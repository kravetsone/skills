# Layout Engine

Takumi uses [Taffy](https://github.com/DioxusLabs/taffy), a Rust implementation of the CSS Flexbox and CSS Grid specifications, for all layout. Text layout is handled by [Parley](https://github.com/linebender/parley). Together they give browser-grade layout without a browser.

## Box model

Every node follows the standard CSS box model: total size = content + padding + border + margin.

## Display defaults (v1 gotcha)

**In v1 `display` defaults to `inline`, matching the CSS spec.** In v0 it defaulted to `flex`. If a layout that worked in v0 collapses in v1, the fix is almost always adding `display: "flex"` or `"grid"` (or the `flex` / `grid` Tailwind class) to containers that need flow layout.

```tsx
<div
  style={{
    display: "flex",       // ← required for flexbox behavior
    alignItems: "center",
    justifyContent: "center",
  }}
/>
```

This was changed so LLMs generate spec-correct components without guessing.

## Auto sizing

`width` and `height` in `ImageResponse` options are both optional. Omit them to let layout drive the size based on content:

```tsx
import { ImageResponse } from "takumi-js/response";

export function GET() {
  return new ImageResponse(<List />, { width: 1200 });   // height auto
}

function List() {
  const items = Array.from({ length: 5 }, (_, i) => i);
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
      {items.map((i) => <div key={i}>Item {i}.</div>)}
    </div>
  );
}
```

Use this for dynamic-height content like release notes or chat logs where the design requires exact fit.

## Intrinsic size for images

By default an `<img>` is measured at its intrinsic size. Override with explicit `width` / `height`:

```tsx
<img src="https://example.com/photo.png" width={1200} height={600} />
```

If neither intrinsic nor explicit size is resolvable, the image collapses — always provide dimensions for external URLs when you don't control the source.

## Supported CSS surface

- **Layout**: `display` (block/inline/flex/grid/none), `position` (static/relative/absolute/fixed), `float`, `clear`, `z-index`, `calc()`.
- **Sizing**: `width`, `height`, `min-*`, `max-*`, `aspect-ratio`, `padding`, `margin`, `border-*`, `box-sizing`.
- **Flexbox**: `flex-direction`, `flex-wrap`, `flex-basis/grow/shrink`, `align-items`, `justify-content`, `align-self`, `gap`, `row-gap`, `column-gap`.
- **Grid**: `grid-template-columns/rows`, `grid-area`, `grid-auto-flow`, named lines.
- **Typography**: `font-family`, `font-size`, `font-weight`, `line-height`, `letter-spacing`, `text-align`, `text-transform`, `text-decoration`, `text-overflow: ellipsis`, `line-clamp`, `white-space`, `text-wrap`, `font-variation-settings`, `font-feature-settings`.
- **Visual**: `background-color`, `background-image` (url/gradients), `mask-image`, `border-radius`, `box-shadow`, `opacity`, `filter`, `backdrop-filter`, `mix-blend-mode`.
- **Transforms**: 2D only — `translate`, `rotate`, `scale`, `skew`, `matrix`. No `perspective`, no 3D.
- **Animation**: `@keyframes` via stylesheet or structured `keyframes` option + `timeMs`. `from`/`to`/percentage offsets, `linear`/`ease`/`steps()`/`cubic-bezier()` timing, fill modes, delays, iteration counts.
- **SVG**: inline SVG rasterized via [resvg](https://github.com/linebender/resvg). External SVG files in `src` are also supported.

Full authoritative list: https://takumi.kane.tw/docs/reference.md (large — fetch on demand).

## Not supported (common pitfalls)

- Pseudo-elements (`::before`, `::after`).
- `position: sticky`.
- Non-`@keyframes` animations (CSS transitions, JS interactivity).
- 3D transforms, `perspective`.
- External CSS files loaded via `@import` at runtime — pass full CSS strings through `stylesheets`.
- System fonts (any font not in `fonts` or the embedded defaults).
- Custom property (`--var`) resolution for Tailwind's `animate-(--name)` form (see [animation](animation.md)).
