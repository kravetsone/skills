#!/usr/bin/env node
/**
 * Verify the .adminjs/ custom-components bundle is present and fresh.
 *
 * Run from project root:
 *   node scripts/bundle-check.mjs
 *
 * Checks:
 *   - .adminjs/entry.js and .adminjs/bundle.js exist
 *   - bundle.js mtime is newer than any src/admin/ .tsx / .jsx source
 *   - under NODE_ENV=production, warns if bundle is older than any component
 *
 * Exit 0 clean, 1 if stale or missing.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const CWD = process.cwd();
const ADMINJS_DIR = resolve(CWD, ".adminjs");
const BUNDLE = resolve(ADMINJS_DIR, "bundle.js");
const ENTRY = resolve(ADMINJS_DIR, "entry.js");

// ─── Helpers ───────────────────────────────────────────────────────────────
function walk(dir, out = []) {
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        const p = join(dir, name);
        const s = statSync(p);
        if (s.isDirectory()) walk(p, out);
        else if (/\.(tsx|jsx)$/.test(name)) out.push(p);
    }
    return out;
}

// ─── Check bundle presence ─────────────────────────────────────────────────
if (!existsSync(BUNDLE) || !existsSync(ENTRY)) {
    console.error("✖ .adminjs/ bundle missing.");
    console.error("  Expected:", BUNDLE);
    console.error("  Cause: app hasn't initialized, or the start crashed before bundling.");
    console.error("  Fix:");
    console.error("    - Start the app once (bun ./src/index.ts) to let AdminJS compile the bundle.");
    console.error("    - For production, pre-compile during image build: see references/setup-and-bundling.md");
    process.exit(1);
}

const bundleMtime = statSync(BUNDLE).mtimeMs;
console.log(`✔ .adminjs/bundle.js present  (${new Date(bundleMtime).toISOString()})`);

// ─── Check freshness against source components ────────────────────────────
const components = walk(resolve(CWD, "src/admin"));

if (components.length === 0) {
    console.log("  (no src/admin/**/*.tsx found — nothing to compare against)");
    process.exit(0);
}

let stale = false;
for (const file of components) {
    const m = statSync(file).mtimeMs;
    if (m > bundleMtime) {
        const delta = Math.round((m - bundleMtime) / 1000);
        console.log(`⚠ newer than bundle: ${file.replace(CWD + "/", "")}  (+${delta}s)`);
        stale = true;
    }
}

if (stale) {
    console.log("");
    console.log("  Bundle is stale. Cause: components changed since last compile.");
    console.log("  Fix:");
    console.log("    - In dev: restart the app — admin.watch() will rebuild.");
    console.log("    - In prod: delete .adminjs/ and re-run the app once during image build.");
    if (process.env.NODE_ENV === "production") process.exit(1);
    process.exit(0);
}

console.log("✔ Bundle is fresh relative to src/admin/**/*.tsx");
process.exit(0);
