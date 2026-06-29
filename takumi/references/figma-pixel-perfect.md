# Figma → Takumi, Pixel-Perfect

Reproduce a Figma frame as a Takumi image so the render matches the design at the
pixel level — and teach an agent to do it reliably, not "by eye".

This is the design-to-image counterpart of the design-to-code workflows built on the
Figma MCP server. Takumi makes it **shorter and more honest** than the web version:
you render straight to a PNG (no browser, no Playwright, no font anti-aliasing
divergence between Figma and Chromium), and you diff that PNG against Figma's own
export of the same node.

## The one principle

**Spatial reasoning from a screenshot is the thing LLMs are worst at.** An agent will
see "there's a title near the top" but miss that it's 6px too low, or that the weight is
500 not 600. So the whole method is built to *avoid eyeballing*:

1. Drive layout from **real values** (Figma's actual `paddingLeft: 12`, `itemSpacing: 8`,
   `fontSize: 28`, fills as hex) — never from guessing at a screenshot.
2. Make correction **numeric**: render → pixel-diff → "mismatch is in this region" → fix
   the value that owns that region → re-render. Numbers, not vibes.
3. **Multi-source validation.** Each fact should agree across the Figma node JSON, the
   variable/token defs, the reference export, and the rendered output. One source can
   lie; four agreeing is pixel-perfect.

The agent is the labor layer. The diff is the quality gate.

## Fixed canvas: what "no adaptivity" actually buys you

A Takumi image has **no responsiveness** — one fixed size, no breakpoints, no media queries,
no fluid units, no `min/max` juggling, no device matrix. That deletes the hardest part of
design-to-code. But it does **not** mean "pin absolute coordinates everywhere" — that's a trap:

- The canvas is fixed in **size**, but the **content is dynamic** — names, counts, stat numbers
  vary in length and quantity. Absolute coordinates match the one example in the macro and
  break on real data. **Author with normal flow — `flex` + `gap` + `padding`** — so longer
  content reflows instead of overflowing or needing manual coordinate math.
- Flow layout is also the only thing `measure()` and Takumi auto-height work with, and it reads
  far better than a wall of `left`/`top`.
- **Absolute is the exception, not the rule**: true overlays (badges, watermarks, decorations)
  and nodes where Figma's Auto Layout is off.

What you actually save vs web: the adaptive primitives. You author **once**, with **one set of
real values** — no `clamp()`, no breakpoints, no fluid sizing. Map Figma Auto Layout → flex 1:1,
pin only the *frame* size, and let inner elements HUG/FILL.

The winning shape is **scaffold → refine → verify**. `scripts/scaffold.mjs` is layout-aware: it
emits `flex`/`gap`/`padding`/align wherever Figma used Auto Layout (HUG→omit, FILL→`flex: 1`,
FIXED→px) and drops to absolute only for overlays / Auto-Layout-off nodes — i.e. it already
produces the "normal spacing" version. You then refine it (relax FIXED→HUG/FILL for dynamic
data, extract tokens, split into components) with the pixel diff guarding every step.

## Step 0 — Get the Figma context (any best method)

Use whatever gives the richest context; ranked best-first:

1. **Official Figma Dev Mode MCP** — best. Real values + variables + Code Connect + a node
   screenshot, straight in the agent's context.
2. **Framelink MCP** (`GLips/Figma-Context-MCP`) — open-source fallback, any account.
3. **REST via `scripts/figma-pull.mjs`** — no MCP at all; one command → reference PNG + spec.

All three feed the *same* downstream pipeline. Whatever the source, normalize to the fields
below and (for the scaffold) to a `spec.json`-shaped tree. Verification is **always** Takumi +
the scripts in this skill — never an external screenshot tool.

Three ways to pull a node, pick by what's available:

