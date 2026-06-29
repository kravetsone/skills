#!/usr/bin/env node
// figma-pull.mjs — pull a Figma node's reference export + a flattened, agent-friendly spec.
//
// Produces, in --out (default ./.figma):
//   figma.png   the node rendered by Figma at --scale  (the pixel-perfect reference)
//   node.json   the raw Figma node subtree (full fidelity)
//   spec.json   flattened: per-node box+layout+style+text, plus the set of fonts used
//
// The spec is what you feed the agent: REAL values (px, hex, font names), not a screenshot
// to eyeball. See references/figma-pixel-perfect.md.
//
// Usage:
//   FIGMA_TOKEN=figd_xxx node figma-pull.mjs --url "https://www.figma.com/design/<key>/Name?node-id=1-2"
//   FIGMA_TOKEN=figd_xxx node figma-pull.mjs --file <fileKey> --node 1:2 [--scale 2] [--out ./.figma]
//
// Token: a Figma personal access token (Settings → Security) with file_content + file_dev_resources
// read scope, or any token that can read the file. Runs on Node 18+ or Bun (global fetch, no deps).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    file: { type: "string" },
    node: { type: "string" },
    scale: { type: "string", default: "2" },
    out: { type: "string", default: "./.figma" },
  },
});

const token = process.env.FIGMA_TOKEN;
if (!token) fail("Set FIGMA_TOKEN (Figma personal access token).");

let fileKey = values.file;
let nodeId = values.node;

if (values.url) {
  // .../design/<key>/<name>?node-id=1-2   (also /file/<key>/...)
  const m = values.url.match(/\/(?:design|file)\/([a-zA-Z0-9]+)/);
  if (m) fileKey = m[1];
  const q = values.url.match(/[?&]node-id=([^&]+)/);
  if (q) nodeId = decodeURIComponent(q[1]);
}

if (!fileKey || !nodeId) fail("Provide --url, or both --file <key> and --node <id>.");

// Figma URLs encode node ids as "1-2"; the REST API wants "1:2".
const apiNodeId = nodeId.includes(":") ? nodeId : nodeId.replace(/-/g, ":");
const scale = Number(values.scale) || 1;
const outDir = values.out;
mkdirSync(outDir, { recursive: true });

const api = (path) =>
  fetch(`https://api.figma.com/v1${path}`, { headers: { "X-Figma-Token": token } }).then(
    async (r) => {
      if (!r.ok) fail(`Figma API ${r.status} on ${path}: ${(await r.text()).slice(0, 300)}`);
      return r.json();
    },
  );

// 1. Node subtree --------------------------------------------------------------
const nodesRes = await api(
  `/files/${fileKey}/nodes?ids=${encodeURIComponent(apiNodeId)}&geometry=paths`,
);
const root = nodesRes.nodes?.[apiNodeId]?.document;
if (!root) fail(`Node ${apiNodeId} not found in file ${fileKey}.`);
writeFileSync(join(outDir, "node.json"), JSON.stringify(root, null, 2));

// 2. PNG export ----------------------------------------------------------------
const imgRes = await api(
  `/images/${fileKey}?ids=${encodeURIComponent(apiNodeId)}&format=png&scale=${scale}`,
);
const imgUrl = imgRes.images?.[apiNodeId];
if (!imgUrl) fail("Figma returned no image URL (is the node renderable?).");
const png = Buffer.from(await (await fetch(imgUrl)).arrayBuffer());
writeFileSync(join(outDir, "figma.png"), png);

// 3. Flattened spec ------------------------------------------------------------
const originX = root.absoluteBoundingBox?.x ?? 0;
const originY = root.absoluteBoundingBox?.y ?? 0;
const fonts = new Map(); // "Family|weight|postscript" -> {family, weight, postscript, styles:Set}
const imageRefs = new Set(); // image-fill refs collected while flattening
const rasterTargets = new Map(); // node id -> spec node, for vector/instance leaves to export as PNG
const frameArea = (root.absoluteBoundingBox?.width ?? 0) * (root.absoluteBoundingBox?.height ?? 0);
// Node types that are opaque graphics with no reconstructable structure — export them as a PNG.
// Declared here (above the flatten() call below) so it's initialized before isRasterLeaf runs.
const RASTER_TYPES = new Set([
  "VECTOR", "BOOLEAN_OPERATION", "LINE", "REGULAR_POLYGON", "STAR", "INSTANCE", "COMPONENT",
]);

