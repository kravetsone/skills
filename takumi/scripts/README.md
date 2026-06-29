# Takumi pixel-perfect scripts

Helper scripts for the [Figma → Takumi pixel-perfect](../references/figma-pixel-perfect.md)
workflow: pull a Figma reference, scaffold a first-pass component, render with Takumi, and diff
render-vs-reference until they match — driven by numbers, not by eyeballing a screenshot.

## Install

**Vendor these into the target repo** (e.g. copy to `scripts/figma/` or `tooling/`). They
import `takumi-js`, `pixelmatch`, and `pngjs` from the *project's* `node_modules` — they won't
resolve from the skill directory.

```bash
bun add takumi-js                  # render engine (ships a prebuilt native binary)
bun add -d react pixelmatch pngjs  # react = JSX runtime; pixelmatch/pngjs = diff
```

`react` is required only as the JSX runtime for the component files (Bun/Node compile JSX to
`react/jsx-runtime`); takumi-js has no React peer dep. The component must live inside the
project tree, and the scripts run from the project root (they resolve `takumi-js` from the cwd).
**Never construct `new Renderer({ fonts: [] })`** — an empty array disables the embedded default
font; the scripts omit the option when empty.

Dependency-free (`fetch` only, Node 18+/Bun, run from anywhere): `figma-pull`, `fonts-fetch`,
`scaffold`. Need the project's deps: `render` + `measure-probe` (`takumi-js`, run with **Bun**),
`visual-diff` (`pixelmatch`/`pngjs`).

## The loop

```
figma-pull ──▶ .figma/figma.png + spec.json + images/        (ground truth + assets)
     │
fonts-fetch ──▶ .figma/fonts/                                 (exact fonts; #1 determinant)
     │
scaffold spec.json ──▶ Card.tsx                               (Auto Layout → flex, first pass)
     │
  agent refines → reflow (HUG/FILL), tokens, components       (must not move pixels)
     │
render.mjs --diff ──▶ render.png + ratio + heatmap + hotspots (Takumi render + gate, one command)
     │                                              │
     │   ambiguous hotspot? measure-probe ──▶ Δw/Δh │ fix the value that owns it
     └──────────────────────────────────────────────┘  re-run render.mjs
```

A fixed-size image has no responsiveness, so geometry from `scaffold` is right on the first
render — the loop then chases styling. Verification is Takumi + these scripts only.

## 1. `figma-pull.mjs` — fetch reference + spec + assets

```bash
FIGMA_TOKEN=figd_xxx node figma-pull.mjs \
  --url "https://www.figma.com/design/<key>/Name?node-id=1-2" --scale 2
# or:  --file <fileKey> --node 1:2 --scale 2 --out ./.figma
```

Writes `figma.png` (the pixel-perfect reference), `node.json` (raw), `spec.json` (flattened:
per-node `box`/`layout`/`sizing`/`fills`/`text`, gradient **angles**, the **fonts** to load, the
exact **render px**, and an `images` map), and downloads each image fill into `images/`.
`FIGMA_TOKEN` = a Figma personal access token. With the official Dev Mode MCP you can skip this
and use `get_metadata`/`get_screenshot`/`get_variable_defs` — just shape the result into the same
`spec.json`.

## 2. `fonts-fetch.mjs` — get the exact fonts (best-effort)

```bash
node fonts-fetch.mjs .figma/spec.json --out .figma/fonts
```

Downloads the spec's families/weights from Google Fonts into the dir. Fonts are the biggest
pixel-perfect determinant — wrong/missing fonts shift every line. Lists any family **not** on
Google Fonts so you can drop the licensed file in by hand. No deps.

## 3. `scaffold.mjs` — first-pass component

```bash
node scaffold.mjs .figma/spec.json --out Card.tsx --name Card
```

Layout-aware transcription: Auto Layout → `flex`/`gap`/`padding`/align, child sizing as
HUG/FILL/FIXED, real `<img>` for downloaded fills, gradients with the computed angle, absolute
**only** for overlays / Auto-Layout-off nodes. It already emits the "normal spacing" version —
**refine it** (relax FIXED→HUG/FILL for dynamic data, extract tokens, split into components)
without moving pixels. No deps; Node 18+ or Bun.

## 4. `render.mjs` — the loop driver (Bun)

```bash
bun render.mjs --component ./Card.tsx --spec .figma/spec.json \
  --fonts .figma/fonts --images .figma/images \
  --out render.png --diff .figma/figma.png --max-ratio 0.005
```

Renders the component at the exact px (from `spec.renderPx`, or `--width/--height`), loading
every font in `--fonts` and registering every file in `--images` as a persistentImage keyed by
its filename (matching the `src` keys `scaffold` emits). With `--diff` it runs `visual-diff` and
exits non-zero on fail — one command per loop iteration. `--component` default-exports a Takumi
element or a zero-arg component. Run with **Bun**, from the target repo.

## 5. `visual-diff.mjs` — the verify gate

```bash
node visual-diff.mjs --actual render.png --expected .figma/figma.png \
  --out diff.png --max-ratio 0.01
```

Prints mismatch ratio, an ASCII heatmap, and the densest diff regions as `x,y,w,h` rects; writes
`diff.png` (red = differs; yellow AA is ignored). **Exits non-zero** over `--max-ratio`. Also
importable: `import { compare, formatReport } from "./visual-diff.mjs"` (this is what `render.mjs`
uses). Dimensions must match — it refuses to resize, because a scale mismatch is itself the bug.

Tuning: `--threshold` (0..1) per-pixel color sensitivity; `--max-ratio` the pass gate
(~0.005–0.01 for flat cards; raise for gradients/photos that never reach 0).

## 6. `measure-probe.mjs` — geometry x-ray (Bun)

```bash
bun measure-probe.mjs --component ./Card.tsx --spec .figma/spec.json [--fonts .figma/fonts]
```

One `measure()` call prints every node's absolute `x,y` and `w×h` (Takumi returns the full
layout tree), labeled with its text. Compare any node against its `spec.json` box to find which
value is off. Run with Bun from the project root; the component must live inside the project.

## Gotchas

- **Scale.** Render px must equal Figma frame px × export scale. `figma-pull` prints the target;
  `render.mjs` reads it from `spec.renderPx`; `visual-diff` refuses mismatched dimensions.
- **Fonts first.** Wrong/missing fonts shift every line. Resolve fonts (`fonts-fetch` or by hand)
  before chasing any spacing diff. See [../references/fonts.md](../references/fonts.md).
- **Same data.** Render the same dynamic content the Figma frame shows, or text-length
  differences read as layout bugs.
</content>
