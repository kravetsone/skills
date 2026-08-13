#!/usr/bin/env node
/**
 * AdminJS-on-Elysia setup doctor.
 *
 * Run from a project root (where node_modules/ and package.json live):
 *   node scripts/doctor.mjs
 *
 * Checks:
 *   1. Required peer dependencies installed
 *   2. React pinned to 18 (not 19)
 *   3. adminjs-elysia version ≥ 0.1.4
 *   4. Bun runtime available (adminjs-elysia requires it)
 *   5. Richtext link patch applied
 *   6. .adminjs/ bundle folder state
 *   7. S3_* env vars in .env / .env.example
 *   8. Custom actions declaring `component` (missing → "noActionComponent" box)
 *
 * Output: prioritized fix list, exit 0 on clean, 1 on issues.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const CWD = process.cwd();
const PKG = resolve(CWD, "package.json");
const NODE_MODULES = resolve(CWD, "node_modules");

if (!existsSync(PKG)) {
    console.error("✖ No package.json in", CWD);
    process.exit(1);
}

const pkg = JSON.parse(readFileSync(PKG, "utf8"));
const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
const overrides = pkg.overrides ?? pkg.resolutions ?? {};

const issues = [];
const warnings = [];
const ok = [];

function depRange(name) { return allDeps[name]; }

function pkgVersion(name) {
    const p = resolve(NODE_MODULES, name, "package.json");
    if (!existsSync(p)) return null;
    try { return JSON.parse(readFileSync(p, "utf8")).version; } catch { return null; }
}

// ─── 1. Peer deps ──────────────────────────────────────────────────────────
const REQUIRED_PEERS = [
    ["adminjs", "^7.8.8"],
    ["elysia", "^1.3"],
    ["@elysiajs/jwt", "^1.4"],
    ["node-mocks-http", "^1.15"],
];
if (depRange("adminjs-elysia")) {
    for (const [name, min] of REQUIRED_PEERS) {
        if (!depRange(name)) {
            issues.push(
                `Missing peer dependency \`${name}\` (required by adminjs-elysia, want ${min}).\n` +
                `  Fix: bun add ${name}`,
            );
        } else {
            ok.push(`peer dep ${name}: ${pkgVersion(name) ?? depRange(name)}`);
        }
    }
}

// ─── 2. React version ──────────────────────────────────────────────────────
const reactV = pkgVersion("react");
if (reactV) {
    const major = parseInt(reactV.split(".")[0], 10);
    if (major >= 19) {
        issues.push(
            `React ${reactV} installed — AdminJS requires React 18.\n` +
            `  Fix: pin in package.json:  "react": "18", "react-dom": "18"  (then bun install)`,
        );
    } else {
        ok.push(`react: ${reactV}`);
    }
}

// ─── 3. adminjs-elysia version ─────────────────────────────────────────────
const elysiaAdapterV = pkgVersion("adminjs-elysia");
if (elysiaAdapterV) {
    ok.push(`adminjs-elysia: ${elysiaAdapterV}`);
    if (elysiaAdapterV.startsWith("0.1.") && parseInt(elysiaAdapterV.split(".")[2], 10) < 4) {
        warnings.push(
            `adminjs-elysia ${elysiaAdapterV} is pre-0.1.4 — earlier versions have more bugs.\n` +
            `  Fix: bun add adminjs-elysia@latest`,
        );
    }
} else if (depRange("adminjs-elysia")) {
    issues.push(`adminjs-elysia declared but not installed — run \`bun install\``);
}

// ─── 4. Bun runtime ────────────────────────────────────────────────────────
if (typeof globalThis.Bun === "undefined") {
    warnings.push(
        `Running doctor under Node, not Bun. adminjs-elysia uses \`Bun.file()\` at runtime — your app must run under Bun.`,
    );
} else {
    ok.push(`bun runtime: ${globalThis.Bun.version}`);
}

// ─── 5. Richtext link patch ────────────────────────────────────────────────
const DS_BUNDLE_PROD = resolve(NODE_MODULES, "@adminjs/design-system/bundle.production.js");
if (existsSync(DS_BUNDLE_PROD)) {
    const content = readFileSync(DS_BUNDLE_PROD, "utf8");
    const broken = /"link",\(\)=>\w+\.chain\(\)\.focus\(\)\.unsetLink\(\)\.run\(\),"Link"/.test(content);
    if (broken) {
        warnings.push(
            `Richtext link button is BROKEN in @adminjs/design-system (patch not applied).\n` +
            `  Fix: copy templates/patch-adminjs-richtext.mjs → scripts/, then add to package.json:\n` +
            `       "scripts": { "postinstall": "node scripts/patch-adminjs-richtext.mjs" }\n` +
            `       then run: bun install   (or node scripts/patch-adminjs-richtext.mjs manually)`,
        );
    } else {
        ok.push(`richtext link patch: applied`);
    }
}

// ─── 6. Tiptap horizontal-rule override ────────────────────────────────────
if (!overrides["@tiptap/extension-horizontal-rule"]) {
    warnings.push(
        `No override for @tiptap/extension-horizontal-rule — some versions break the richtext editor.\n` +
        `  Fix: add to package.json:\n` +
        `       "overrides": { "@tiptap/extension-horizontal-rule": "2.1.13" }`,
    );
} else {
    ok.push(`@tiptap/extension-horizontal-rule override: ${overrides["@tiptap/extension-horizontal-rule"]}`);
}

// ─── 7. .adminjs/ bundle ───────────────────────────────────────────────────
const ADMINJS_DIR = resolve(CWD, ".adminjs");
const ADMINJS_BUNDLE = resolve(ADMINJS_DIR, "bundle.js");
if (process.env.NODE_ENV === "production") {
    if (!existsSync(ADMINJS_BUNDLE)) {
        warnings.push(
            `.adminjs/bundle.js missing — production first-request will recompile (slow).\n` +
            `  Fix: pre-compile during image build (see references/setup-and-bundling.md).`,
        );
    } else {
        const age = (Date.now() - statSync(ADMINJS_BUNDLE).mtimeMs) / 1000 / 60;
        ok.push(`.adminjs/bundle.js: present (${Math.round(age)}m old)`);
    }
}

// ─── 8. .env.example coverage ──────────────────────────────────────────────
const EXAMPLE_ENV = resolve(CWD, ".env.example");
if (existsSync(EXAMPLE_ENV)) {
    const content = readFileSync(EXAMPLE_ENV, "utf8");
    const required = [
        "ADMIN_EMAIL",
        "ADMIN_PASSWORD",
        "ADMIN_COOKIE_SECRET",
        "S3_BUCKET",
        "S3_ENDPOINT",
        "S3_ACCESS",
        "S3_SECRET",
    ];
    const missing = required.filter((k) => !content.includes(k));
    if (missing.length) {
        warnings.push(
            `.env.example missing: ${missing.join(", ")}\n` +
            `  Fix: add these keys so other developers know what to set.`,
        );
    } else {
        ok.push(`.env.example: all keys present`);
    }
}

// ─── 9. Custom actions missing `component` ─────────────────────────────────
// A custom action without `component` renders the "noActionComponent" red box
// (BaseActionComponent finds neither a built-in nor a UserComponent) and its
// `guard` never fires. Heuristic source scan — brace-matched, string-naive.
const BUILT_IN_ACTIONS = new Set(["list", "show", "new", "edit", "delete", "bulkDelete"]);

function collectSources(dir, acc = [], depth = 0) {
    if (depth > 8 || !existsSync(dir)) return acc;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) collectSources(full, acc, depth + 1);
        else if (/\.(ts|tsx|js|jsx|mts|mjs)$/.test(entry.name)) acc.push(full);
    }
    return acc;
}

/** Index of the `{` opening the object literal that contains `from`. */
function enclosingObjectStart(src, from) {
    let depth = 0;
    for (let i = from; i >= 0; i--) {
        const c = src[i];
        if (c === "}") depth++;
        else if (c === "{") {
            if (depth === 0) return i;
            depth--;
        }
    }
    return -1;
}

