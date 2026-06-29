#!/usr/bin/env bun
// measure-probe.mjs — geometry x-ray for the pixel-perfect loop.
//
// Renders the component's layout with Takumi `measure()` (no pixels) and prints the computed
// box + absolute position of EVERY node, labeled with its text/tag. One call gives you the whole
// geometry tree — compare any node's x,y,w,h against the Figma `spec.json` numbers to find which
// value is wrong, instead of eyeballing the diff.
//
// `measure()` returns a tree of { width, height, transform, children }; transform[4],[5] are the
// node's x,y within its parent — this script accumulates them into absolute coords (relative to
// the card origin), matching Figma's frame-local boxes.
//
// Run with Bun, from the TARGET repo (so `takumi-js` resolves from its node_modules and the
// component's JSX runtime resolves). The component must live inside the project tree.
//
// Usage:
//   bun measure-probe.mjs --component ./Card.tsx --spec .figma/spec.json [--fonts .figma/fonts]
//   bun measure-probe.mjs --component ./Card.tsx --width 1200 --height 630

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    component: { type: "string" },
    spec: { type: "string" },
    fonts: { type: "string" },
    images: { type: "string" },
    width: { type: "string" },
    height: { type: "string" },
  },
});

if (!values.component) fail("Usage: bun measure-probe.mjs --component ./Card.tsx --spec .figma/spec.json");

let width = values.width ? Number(values.width) : undefined;
let height = values.height ? Number(values.height) : undefined;
if (values.spec) {
  const spec = JSON.parse(readFileSync(values.spec, "utf8"));
  width ??= spec.renderPx?.width;
  height ??= spec.renderPx?.height;
}
if (!width || !height) fail("Need dimensions: pass --spec (with renderPx) or --width/--height.");

const { Renderer } = await import("takumi-js/node");
const { fromJsx } = await import("takumi-js/helpers/jsx");

const fonts = loadDir(values.fonts, (f) =>
  [".ttf", ".otf", ".woff", ".woff2"].includes(extname(f).toLowerCase()),
).map((e) => e.data);
const persistentImages = loadDir(values.images).map(({ name, data }) => ({ src: name, data }));

const mod = await import(pathToFileURL(resolve(process.cwd(), values.component)).href);
const d = mod.default ?? mod;
const element = typeof d === "function" ? d() : d;
if (!element || typeof element !== "object") fail("--component must export a Takumi element or zero-arg component.");

// NB: an empty `fonts: []` DISABLES the embedded default font (text measures 0×0). Omit when empty.
const rendererOpts = {};
if (fonts.length) rendererOpts.fonts = fonts;
if (persistentImages.length) rendererOpts.persistentImages = persistentImages;
const renderer = new Renderer(rendererOpts);
const { node, stylesheets } = await fromJsx(element);
const measured = await renderer.measure(node, { width, height, stylesheets });

// Labels: the measured tree wraps text nodes (text → node + run child) and `fromJsx` collapses
// single-text divs, so its shape differs from the input tree. Don't zip by position — instead
// collect input text strings in DFS order and hand them to measured text nodes (those with runs)
// in the same order.
const texts = [];
(function collect(n) {
  if (n?.text != null) texts.push(n.text);
  (n?.children ?? []).forEach(collect);
})(node);
let ti = 0;

console.log(`measured geometry (x,y absolute · w×h) — ${width}×${height}\n`);
walk(measured, 0, 0, 0);

// -----------------------------------------------------------------------------
function isTextLeaf(m) {
  if (m.runs?.length > 0) return true;
  const only = m.children?.length === 1 ? m.children[0] : null;
  return !!(only && only.runs?.length > 0 && (only.children?.length ?? 0) === 0);
}

function walk(m, depth, ax, ay) {
  const x = round(ax + (m.transform?.[4] ?? 0));
  const y = round(ay + (m.transform?.[5] ?? 0));
  const textLeaf = isTextLeaf(m);
  const label = textLeaf ? (ti < texts.length ? JSON.stringify(texts[ti++]) : '"text"') : "box";
  const coord = `${x},${y}`.padEnd(11);
  const size = `${round(m.width)}×${round(m.height)}`.padEnd(11);
  console.log(`${"  ".repeat(depth)}${coord} ${size} ${label}`);
  if (!textLeaf) for (const c of m.children ?? []) walk(c, depth + 1, x, y);
}

function loadDir(dir, filter = () => true) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(filter)
    .map((name) => {
      const buf = readFileSync(join(dir, name));
      return { name, data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    });
}
function round(n) {
  return Math.round((n ?? 0) * 10) / 10;
}
function fail(m) {
  console.error(`measure-probe: ${m}`);
  process.exit(1);
}