const spec = flatten(root);

// 4. Image fills ---------------------------------------------------------------
// Download the actual asset bytes for every image fill, keyed by ref, so the scaffold can emit
// real <img> and render.mjs can register them as persistentImages (key = filename). Without
// the assets the diff is permanently red wherever art/icons/photos are.
const images = {};
if (imageRefs.size) {
  const fillsRes = await api(`/files/${fileKey}/images`);
  const map = fillsRes.images || fillsRes.meta?.images || {};
  const imgDir = join(outDir, "images");
  mkdirSync(imgDir, { recursive: true });
  for (const ref of imageRefs) {
    const url = map[ref];
    if (!url) {
      console.warn(`  ! no URL for image fill ${ref}`);
      continue;
    }
    try {
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
      const file = `${ref.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`;
      writeFileSync(join(imgDir, file), buf);
      images[ref] = `images/${file}`;
    } catch (e) {
      console.warn(`  ! failed to download image ${ref}: ${e.message}`);
    }
  }
}

// 5. Rasterized vector/instance leaves -----------------------------------------
// Component instances and vectors (icon frames, rating stars, decorative glyphs) aren't image
// FILLS, so the asset endpoint above can't return them — and they can't be rebuilt from the node
// JSON either. Export each as its own PNG via the node /images endpoint at the frame scale, so the
// scaffold can emit a real <img>. Without this they render blank/wrong (the constellation frames,
// weapon-rarity stars, etc.).
let rasterCount = 0;
if (rasterTargets.size) {
  const ids = [...rasterTargets.keys()];
  const imgDir = join(outDir, "images");
  mkdirSync(imgDir, { recursive: true });
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50); // /images takes many ids per call; chunk to bound URL length
    const res = await api(
      `/images/${fileKey}?ids=${encodeURIComponent(chunk.join(","))}&format=png&scale=${scale}`,
    );
    const map = res.images || {};
    for (const id of chunk) {
      const url = map[id];
      if (!url) {
        console.warn(`  ! no raster URL for node ${id}`);
        continue;
      }
      try {
        const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
        const file = `node_${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`;
        writeFileSync(join(imgDir, file), buf);
        rasterTargets.get(id).raster = `images/${file}`;
        rasterCount++;
      } catch (e) {
        console.warn(`  ! failed to rasterize node ${id}: ${e.message}`);
      }
    }
  }
  // Any that failed to export: drop the placeholder so the scaffold falls back to normal handling.
  for (const node of rasterTargets.values()) if (node.raster === true) delete node.raster;
}

writeFileSync(
  join(outDir, "spec.json"),
  JSON.stringify(
    {
      file: fileKey,
      node: apiNodeId,
      scale,
      frame: round(root.absoluteBoundingBox),
      renderPx: {
        width: Math.round((root.absoluteBoundingBox?.width ?? 0) * scale),
        height: Math.round((root.absoluteBoundingBox?.height ?? 0) * scale),
      },
      fonts: [...fonts.values()].map((f) => ({ ...f, styles: [...f.styles] })),
      images,
      tree: spec,
    },
    null,
    2,
  ),
);

console.log(`✓ ${join(outDir, "figma.png")}  (${png.length} bytes, scale ${scale}×)`);
console.log(`✓ ${join(outDir, "node.json")}`);
console.log(`✓ ${join(outDir, "spec.json")}`);
console.log(
  `  frame ${Math.round(root.absoluteBoundingBox?.width)}×${Math.round(
    root.absoluteBoundingBox?.height,
  )}  →  render at ${Math.round((root.absoluteBoundingBox?.width ?? 0) * scale)}×${Math.round(
    (root.absoluteBoundingBox?.height ?? 0) * scale,
  )} px`,
);
if (fonts.size) {
  console.log("  fonts to load into Takumi:");
  for (const f of fonts.values())
    console.log(`    • ${f.family} ${[...f.styles].join("/")}  (${f.postscript})`);
}
if (Object.keys(images).length)
  console.log(`  ${Object.keys(images).length} image fill(s) → ${join(outDir, "images")}/`);