| Source | Tools | Notes |
| ------ | ----- | ----- |
| **Official Figma Dev Mode MCP** | `get_design_context`, `get_metadata`, `get_variable_defs`, `get_code_connect_map`, `get_screenshot` | Best. Returns **real values, not pixels** (`paddingLeft: 12`, not a measured guess) + variables + a node screenshot. Needs a Dev seat. |
| **Framelink MCP** (`GLips/Figma-Context-MCP`) | `get_figma_data`, `download_figma_images` | Open-source, any account, personal access token. No Code Connect / variable awareness. |
| **REST, via `scripts/figma-pull.mjs`** | — | No MCP at all. Pulls the node tree, a flattened spec (boxes + styles + fonts), and the PNG export in one shot. See [scripts](#scripts). |

What you must extract regardless of source:

- **Frame size** (`width × height`) and the **export scale** (1×/2×). The render must be
  produced at the *same pixel dimensions* as the reference export. A 1200×630 frame
  exported at 2× is a 2400×1260 reference — render Takumi at 2400×1260 (or export at 1×).
  Mismatched scale is the #1 cause of a "totally wrong" first diff.
- **Per-node geometry** — `absoluteBoundingBox` (x/y/w/h), made local to the frame origin.
- **Layout** — `layoutMode`, primary/counter-axis alignment, `itemSpacing`, padding.
- **Style** — fills, strokes, corner radius, effects (shadows/blur), opacity.
- **Text** — `fontFamily`, `fontPostScriptName`, `fontWeight`, `fontSize`, `lineHeightPx`,
  `letterSpacing`, `textAlignHorizontal`, `textCase`, and the characters.
- **The exact fonts** the frame uses — see the font rule below; this is decisive.

## Step 1 — Scaffold the geometry, then author beautifully

**1a. Scaffold (mechanical, layout-aware).** Run `scripts/scaffold.mjs spec.json` to transcribe
the node tree into a first-pass Takumi component: Auto Layout → `flex`/`gap`/`padding`/align,
child sizing as HUG/FILL/FIXED, absolute only for overlays and Auto-Layout-off nodes, with
fills/text/shadows/fonts filled in from real values. It produces the "normal spacing" structure
so the agent never reasons about coordinates from a screenshot.

**1b. Refine into clean markup (the "beautiful verstka" the LLM must learn).** The scaffold is
already mostly semantic; refine it toward maintainable code — *without moving pixels* (the diff
gate enforces that):

- **Make it reflow.** The scaffold pins FIXED sizes taken from the example data. Where content
  is dynamic (names, counts, numbers), relax to HUG (omit the size) or FILL (`flex: 1`) so real
  data of different length lays out correctly. This is the maintainability win the fixed canvas
  still needs — and the reason absolute coordinates are the wrong default.
- **Name from Figma layers.** Turn each meaningful frame/layer into a named component
  (`<CardHeader>`, `<StatRow>`); pass dynamic data as props. The Figma layer names are your
  component names.
- **Tokens, not literals.** Lift repeated colors/sizes/radii into a `tokens.ts`; reference
  tokens. No hardcoded hex, no magic numbers in the final code.
- **One source of truth for text.** Real `fontSize`/`lineHeight`/`letterSpacing` from the spec,
  via tokens; never eyeballed.

The result reads like hand-written Takumi, but every value traces back to Figma.

Auto Layout *is* flexbox, so the refactor is close to 1:1. Use the cheat-sheet at the bottom.
Three rules dominate the outcome:

**Tokens, not literals.** Map Figma variables/styles to a `tokens.ts` and reference it.
Hard rule for the agent: **no hardcoded hex, no magic numbers** — every color/space comes
from a token or from the node's real value. Agents that guess token *names* instead of
reading `get_variable_defs` are the usual failure.

**Components, not from-scratch.** If the frame uses a component that already exists as a
Takumi component in the repo (or is mapped via Code Connect), reuse it. Don't re-author
markup that already exists — that's how you drift from the design system.

**Fonts decide everything.** Takumi has **no system fonts** (see [fonts](fonts.md)). If
the Figma frame uses Inter 600 and you don't load *that* font, text renders as tofu *or*
falls back to Geist — whose metrics differ, so every line shifts and the whole layout
moves. Load the frame's exact families/weights into the `fonts` option and set
`fontFamily` to match the font `name` exactly. `scripts/fonts-fetch.mjs` pulls OSS families
from Google Fonts into a dir automatically (`figma-pull` already lists what the frame uses);
for licensed/custom fonts, drop the files into that dir yourself. Prefer TTF over WOFF2 in
production. This single thing accounts for most "close but everything's a few px off" diffs.

Other footguns from the core skill that bite here specifically:

- **`display: "flex"` is required** on every layout container (v1 defaults to `inline`).
  An Auto Layout frame that "collapsed" almost always lost its `display: flex`. See
  [layout-engine](layout-engine.md#display-defaults-v1-gotcha).
- A Figma node with Auto Layout **off** (absolute positioning) → `position: "absolute"`
  + `left`/`top` from the local box, on a `position: "relative"` parent.

## Setup (standalone Bun/Node) — verified gotchas

The render/measure scripts run a JSX component outside a framework. Five things, all of which
bite in practice:

- **Install a JSX runtime**: `bun add -d react`. Bun/Node transform JSX to `react/jsx-runtime`;
  without it you get `Cannot find module 'react/jsx-dev-runtime'`. (takumi-js has no React
  *peer* dep — it just needs *some* element factory.)
- **The component file must live inside the project tree**, so its JSX-runtime and `takumi-js`
  imports resolve from the project's `node_modules`.
- **Run the scripts from the project root.** `render.mjs` / `measure-probe.mjs` resolve
  `takumi-js` from the **cwd**, so the globally-installed skill scripts work against the
  project's deps — no vendoring needed.
- **Never pass `fonts: []`.** An empty array **disables the embedded default font** (Geist),
  so all text renders/measures blank (0×0). Omit the option when you have no custom fonts —
  `render.mjs`/`measure-probe.mjs` already do this.
- **Native binary** ships prebuilt: `@takumi-rs/core` pulls `@takumi-rs/core-<platform>` (no
  Rust build on macOS/Linux).

## Step 2 — Render at the exact frame size

Use the driver — `scripts/render.mjs` renders the component at the exact px (reading
`renderPx` from `spec.json`), loads the frame's fonts and image assets from the pull, and
(with `--diff`) runs the gate, all in one command:

```bash
bun scripts/render.mjs --component ./Card.tsx --spec .figma/spec.json \
  --fonts .figma/fonts --images .figma/images --diff .figma/figma.png --max-ratio 0.005
```

Equivalent by hand:

```ts
import { Renderer } from "takumi-js/node";
import { fromJsx } from "takumi-js/helpers/jsx";

const renderer = new Renderer({ fonts: [/* exact fonts */], persistentImages: [/* {src,data} */] });
const { node, stylesheets } = await fromJsx(<Card {...props} />);
const png = await renderer.render(node, {
  width: 1200, height: 630, // === Figma frame px (× export scale)
  format: "png",
  stylesheets,
});
await Bun.write("render.png", png);
```

## Step 3 — The verify loop (this is the part that makes it pixel-perfect)

```
        ┌─────────────────────────────────────────────┐
        ▼                                             │
   render.png ──visual-diff vs figma.png──▶ mismatch% + hotspot region
        │                                             │
        │   if a region is ambiguous:                 │ fix the value that
        │   measure-probe that subtree ──▶ Δw/Δh px   │ owns that region
        ▼                                             │
   mismatch% ≤ threshold? ── no ─────────────────────┘
        │
        yes → done
```

1. **`scripts/visual-diff.mjs`** is the gate. It pixel-diffs the render against the Figma
   export and prints the mismatch ratio, a coarse ASCII heatmap, and the densest
   diff regions as `x,y,w,h` rects. The heatmap lets the agent *locate* the error
   without spatial-reasoning over raw pixels. pixelmatch ignores anti-aliased pixels by
   default, which suppresses the Figma-vs-renderer font-AA noise that derails web loops.
2. **`scripts/measure-probe.mjs`** is the numeric check — a geometry x-ray. One `measure()`
   call prints every node's absolute `x,y` and `w×h` (Takumi returns the full layout tree),
   labeled with its text. When a hotspot is ambiguous ("is the gap wrong or the padding?"),
   read the exact rendered box and compare to the Figma `spec.json` number — the Δ tells you
   which value to change. (See [measure](measure.md).)
3. Change **one value**, re-render, re-diff. Converge until mismatch ≤ threshold
   (~0.5–1% is "pixel-perfect for cards"; tune per content — gradients/photos never hit 0).

`render.mjs --diff` does steps render + (1) in one command; reach for `measure-probe` (2) only
when a hotspot is ambiguous. Wire `render.mjs --diff` (or `visual-diff`) into a hook / CI gate so
"done" can't be claimed while the diff is red — the same trick web pipelines use with a tsc
PostToolUse hook: keep shoving the failure back at the model.

## The whole loop, end to end

```bash
# one-time: render engine + JSX runtime + diff deps
bun add takumi-js && bun add -d react pixelmatch pngjs

# 0. Pull reference PNG + spec.json + image assets (or use the Figma MCP and shape a spec.json)
FIGMA_TOKEN=figd_… node scripts/figma-pull.mjs \
  --url "https://www.figma.com/design/<key>/Card?node-id=12-345" --scale 2 --out .figma

# 1. Fonts (OSS auto; licensed → drop files into .figma/fonts yourself)
node scripts/fonts-fetch.mjs .figma/spec.json --out .figma/fonts

# 2. First-pass component (Auto Layout → flex, real <img>/gradients, absolute only for overlays)
node scripts/scaffold.mjs .figma/spec.json --out Card.tsx

# 3. Refine Card.tsx (reflow: FIXED→HUG/FILL for dynamic data; tokens; components) — see Step 1b

# 4. Loop until green: render + diff in one command, fix ONE value per hotspot, repeat
bun scripts/render.mjs --component ./Card.tsx --spec .figma/spec.json \
  --fonts .figma/fonts --images .figma/images --diff .figma/figma.png --max-ratio 0.005
#   → read mismatch% + heatmap + hotspot rects → change the value that owns the hotspot → re-run
```

## Anti-patterns (the corrections that *break* pixel-perfect)

- **Eyeballing the screenshot.** Changing `fontSize` 14→15 or nudging margins because it
  "looks off" — this is the agent fighting font anti-aliasing, not a real bug. Only change
  a value when a **number** (diff region or `measure()` Δ) says so.
- **Wrong/missing fonts** → metrics drift → everything shifts. Fix fonts *first*, before
  touching any spacing.
- **Scale mismatch** between render px and export px → a uniformly "zoomed" diff. Fix the
  dimensions before reading the heatmap.
- **Guessing token names** instead of reading variable defs.
- **Diffing different content.** Use the same dynamic data in the render as the Figma frame
  shows, or the text-length differences read as layout bugs.

## Agent contract (copy-paste into the subagent prompt)

```
You convert a Figma node into a pixel-perfect Takumi image. Hard rules:

1. Read REAL values from Figma context (get_metadata / get_variable_defs / spec.json).
   Never eyeball the screenshot for sizes, spacing, or color.
2. Load the frame's EXACT fonts into Takumi `fonts` and match `fontFamily` to the font
   name. Fix fonts before touching any spacing.
3. Scaffold first (scripts/scaffold.mjs): Auto Layout → flex/gap/padding, absolute only for
   overlays. Then refine WITHOUT moving pixels: relax FIXED→HUG/FILL where content is dynamic
   so it reflows. `display: "flex"` on every container. It's a fixed canvas: no responsiveness,
   so author with normal flex/gap/padding — NOT absolute coordinates (those break on real data).
4. No hardcoded hex, no magic numbers — only tokens and real node values.
5. Reuse existing Takumi components / Code Connect mappings; name components from Figma
   layers; don't re-author markup that already exists.
6. Render with Takumi at the EXACT frame pixel size (× export scale). Verify ONLY via
   Takumi + these scripts — no external screenshot tool.
7. MANDATORY verify gate: run scripts/visual-diff.mjs. If a region is ambiguous, run
   scripts/measure-probe.mjs for that subtree. Change ONE value per iteration, then
   re-render and re-diff. You are NOT done until mismatch ≤ the threshold.
8. Report the final mismatch ratio and the regions you could not close, with the reason.
```

## Scripts

Live in [`scripts/`](../scripts) — vendor them into the target repo so they resolve
`takumi-js`, `pixelmatch`, and `pngjs` from the project. See [scripts/README.md](../scripts/README.md).
**The render and all verification are Takumi-only** — these scripts are the entire quality gate;
don't reach for an external screenshot/diff tool.

| Script | Does | Deps |
| ------ | ---- | ---- |
| `figma-pull.mjs` | Figma REST → `figma.png` reference + flattened `spec.json` (boxes, layout, styles, fonts, gradient angles) + downloaded image-fill assets | none (`fetch`) |
| `fonts-fetch.mjs` | Download the spec's fonts from Google Fonts into a dir (best-effort; lists non-OSS fonts to supply by hand) | none (`fetch`) |
| `scaffold.mjs` | `spec.json` → first-pass component: Auto Layout → flex/gap/padding, sizing HUG/FILL/FIXED, real `<img>` + gradients, absolute only for overlays | none |
| `render.mjs` | **One-command loop driver** (Bun): render the component at exact px with the frame's fonts + images, optional inline `--diff` | `takumi-js` (+ `pixelmatch`/`pngjs` for `--diff`) |
| `visual-diff.mjs` | Pixel-diff render vs reference → ratio, ASCII heatmap, hotspot rects, diff PNG; non-zero exit over threshold. Importable (`compare`/`formatReport`) | `pixelmatch`, `pngjs` |
| `measure-probe.mjs` | Geometry x-ray: one `measure()` call prints every node's absolute `x,y` + `w×h` (labeled with text) to compare against `spec.json` (Bun) | `takumi-js` |

## Upstream-leverage note

`measure()` already returns the full layout tree (per-node `width`/`height` + `transform`), so
the numeric check is one call — `measure-probe` walks it; no per-subtree probing needed. The one
rough edge: measured nodes are **anonymous** (no `id`/`tagName`), so mapping a measured box back
to a specific design node is positional. Exposing `id`/`tagName` on `MeasuredNode` would let
`measure-probe` auto-diff against Figma node `id`s — a clean upstream ask
(https://github.com/kane50613/takumi/issues).

## Figma → Takumi/CSS cheat-sheet

| Figma | Takumi / CSS |
| ----- | ------------ |
| Auto Layout, vertical | `display: "flex"; flexDirection: "column"` |
| Auto Layout, horizontal | `display: "flex"; flexDirection: "row"` |
| Auto Layout **off** | `position: "absolute"; left; top` (parent `position: "relative"`) |
| Item spacing (gap) | `gap` |
| Padding L/T/R/B | `padding` / `paddingLeft`… |
| Primary axis: `SPACE_BETWEEN` / `CENTER` / `MIN` / `MAX` | `justifyContent: space-between / center / flex-start / flex-end` |
| Counter axis: `CENTER` / `MIN` / `MAX` | `alignItems: center / flex-start / flex-end` |
| Sizing: Fixed | explicit `width` / `height` |
| Sizing: Hug | omit size (content-driven) |
| Sizing: Fill | `flex: 1` (along axis) / `width: "100%"` |
| Corner radius | `borderRadius` |
| Fill: solid | `backgroundColor` (rgba incl. fill opacity) |
| Fill: gradient | `backgroundImage: "linear-gradient(...)"` |
| Fill: image | `<img>` or `backgroundImage: "url(...)"` |
| Stroke | `border` / `borderColor` / `borderWidth` |
| Effect: drop shadow | `boxShadow` |
| Effect: layer blur | `filter: "blur(Npx)"` |
| Effect: background blur | `backdropFilter: "blur(Npx)"` |
| Opacity | `opacity` |
| Rotation | `transform: "rotate(Ndeg)"` |
| Text: font / size | `fontFamily` (must be loaded) / `fontSize` |
| Text: line height (px) | `lineHeight` (px value) |
| Text: letter spacing | `letterSpacing` |
| Text: align | `textAlign` |
| Text: truncate (N lines) | `lineClamp: N; textOverflow: "ellipsis"` |
| Text: case | `textTransform` |

Authoritative style surface: https://takumi.kane.tw/docs/reference.md (large, fetch on demand).
</content>
</invoke>