/** Index just past the `}` closing the object opened at `start`. */
function objectEnd(src, start) {
    let depth = 0;
    for (let i = start; i < src.length; i++) {
        const c = src[i];
        if (c === "{") depth++;
        else if (c === "}" && --depth === 0) return i + 1;
    }
    return src.length;
}

const brokenActions = [];
const getWithPostGuard = [];

for (const file of collectSources(resolve(CWD, "src")).concat(
    existsSync(resolve(CWD, "src")) ? [] : collectSources(CWD),
)) {
    let src;
    try { src = readFileSync(file, "utf8"); } catch { continue; }
    if (!src.includes("actionType")) continue;

    const rel = file.slice(CWD.length + 1);
    for (const m of src.matchAll(/\bactionType\s*:\s*["'](record|resource|bulk)["']/g)) {
        const start = enclosingObjectStart(src, m.index);
        if (start === -1) continue;
        const body = src.slice(start, objectEnd(src, start));

        // Action key: the `name:` / `"name":` immediately preceding the `{`.
        const keyMatch = src.slice(Math.max(0, start - 120), start).match(/([\w$]+|["'][^"']+["'])\s*:\s*$/);
        const name = keyMatch ? keyMatch[1].replace(/["']/g, "") : "<anonymous>";
        if (BUILT_IN_ACTIONS.has(name)) continue;

        const line = src.slice(0, m.index).split("\n").length;
        if (!/\bcomponent\s*:/.test(body)) {
            brokenActions.push({ rel, line, name, hasGuard: /\bguard\s*:/.test(body) });
        } else if (
            /\bcomponent\s*:\s*false\b/.test(body) &&
            /request\.method\s*!==\s*["']post["']/.test(body)
        ) {
            getWithPostGuard.push({ rel, line, name });
        }
    }
}

if (brokenActions.length) {
    issues.push(
        `${brokenActions.length} custom action(s) missing \`component\` — these render the\n` +
        `  "noActionComponent" red box on click, and any \`guard\` on them never fires:\n` +
        brokenActions
            .map((a) => `    ${a.rel}:${a.line}  ${a.name}${a.hasGuard ? "  (has guard — definitely broken)" : ""}`)
            .join("\n") +
        `\n  Fix: add \`component: false\` for one-click actions, or \`component: <name>\`\n` +
        `       for ones that need a form. See references/custom-actions.md.`,
    );
} else {
    ok.push(`custom actions: all declare \`component\``);
}

if (getWithPostGuard.length) {
    warnings.push(
        `${getWithPostGuard.length} action(s) combine \`component: false\` with a \`request.method !== "post"\`\n` +
        `  early return. Immediate actions are called over GET, so the handler never runs:\n` +
        getWithPostGuard.map((a) => `    ${a.rel}:${a.line}  ${a.name}`).join("\n") +
        `\n  Fix: drop the method check — there is no form to POST.`,
    );
}

// ─── Report ────────────────────────────────────────────────────────────────
console.log("─── AdminJS doctor ──────────────────────────────────────────────");
if (ok.length) {
    console.log("\n✔ OK");
    for (const line of ok) console.log(`  ${line}`);
}
if (warnings.length) {
    console.log("\n⚠ Warnings");
    for (const line of warnings) console.log(`\n  ${line}`);
}
if (issues.length) {
    console.log("\n✖ Issues");
    for (const line of issues) console.log(`\n  ${line}`);
    console.log("");
    process.exit(1);
}
console.log("");
process.exit(0);