if (rasterCount)
  console.log(`  ${rasterCount} vector/instance leaf/leaves rasterized → ${join(outDir, "images")}/node_*.png`);

// -----------------------------------------------------------------------------
function flatten(n) {
  // Hidden Figma layers (visibility toggled off) aren't painted in the export — skip them so they
  // can't appear in the spec/scaffold (a hidden full-canvas vector would otherwise overpaint
  // everything). Returning null here also keeps their fonts/image fills out of the collected sets.
  if (n.visible === false) return null;

  const box = n.absoluteBoundingBox
    ? {
        x: round1(n.absoluteBoundingBox.x - originX),
        y: round1(n.absoluteBoundingBox.y - originY),
        w: round1(n.absoluteBoundingBox.width),
        h: round1(n.absoluteBoundingBox.height),
      }
    : undefined;

  const out = { id: n.id, name: n.name, type: n.type };
  if (box) out.box = box;
  if (n.opacity != null && n.opacity !== 1) out.opacity = round1(n.opacity);
  if (n.cornerRadius != null) out.borderRadius = n.cornerRadius;
  if (Array.isArray(n.rectangleCornerRadii)) out.borderRadius = n.rectangleCornerRadii;

  // Auto Layout
  if (n.layoutMode && n.layoutMode !== "NONE") {
    out.layout = {
      direction: n.layoutMode === "VERTICAL" ? "column" : "row",
      gap: n.itemSpacing ?? 0,
      padding: {
        top: n.paddingTop ?? 0,
        right: n.paddingRight ?? 0,
        bottom: n.paddingBottom ?? 0,
        left: n.paddingLeft ?? 0,
      },
      primaryAxis: n.primaryAxisAlignItems ?? "MIN",
      counterAxis: n.counterAxisAlignItems ?? "MIN",
    };
  }
  if (n.layoutPositioning === "ABSOLUTE") out.absolute = true;
  // How this node sizes inside its Auto Layout parent: FIXED | HUG | FILL.
  // Drives flex sizing in the scaffold so dynamic content reflows (HUG/FILL) instead of
  // being pinned to one example's px (FIXED).
  if (n.layoutSizingHorizontal || n.layoutSizingVertical)
    out.sizing = { h: n.layoutSizingHorizontal, v: n.layoutSizingVertical };
  if (n.layoutGrow) out.grow = n.layoutGrow;
  if (n.layoutAlign === "STRETCH") out.stretch = true;
  if (n.rotation) out.rotation = round1((n.rotation * 180) / Math.PI);

  // Vector/instance leaf with no text and no image fill → can't be reconstructed from JSON; export
  // it as its own PNG (below) and treat it as an opaque <img>. Keep box/sizing/rotation already set.
  if (isRasterLeaf(n, frameArea)) {
    out.raster = true; // placeholder; replaced with the exported PNG path after the batch /images call
    rasterTargets.set(n.id, out);
    return out;
  }

  const fills = paints(n.fills, n.absoluteBoundingBox, imageRefs);
  if (fills) out.fills = fills;
  const strokes = paints(n.strokes, n.absoluteBoundingBox);
  if (strokes) out.strokes = { paints: strokes, weight: n.strokeWeight };
  const effects = readEffects(n.effects);
  if (effects) out.effects = effects;

  if (n.type === "TEXT") {
    const s = n.style ?? {};
    out.text = {
      characters: n.characters,
      fontFamily: s.fontFamily,
      fontPostScriptName: s.fontPostScriptName,
      fontWeight: s.fontWeight,
      fontSize: s.fontSize,
      lineHeightPx: s.lineHeightPx != null ? round1(s.lineHeightPx) : undefined,
      letterSpacing: s.letterSpacing != null ? round1(s.letterSpacing) : undefined,
      textAlign: s.textAlignHorizontal,
      textCase: s.textCase,
    };
    if (s.fontFamily) {
      const key = `${s.fontFamily}|${s.fontWeight}|${s.fontPostScriptName}`;
      const rec =
        fonts.get(key) ??
        { family: s.fontFamily, weight: s.fontWeight, postscript: s.fontPostScriptName, styles: new Set() };
      rec.styles.add(s.fontPostScriptName?.split("-")[1] ?? String(s.fontWeight ?? ""));
      fonts.set(key, rec);
    }
  }

  if (Array.isArray(n.children) && n.children.length) {
    const kids = n.children.map(flatten).filter(Boolean);
    if (kids.length) out.children = kids;
  }

  return out;
}

