#!/usr/bin/env node
// visual-diff.mjs — the pixel-perfect verify gate.
//
// Pixel-diffs a Takumi render against a Figma reference export and reports:
//   • mismatch ratio (and raw pixel count)
//   • a coarse ASCII heatmap so an agent can LOCATE the error without pixel-by-pixel
//     spatial reasoning (the thing LLMs are worst at)
//   • the densest diff regions as x,y,w,h rects — point the agent at the value that owns them
//   • a diff PNG (red = differs, yellow = anti-aliasing, ignored)
// Exits non-zero when the ratio is over --max-ratio, so it gates a loop / hook / CI.
//
// pixelmatch ignores anti-aliased pixels by default — this suppresses the Figma-vs-renderer
// font anti-aliasing noise that makes web loops chase phantom 1px font-size changes.
//
// Importable: `import { compare, formatReport } from "./visual-diff.mjs"` (used by render.mjs).
//
// Usage:
//   node visual-diff.mjs --actual render.png --expected .figma/figma.png \
//        [--out diff.png] [--threshold 0.1] [--max-ratio 0.01]
//
// Deps (install in the target repo): pixelmatch pngjs
//   npm i -D pixelmatch pngjs   |   bun add -d pixelmatch pngjs

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

/** Compare two PNGs; writes a diff image and returns a structured result. */
export async function compare({ actual, expected, out = "diff.png", threshold = 0.1, maxRatio = 0.01 }) {
  let pixelmatch, PNG;
  try {
    pixelmatch = (await import("pixelmatch")).default;
    PNG = (await import("pngjs")).PNG;
  } catch {
    throw new Error("Missing deps. Install in the project: npm i -D pixelmatch pngjs  (or bun add -d ...)");
  }

  const a = PNG.sync.read(readFileSync(actual));
  const b = PNG.sync.read(readFileSync(expected));
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `Dimension mismatch: actual ${a.width}×${a.height} vs expected ${b.width}×${b.height}.\n` +
        `  Render Takumi at the EXACT Figma frame size × export scale, or re-export at matching scale.\n` +
        `  (Do NOT resize — that hides the real bug.)`,
    );
  }

  const { width, height } = a;
  const diff = new PNG({ width, height });
  const mismatched = pixelmatch(a.data, b.data, diff.data, width, height, {
    threshold,
    includeAA: false, // ← do not count anti-aliased pixels as differences
    diffColor: [255, 0, 0],
  });
  writeFileSync(out, PNG.sync.write(diff));
  const ratio = mismatched / (width * height);

  // Coarse grid from the diff mask (red pixels only).
  const COLS = 32;
  const cellW = Math.max(1, Math.ceil(width / COLS));
  const cols = Math.ceil(width / cellW);
  const rows = Math.ceil(height / cellW);
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // real diffs are red; AA pixels are yellow (g high) — count red only.
      if (diff.data[i] > 200 && diff.data[i + 1] < 100 && diff.data[i + 2] < 100) {
        grid[(y / cellW) | 0][(x / cellW) | 0]++;
      }
    }
  }

  const cellArea = cellW * cellW;
  const ramp = " .:-=+*#%@";
  const heatmap = grid
    .map((row) =>
      row
        .map((c) => ramp[Math.min(ramp.length - 1, Math.floor((c / cellArea) * (ramp.length - 1) * 4))])
        .join(""),
    )
    .join("\n");

  const cells = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) if (grid[r][c] > 0) cells.push({ r, c, n: grid[r][c] });
  cells.sort((p, q) => q.n - p.n);
  const regions = cells.slice(0, 6).map(({ r, c, n }) => ({
    x: c * cellW,
    y: r * cellW,
    w: Math.min(cellW, width - c * cellW),
    h: Math.min(cellW, height - r * cellW),
    diffPx: n,
  }));

  return { width, height, mismatched, ratio, out, regions, heatmap, cellW, threshold, maxRatio, pass: ratio <= maxRatio };
}

/** Human/agent-readable report for a compare() result. */
export function formatReport(r) {
  const pct = (r.ratio * 100).toFixed(3);
  const lines = [
    `image      ${r.width}×${r.height}`,
    `mismatch   ${r.mismatched} px  (${pct}%)`,
    `diff image ${r.out}`,
  ];
  if (r.regions.length) {
    lines.push(`hotspots   (densest diff cells, ${r.cellW}px grid):`);
    for (const z of r.regions) lines.push(`  • x=${z.x} y=${z.y} w=${z.w} h=${z.h}  (${z.diffPx} diff px)`);
    lines.push("heatmap:", r.heatmap);
  }
  lines.push(
    "",
    r.pass
      ? `✓ PASS: mismatch ${pct}% ≤ max ${(r.maxRatio * 100).toFixed(3)}%`
      : `✗ FAIL: mismatch ${pct}% > max ${(r.maxRatio * 100).toFixed(3)}%`,
  );
  return lines.join("\n");
}

// CLI ------------------------------------------------------------------------
const isMain =
  import.meta.main ?? (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);

if (isMain) {
  const { values } = parseArgs({
    options: {
      actual: { type: "string" },
      expected: { type: "string" },
      out: { type: "string", default: "diff.png" },
      threshold: { type: "string", default: "0.1" },
      "max-ratio": { type: "string", default: "0.01" },
    },
  });
  if (!values.actual || !values.expected) {
    console.error("visual-diff: Usage: visual-diff.mjs --actual render.png --expected figma.png [--out diff.png]");
    process.exit(1);
  }
  try {
    const r = await compare({
      actual: values.actual,
      expected: values.expected,
      out: values.out,
      threshold: Number(values.threshold),
      maxRatio: Number(values["max-ratio"]),
    });
    console.log(formatReport(r));
    process.exit(r.pass ? 0 : 1);
  } catch (e) {
    console.error(`visual-diff: ${e.message}`);
    process.exit(1);
  }
}
