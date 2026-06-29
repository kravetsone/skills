#!/usr/bin/env node
// scaffold.mjs — turn a Figma spec.json into a first-pass Takumi component with EXACT geometry.
//
// Why: a fixed-size image has no responsiveness, so the fastest path to pixel-perfect is to
// transcribe Figma's real per-node boxes into absolute-positioned layout — geometry is then
// correct on the FIRST render, and the agent only has to fight styling. The output is a
// deliberately "ugly but exact" scaffold: a geometry oracle to refine into clean, semantic
// flex (Auto Layout) while scripts/visual-diff.mjs keeps the pixels honest.
//
// This does NOT replace authoring — it bootstraps it. See references/figma-pixel-perfect.md
// ("Authoring beautifully") for the refactor pattern.
//
// Usage:
//   node scaffold.mjs .figma/spec.json [--out FigmaCard.tsx] [--name FigmaCard]
//
// No third-party deps (Node 18+ or Bun). Reads spec.json produced by figma-pull.mjs.

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: "string" }, name: { type: "string" } },
});

const specPath = positionals[0];
if (!specPath) fail("Usage: scaffold.mjs .figma/spec.json [--out File.tsx] [--name Comp]");

const spec = JSON.parse(readFileSync(specPath, "utf8"));
const root = spec.tree;
if (!root) fail("spec.json has no `tree`. Re-run figma-pull.mjs.");
const IMAGES = spec.images || {}; // imageRef -> relative file path (downloaded by figma-pull)

const compName = values.name || pascal(root.name) || "FigmaCard";
const W = spec.renderPx?.width ?? Math.round(root.box?.w ?? 0);
const H = spec.renderPx?.height ?? Math.round(root.box?.h ?? 0);

const body = emit(root, null, 3);

const fontLines = (spec.fonts ?? [])
  .map((f) => `//   • ${f.family} ${(f.styles || []).join("/")}  (${f.postscript})`)
  .join("\n");

const out = `// AUTO-GENERATED first-pass scaffold from ${specPath}.
// Auto Layout → flex (gap/padding/align) where Figma used it; absolute ONLY for free-form or
// overlay nodes. Sizes follow Figma: HUG→omit, FILL→flex:1, FIXED→px. Values are real.
// Refine toward the final component:
//   1. Where data is dynamic (names, counts, numbers), prefer HUG/FILL over FIXED so it reflows.
//   2. Extract repeated colors/sizes into a tokens module; drop the literals.
//   3. Split logical units into components; pass dynamic data as props.
//   4. Keep scripts/visual-diff.mjs green after every change — edits must not move pixels.
// See references/figma-pixel-perfect.md.
//
// Fonts the frame uses — load these EXACT families/weights into the Renderer (no system fonts):
${fontLines || "//   (no text nodes detected)"}

import { Renderer } from "takumi-js/node";
import { fromJsx } from "takumi-js/helpers/jsx";

export function ${compName}() {
  return (
${body}
  );
}

// Render at the EXACT Figma pixel size (frame ${Math.round(root.box?.w ?? 0)}×${Math.round(
  root.box?.h ?? 0,
)} × ${spec.scale ?? 1} export scale):
// const renderer = new Renderer({ fonts: [/* the fonts listed above, as ArrayBuffers */] });
// const { node, stylesheets } = await fromJsx(<${compName} />);
// const png = await renderer.render(node, { width: ${W}, height: ${H}, format: "png", stylesheets });
// await Bun.write("render.png", png);
// → then: node scripts/visual-diff.mjs --actual render.png --expected ${dir(specPath)}/figma.png
`;

const outPath = values.out || `${compName}.tsx`;
writeFileSync(outPath, out);
console.log(`✓ ${outPath}  (${compName}, ${W}×${H}px, ${countNodes(root)} nodes)`);
console.log(`  next: refine into semantic flex, then diff with scripts/visual-diff.mjs`);

