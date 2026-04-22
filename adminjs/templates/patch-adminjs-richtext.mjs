#!/usr/bin/env node
/**
 * Patches @adminjs/design-system's broken richtext link button.
 *
 * Bug: the link command only calls `unsetLink()` — adding new links is impossible.
 * Fix:
 *   - If link active  → confirm removal → unsetLink()
 *   - If no link      → prompt for URL  → setLink()
 *
 * Patches three files shipped in the package:
 *   build/molecules/rich-text-editor/useTiptapCommands.js   (dev, unminified)
 *   bundle.development.js                                    (browser dev bundle)
 *   bundle.production.js                                     (browser prod bundle, minified)
 *
 * Idempotent — detects already-patched files and skips.
 *
 * Usage (from your project):
 *   1. Save this file as scripts/patch-adminjs-richtext.mjs
 *   2. Add to package.json:
 *        "scripts": { "postinstall": "node scripts/patch-adminjs-richtext.mjs" }
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = resolve(root, "node_modules/@adminjs/design-system");

// ─── unminified (build/ + bundle.development.js) ───────────────────────────
const BROKEN_DEV = `command('link', () => editor.chain().focus().unsetLink().run(), 'Link')`;
const FIXED_DEV = `command('link', () => { if (editor.isActive('link')) { if (window.confirm('Remove link?')) editor.chain().focus().unsetLink().run(); } else { const url = window.prompt('Enter URL:'); if (url) editor.chain().focus().setLink({ href: url, target: '_blank' }).run(); } }, 'Link')`;

// ─── minified (bundle.production.js) — VAR is the minified editor name ────
const BROKEN_PROD_RE =
    /"link",\(\)=>(\w+)\.chain\(\)\.focus\(\)\.unsetLink\(\)\.run\(\),"Link"/;
const fixedProd = (v) =>
    `"link",()=>{if(${v}.isActive("link")){if(window.confirm("Remove link?"))${v}.chain().focus().unsetLink().run();}else{const u=window.prompt("Enter URL:");if(u)${v}.chain().focus().setLink({href:u,target:"_blank"}).run();}},"Link"`;

const FILES = [
    {
        path: `${base}/build/molecules/rich-text-editor/useTiptapCommands.js`,
        prod: false,
    },
    { path: `${base}/bundle.development.js`, prod: false },
    { path: `${base}/bundle.production.js`, prod: true },
];

let patched = 0;
let skipped = 0;

for (const { path: file, prod } of FILES) {
    let content;
    try {
        content = readFileSync(file, "utf8");
    } catch {
        console.warn(`[patch] skipping (not found): ${file.replace(root, ".")}`);
        continue;
    }

    const short = file.replace(root, ".");

    if (prod) {
        const m = content.match(BROKEN_PROD_RE);
        if (!m) {
            console.log(`[patch] already patched or changed: ${short}`);
            skipped++;
            continue;
        }
        content = content.replace(BROKEN_PROD_RE, fixedProd(m[1]));
    } else {
        if (!content.includes(BROKEN_DEV)) {
            console.log(`[patch] already patched or changed: ${short}`);
            skipped++;
            continue;
        }
        content = content.replace(BROKEN_DEV, FIXED_DEV);
    }

    writeFileSync(file, content, "utf8");
    console.log(`[patch] patched: ${short}`);
    patched++;
}

console.log(`[patch] done. patched ${patched}, skipped ${skipped}.`);
