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
 *
 * Output: prioritized fix list, exit 0 on clean, 1 on issues.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
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