// -----------------------------------------------------------------------------
function emit(node, parent, indent) {
  const pad = "  ".repeat(indent);
  const isText = node.type === "TEXT";
  const isImage = node.type === "IMAGE" || node.fills?.some((f) => f.type === "image");
  const style = styleFor(node, parent);
  const styleStr = styleToJsx(style);
  const comment = ` {/* ${node.type} · ${node.name} */}`;

  if (isImage) {
    const ref = node.fills?.find((f) => f.type === "image")?.imageRef ?? "";
    const rel = IMAGES[ref];
    if (rel) {
      const key = rel.split("/").pop(); // persistentImages key = filename; render.mjs registers by basename
      return `${pad}<img src=${JSON.stringify(key)} style={${styleStr}} />${comment}`;
    }
    return `${pad}{/* TODO image — imageRef=${ref}; no asset downloaded, supply src or a persistentImages key */}
${pad}<div style={${styleStr}} />${comment}`;
  }

  if (isText) {
    const text = node.text?.characters ?? "";
    return `${pad}<div style={${styleStr}}>{${JSON.stringify(text)}}</div>${comment}`;
  }

  const children = node.children ?? [];
  if (!children.length) return `${pad}<div style={${styleStr}} />${comment}`;

  const inner = children.map((c) => emit(c, node, indent + 1)).join("\n");
  return `${pad}<div style={${styleStr}}>${comment}
${inner}
${pad}</div>`;
}

function styleFor(node, parent) {
  const s = {};
  const b = node.box;
  const isRoot = !parent;
  // Absolute only when Figma says so (overlay) or the parent has no Auto Layout (free-form frame).
  const isAbs = !isRoot && (node.absolute || !parent.layout);

  // 1) Placement within the parent
  if (isRoot) {
    if (b) {
      s.width = num(b.w);
      s.height = num(b.h);
    }
  } else if (isAbs && b && parent.box) {
    s.position = "absolute";
    s.left = num(b.x - parent.box.x);
    s.top = num(b.y - parent.box.y);
    s.width = num(b.w);
    s.height = num(b.h);
  } else if (b) {
    sizeFlowChild(s, node, parent, b); // flow child of an Auto Layout parent → HUG/FILL/FIXED
  }

  // 2) This node's own children layout (Auto Layout → flex), else a safe flex box
  if (node.layout) applyFlexContainer(s, node.layout);
  else s.display = "flex"; // #1 rule: containers/text need explicit display (v1 default is inline)

  // 3) Positioning context so any absolute descendants anchor to THIS node, not the root
  if ((node.children?.length ?? 0) > 0 && s.position !== "absolute") s.position = "relative";

  const solid = node.fills?.find((f) => f.type === "solid");
  const grad = node.fills?.find((f) => f.type?.startsWith("gradient"));

  if (node.type === "TEXT") {
    s.display = "flex";
    if (solid) s.color = solid.color;
    const t = node.text ?? {};
    if (t.fontFamily) s.fontFamily = t.fontFamily;
    if (t.fontWeight) s.fontWeight = t.fontWeight;
    if (t.fontSize) s.fontSize = t.fontSize;
    if (t.lineHeightPx) s.lineHeight = `${t.lineHeightPx}px`;
    if (t.letterSpacing) s.letterSpacing = t.letterSpacing;
    if (t.textAlign) s.textAlign = String(t.textAlign).toLowerCase();
    if (t.textCase && t.textCase !== "ORIGINAL")
      s.textTransform = { UPPER: "uppercase", LOWER: "lowercase", TITLE: "capitalize" }[t.textCase];
  } else {
    if (solid) s.backgroundColor = solid.color;
    if (grad) s.backgroundImage = gradientCss(grad);
  }

  if (node.borderRadius != null)
    s.borderRadius = Array.isArray(node.borderRadius) ? node.borderRadius.join("px ") + "px" : node.borderRadius;
  if (node.opacity != null) s.opacity = node.opacity;
  if (node.rotation) s.transform = `rotate(${node.rotation}deg)`;

  if (node.strokes?.paints?.length) {
    s.borderWidth = node.strokes.weight ?? 1;
    s.borderStyle = "solid";
    s.borderColor = node.strokes.paints[0].color;
  }

  const shadow = node.effects?.find((e) => e.type === "drop-shadow");
  if (shadow)
    s.boxShadow = `${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.spread || 0}px ${shadow.color}`;
  const blur = node.effects?.find((e) => e.type === "blur");
  if (blur) s.filter = `blur(${blur.radius}px)`;
  const bblur = node.effects?.find((e) => e.type === "backdrop-blur");
  if (bblur) s.backdropFilter = `blur(${bblur.radius}px)`;

  // overflow:hidden when corner radius clips children (common for cards/avatars)
  if ((node.children?.length ?? 0) > 0 && node.borderRadius) s.overflow = "hidden";

  return s;
}