function hasTextDescendant(n) {
  if (n.type === "TEXT" && (n.characters ?? "").trim()) return true;
  return (n.children ?? []).some(hasTextDescendant);
}

// Should this node be exported as a flat PNG rather than reconstructed? A vector graphic or
// component instance with no text to keep, not already an image fill, and not background-sized
// (large nodes are real backgrounds and belong as image fills / divs). Captures icon frames,
// rating stars, decorative glyphs — and crucially keeps text-bearing instances (e.g. ">" chevrons)
// live so their text still renders.
function isRasterLeaf(n, frameArea) {
  if (n.visible === false) return false;
  if (!RASTER_TYPES.has(n.type)) return false;
  if (hasTextDescendant(n)) return false;
  if ((n.fills ?? []).some((f) => f.type === "IMAGE")) return false;
  const b = n.absoluteBoundingBox;
  if (b && frameArea && b.width * b.height > 0.2 * frameArea) return false;
  return true;
}

function paints(arr, box, refs) {
  if (!Array.isArray(arr) || !arr.length) return undefined;
  const out = arr
    .filter((p) => p.visible !== false)
    .map((p) => {
      if (p.type === "SOLID") return { type: "solid", color: rgba(p.color, p.opacity) };
      if (p.type?.startsWith("GRADIENT")) {
        const g = {
          type: p.type.toLowerCase(),
          stops: (p.gradientStops ?? []).map((s) => ({ color: rgba(s.color, 1), pos: round1(s.position) })),
        };
        if (p.type === "GRADIENT_LINEAR") g.angle = cssAngle(p.gradientHandlePositions, box?.width, box?.height);
        return g;
      }
      if (p.type === "IMAGE") {
        if (p.imageRef) refs?.add(p.imageRef);
        return { type: "image", imageRef: p.imageRef, scaleMode: p.scaleMode };
      }
      return { type: p.type };
    });
  return out.length ? out : undefined;
}

// CSS gradient angle from Figma's normalized handle positions (start→end), scaled by the box
// aspect so the visual direction matches. CSS 0deg = up, clockwise; Figma y is down.
function cssAngle(handles, w, h) {
  if (!Array.isArray(handles) || handles.length < 2 || !w || !h) return undefined;
  const dx = (handles[1].x - handles[0].x) * w;
  const dy = (handles[1].y - handles[0].y) * h;
  const a = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return Math.round(((a % 360) + 360) % 360);
}

function readEffects(arr) {
  if (!Array.isArray(arr) || !arr.length) return undefined;
  const out = arr
    .filter((e) => e.visible !== false)
    .map((e) => {
      if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW")
        return {
          type: e.type === "INNER_SHADOW" ? "inner-shadow" : "drop-shadow",
          color: rgba(e.color, 1),
          x: e.offset?.x ?? 0,
          y: e.offset?.y ?? 0,
          blur: e.radius ?? 0,
          spread: e.spread ?? 0,
        };
      if (e.type === "LAYER_BLUR") return { type: "blur", radius: e.radius };
      if (e.type === "BACKGROUND_BLUR") return { type: "backdrop-blur", radius: e.radius };
      return { type: e.type };
    });
  return out.length ? out : undefined;
}

function rgba(c, opacity = 1) {
  if (!c) return undefined;
  const a = round1((c.a ?? 1) * (opacity ?? 1));
  const to255 = (v) => Math.round((v ?? 0) * 255);
  return a >= 1
    ? `#${[c.r, c.g, c.b].map((v) => to255(v).toString(16).padStart(2, "0")).join("")}`
    : `rgba(${to255(c.r)}, ${to255(c.g)}, ${to255(c.b)}, ${a})`;
}

function round(b) {
  return b ? { x: round1(b.x), y: round1(b.y), w: round1(b.width), h: round1(b.height) } : undefined;
}
// NB: function declaration (hoisted) — `flatten` runs at module top-level before a `const`
// arrow would be initialized, so a const here throws "Cannot access 'round1' before initialization".
function round1(n) {
  return n == null ? n : Math.round(n * 100) / 100;
}

function fail(msg) {
  console.error(`figma-pull: ${msg}`);
  process.exit(1);
}
