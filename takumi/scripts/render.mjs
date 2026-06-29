#!/usr/bin/env bun
// render.mjs — the one-command loop driver: render a Takumi component at the EXACT Figma size,
// with the frame's fonts and image assets, and optionally diff it against the reference.
//
// This closes the verify loop: edit component → `bun render.mjs ... --diff` → read mismatch% +
// hotspots → fix one value → repeat. Verification is Takumi + visual-diff only.
//
// Run with Bun, from the TARGET repo (so `takumi-js` resolves from its node_modules).
//
// Usage:
//   bun render.mjs --component ./Card.tsx --spec .figma/spec.json \
//     --fonts .figma/fonts --images .figma/images \
//     --out render.png --diff .figma/figma.png --max-ratio 0.01
//
//   --component  module that default-exports a Takumi element OR a zero-arg component.
//   --spec       supplies width/height from renderPx (or pass --width/--height).
//   --fonts      dir; every .ttf/.otf/.woff/.woff2 in it is loaded into the Renderer.
//   --images     dir; every file is registered as a persistentImage keyed by its FILENAME,
//                matching the `src` keys scaffold.mjs emits for <img>.
//   --diff       Figma reference PNG; when set, runs visual-diff and exits non-zero on fail.

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
    out: { type: "string", default: "render.png" },
    width: { type: "string" },
    height: { type: "string" },
    diff: { type: "string" },
    threshold: { type: "string", default: "0.1" },
    "max-ratio": { type: "string", default: "0.01" },
  },
});

if (!values.component)
  fail("Usage: bun render.mjs --component ./Card.tsx [--spec .figma/spec.json] [--diff .figma/figma.png]");

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
const picked = pickComponent(mod);
const element = typeof picked === "function" ? picked() : picked;
if (!element || typeof element !== "object")
  fail(`--component ${values.component} must export (default OR a single named) a Takumi element or zero-arg component.`);

// NB: an empty `fonts: []` DISABLES the embedded default font (text → blank). Omit when empty.
const rendererOpts = {};
if (fonts.length) rendererOpts.fonts = fonts;
if (persistentImages.length) rendererOpts.persistentImages = persistentImages;
const renderer = new Renderer(rendererOpts);
const { node, stylesheets } = await fromJsx(element);
const png = await renderer.render(node, { width, height, format: "png", stylesheets });
await Bun.write(values.out, png);
console.log(`✓ ${values.out}  (${width}×${height}, ${fonts.length} font(s), ${persistentImages.length} image(s))`);

if (values.diff) {
  const { compare, formatReport } = await import(
    pathToFileURL(resolve(import.meta.dir, "visual-diff.mjs")).href
  );
  const r = await compare({
    actual: values.out,
    expected: values.diff,
    threshold: Number(values.threshold),
    maxRatio: Number(values["max-ratio"]),
  });
  console.log("\n" + formatReport(r));
  if (!r.pass) process.exit(1);
}

// -----------------------------------------------------------------------------
// Accept a default export OR a single named export — scaffold.mjs emits a named component, and
// `mod.default ?? mod` would otherwise hand fromJsx the whole module namespace ("No default value").
function pickComponent(mod) {
  if (mod.default !== undefined) return mod.default;
  const fns = Object.values(mod).filter((v) => typeof v === "function");
  if (fns.length === 1) return fns[0];
  const objs = Object.values(mod).filter((v) => v && typeof v === "object");
  if (!fns.length && objs.length === 1) return objs[0];
  return mod; // falls through to the clear type-check error below
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
function fail(m) {
  console.error(`render: ${m}`);
  process.exit(1);
}