function gradientCss(g) {
  const stops = (g.stops ?? []).map((s) => `${s.color} ${Math.round((s.pos ?? 0) * 100)}%`).join(", ");
  if (g.type === "gradient_radial") return `radial-gradient(circle, ${stops})`; // center/radius approx — verify
  return `linear-gradient(${g.angle ?? 180}deg, ${stops})`;
}

function applyFlexContainer(s, layout) {
  s.display = "flex";
  s.flexDirection = layout.direction; // "row" | "column"
  if (layout.gap) s.gap = layout.gap;
  const { top = 0, right = 0, bottom = 0, left = 0 } = layout.padding || {};
  if (top || right || bottom || left) {
    if (top === right && right === bottom && bottom === left) s.padding = top;
    else {
      if (top) s.paddingTop = top;
      if (right) s.paddingRight = right;
      if (bottom) s.paddingBottom = bottom;
      if (left) s.paddingLeft = left;
    }
  }
  const j = mapAlign(layout.primaryAxis);
  if (j) s.justifyContent = j;
  const a = mapAlign(layout.counterAxis);
  if (a) s.alignItems = a;
}

function sizeFlowChild(s, node, parent, b) {
  if (!node.sizing) {
    // No sizing info (e.g. context came from somewhere other than figma-pull) → keep the
    // exact box so geometry still matches; relax to HUG/FILL by hand if content is dynamic.
    s.width = num(b.w);
    s.height = num(b.h);
    return;
  }
  const dir = parent.layout?.direction; // main axis
  const axis = (sizing, isMain) => {
    if (sizing === "FILL") return isMain ? { flexGrow: 1, flexBasis: 0 } : { alignSelf: "stretch" };
    return undefined; // HUG → omit (content-driven)
  };
  // horizontal
  if (node.sizing.h === "FIXED") s.width = num(b.w);
  else Object.assign(s, axis(node.sizing.h, dir === "row") || {});
  // vertical
  if (node.sizing.v === "FIXED") s.height = num(b.h);
  else Object.assign(s, axis(node.sizing.v, dir === "column") || {});
  if (node.stretch && !s.alignSelf) s.alignSelf = "stretch";
}

function mapAlign(v) {
  return { CENTER: "center", MAX: "flex-end", SPACE_BETWEEN: "space-between", SPACE_AROUND: "space-around" }[
    v
  ]; // MIN → undefined (flex-start default, omit)
}

function styleToJsx(obj) {
  const entries = Object.entries(obj).map(([k, v]) => {
    const val = typeof v === "number" ? v : JSON.stringify(v);
    return `${k}: ${val}`;
  });
  return `{ ${entries.join(", ")} }`;
}

function num(n) {
  return Math.round((n ?? 0) * 100) / 100;
}
function dir(p) {
  return p.includes("/") ? p.replace(/\/[^/]*$/, "") || "/" : ".";
}
function pascal(s) {
  if (!s) return "";
  return s
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join("");
}
function countNodes(n) {
  return 1 + (n.children?.reduce((a, c) => a + countNodes(c), 0) ?? 0);
}
function fail(msg) {
  console.error(`scaffold: ${msg}`);
  process.exit(1);
}
