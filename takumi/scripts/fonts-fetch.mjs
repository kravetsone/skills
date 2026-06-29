#!/usr/bin/env node
// fonts-fetch.mjs — best-effort download of a spec's fonts from Google Fonts into a dir, so
// render.mjs can load them. Fonts are THE biggest pixel-perfect determinant: wrong or missing
// fonts shift every line (metrics drift) or render tofu. Match the frame's families/weights
// EXACTLY.
//
// Works only for families published on Google Fonts. For licensed/custom fonts it lists which
// ones you must supply by hand (drop the files into the same --out dir).
//
// Usage:  node fonts-fetch.mjs .figma/spec.json [--out .figma/fonts]
// No third-party deps. Node 18+ or Bun.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: "string", default: ".figma/fonts" } },
});

const specPath = positionals[0];
if (!specPath) fail("Usage: fonts-fetch.mjs .figma/spec.json [--out .figma/fonts]");

const spec = JSON.parse(readFileSync(specPath, "utf8"));
const fonts = spec.fonts || [];
if (!fonts.length) {
  console.log("No fonts in spec.");
  process.exit(0);
}
mkdirSync(values.out, { recursive: true });

// Group weights per family.
const byFamily = new Map();
for (const f of fonts) {
  const set = byFamily.get(f.family) ?? new Set();
  if (f.weight) set.add(f.weight);
  byFamily.set(f.family, set);
}

const missing = [];
for (const [family, weightsSet] of byFamily) {
  const weights = [...weightsSet].sort((a, b) => a - b);
  const wspec = weights.length ? `:wght@${weights.join(";")}` : "";
  const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(
    /%20/g,
    "+",
  )}${wspec}&display=swap`;
  try {
    // A modern UA makes Google return woff2; without it you may get ttf. Either works in Takumi.
    const css = await (await fetch(cssUrl, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
    // css2 returns one @font-face per (weight × unicode-range subset). Keep all subsets (unique
    // filenames) so glyph coverage is complete; Takumi merges them by the font's internal name.
    let got = 0;
    for (const face of css.split("@font-face").slice(1)) {
      const wm = face.match(/font-weight:\s*(\d+)/);
      const um = face.match(/src:\s*url\(([^)]+)\)\s*format\(['"]?(woff2|truetype|opentype)['"]?\)/);
      if (!um) continue;
      const weight = wm ? wm[1] : "400";
      const ext = um[2] === "woff2" ? "woff2" : um[2] === "opentype" ? "otf" : "ttf";
      const buf = Buffer.from(await (await fetch(um[1])).arrayBuffer());
      writeFileSync(join(values.out, `${family.replace(/\s+/g, "")}-${weight}-${got}.${ext}`), buf);
      got++;
    }
    if (got) console.log(`✓ ${family} [${weights.join(", ") || "400"}]: ${got} file(s)`);
    else missing.push(family);
  } catch {
    missing.push(family);
  }
}

if (missing.length) {
  console.warn(`\n! Not on Google Fonts — supply these manually into ${values.out}/ :`);
  for (const m of missing) console.warn(`    • ${m}`);
}
console.log(`\nfonts in ${values.out}/  →  bun render.mjs --fonts ${values.out} ...`);

function fail(m) {
  console.error(`fonts-fetch: ${m}`);
  process.exit(1);
}
