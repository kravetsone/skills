#!/usr/bin/env node
// check-server.mjs — Subsonic / OpenSubsonic / Navidrome capability probe.
// Usage:
//   node check-server.mjs <baseUrl> <user> <pass>
//   node check-server.mjs <baseUrl> --apikey <key>
//   node check-server.mjs <baseUrl> <user> <pass> --json
//
// Prints a markdown capability report: server identity, openSubsonic flag,
// extension catalog, smoke-test of key endpoints. Save the output as the
// source of truth for feature-detection logic in your client.

import { createHash, randomBytes } from "node:crypto";
import { argv, exit, stderr, stdout } from "node:process";

const CLIENT = "subsonic-api-skill-probe/1";
const API_VERSION = "1.16.1";

function parseArgs(argv) {
    const args = argv.slice(2);
    if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
        stderr.write(
            "Usage: node check-server.mjs <baseUrl> <user> <pass> [--json]\n" +
                "       node check-server.mjs <baseUrl> --apikey <key> [--json]\n",
        );
        exit(1);
    }
    const json = args.includes("--json");
    const cleaned = args.filter((a) => a !== "--json");
    const baseUrl = cleaned[0].replace(/\/+$/, "");
    let auth;
    const apiKeyIdx = cleaned.indexOf("--apikey");
    if (apiKeyIdx !== -1) {
        auth = { kind: "apiKey", apiKey: cleaned[apiKeyIdx + 1] };
    } else {
        auth = { kind: "tokenSalt", user: cleaned[1], pass: cleaned[2] };
        if (!auth.user || !auth.pass) {
            stderr.write("ERROR: missing user/pass. See --help.\n");
            exit(1);
        }
    }
    return { baseUrl, auth, json };
}

function authParams(auth) {
    const common = { v: API_VERSION, c: CLIENT, f: "json" };
    if (auth.kind === "apiKey") return { ...common, apiKey: auth.apiKey };
    const salt = randomBytes(8).toString("hex");
    const token = createHash("md5").update(auth.pass + salt).digest("hex");
    return { ...common, u: auth.user, t: token, s: salt };
}

async function call(baseUrl, method, auth, extra = {}) {
    const url = new URL(`${baseUrl}/rest/${method}.view`);
    const params = { ...authParams(auth), ...extra };
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    let status = 0;
    let body;
    try {
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        status = res.status;
        const ct = res.headers.get("content-type") ?? "";
        body = ct.includes("json") ? await res.json() : { _raw: await res.text() };
    } catch (err) {
        return { ok: false, httpStatus: 0, error: String(err) };
    }
    const envelope = body?.["subsonic-response"] ?? body;
    const isOk = envelope?.status === "ok";
    return {
        ok: isOk,
        httpStatus: status,
        envelope,
        error: !isOk ? envelope?.error : undefined,
    };
}

function fmtMs(t0) {
    return `${(performance.now() - t0).toFixed(0)}ms`;
}

const MARKERS = {
    ok: "✅",
    fail: "❌",
    partial: "⚠️ ",
};

async function main() {
    const { baseUrl, auth, json } = parseArgs(argv);

    const report = {
        baseUrl,
        authMode: auth.kind,
        ping: null,
        extensions: [],
        endpoints: {},
        suggestions: [],
    };

    // 1. ping — identity + openSubsonic flag
    {
        const t0 = performance.now();
        const r = await call(baseUrl, "ping", auth);
        report.ping = {
            ok: r.ok,
            httpStatus: r.httpStatus,
            latency: fmtMs(t0),
            status: r.envelope?.status,
            version: r.envelope?.version,
            type: r.envelope?.type,
            serverName: r.envelope?.serverName,
            serverVersion: r.envelope?.serverVersion,
            openSubsonic: r.envelope?.openSubsonic === true,
            error: r.error,
        };
        if (!r.ok) {
            if (!json) {
                stdout.write(render(report));
                stdout.write(
                    "\n\n> `ping` failed — stopping. Check URL, credentials, and whether you need to upgrade the server (CVE-2025-27112 fixed in Navidrome 0.54.1+).\n",
                );
            } else {
                stdout.write(JSON.stringify(report, null, 2) + "\n");
            }
            exit(2);
        }
    }

    // 2. OpenSubsonic extensions
    if (report.ping.openSubsonic) {
        const r = await call(baseUrl, "getOpenSubsonicExtensions", auth);
        if (r.ok) {
            report.extensions = r.envelope?.openSubsonicExtensions ?? [];
        }
    }

    // 3. Endpoint smoke tests
    const probes = [
        ["getMusicFolders", {}],
        ["getAlbumList2", { type: "newest", size: 1 }],
        ["search3", { query: "a", songCount: 1, albumCount: 1, artistCount: 1 }],
        ["getGenres", {}],
        ["getScanStatus", {}],
        ["getPlaylists", {}],
        ["getNowPlaying", {}],
    ];
    for (const [method, params] of probes) {
        const t0 = performance.now();
        const r = await call(baseUrl, method, auth, params);
        report.endpoints[method] = {
            ok: r.ok,
            latency: fmtMs(t0),
            error: r.error,
        };
    }

    // 4. Suggestions
    const hasExt = (name) => report.extensions.some((e) => e.name === name);
    if (hasExt("apiKeyAuthentication") && auth.kind !== "apiKey") {
        report.suggestions.push(
            "Server supports `apiKeyAuthentication` — consider provisioning an API key and switching auth mode (no more per-request md5+salt).",
        );
    }
    if (hasExt("songLyrics")) {
        report.suggestions.push(
            "`songLyrics` extension is active — use `getLyricsBySongId` for synced LRC; legacy `getLyrics` is artist+title only.",
        );
    }
    if (hasExt("playbackReport")) {
        report.suggestions.push(
            "`playbackReport` extension is active — `reportPlayback` can supplement `scrobble` with position/event telemetry.",
        );
    }
    if (hasExt("transcodeOffset")) {
        report.suggestions.push(
            "`transcodeOffset` extension is active — `stream?timeOffset=<sec>` works for audio (not just video).",
        );
    }
    if (hasExt("formPost")) {
        report.suggestions.push(
            "`formPost` extension is active — long playlist/queue updates can use POST body instead of URL query.",
        );
    }
    if (!report.ping.openSubsonic) {
        report.suggestions.push(
            "Server does NOT advertise OpenSubsonic — treat the response envelope as legacy; `musicBrainzId`, `replayGain`, `contributors`, `moods`, `displayArtist` may be absent.",
        );
    }

    if (json) {
        stdout.write(JSON.stringify(report, null, 2) + "\n");
    } else {
        stdout.write(render(report));
    }
}

function render(r) {
    const lines = [];
    lines.push(`# Subsonic server capability report`);
    lines.push("");
    lines.push(`**URL:** \`${r.baseUrl}\`  `);
    lines.push(`**Auth mode:** \`${r.authMode}\`  `);
    lines.push(`**Probed at:** \`${new Date().toISOString()}\``);
    lines.push("");
    lines.push(`## Identity`);
    lines.push("");
    if (r.ping?.ok) {
        lines.push(`- ${MARKERS.ok} \`ping\` — HTTP ${r.ping.httpStatus}, ${r.ping.latency}`);
        lines.push(`- **Subsonic API version:** \`${r.ping.version}\``);
        const serverBits = [r.ping.serverName, r.ping.serverVersion].filter(Boolean).join(" ");
        lines.push(`- **Server:** \`${serverBits || "unknown"}\` (type: \`${r.ping.type ?? "unknown"}\`)`);
        lines.push(`- **OpenSubsonic:** ${r.ping.openSubsonic ? `${MARKERS.ok} yes` : `${MARKERS.fail} no`}`);
    } else {
        lines.push(`- ${MARKERS.fail} \`ping\` failed — HTTP ${r.ping?.httpStatus}, error: \`${JSON.stringify(r.ping?.error)}\``);
    }
    lines.push("");
    lines.push(`## OpenSubsonic extensions`);
    lines.push("");
    if (r.extensions.length === 0) {
        lines.push(`_None advertised._`);
    } else {
        lines.push(`| Extension | Versions |`);
        lines.push(`|-----------|----------|`);
        for (const ext of r.extensions) {
            lines.push(`| \`${ext.name}\` | ${(ext.versions ?? []).join(", ") || "—"} |`);
        }
    }
    lines.push("");
    lines.push(`## Endpoint smoke tests`);
    lines.push("");
    lines.push(`| Endpoint | Status | Latency | Notes |`);
    lines.push(`|----------|--------|---------|-------|`);
    for (const [method, res] of Object.entries(r.endpoints)) {
        const mark = res.ok ? MARKERS.ok : MARKERS.fail;
        const note = res.error
            ? `code ${res.error.code}: ${res.error.message}`
            : "";
        lines.push(`| \`${method}\` | ${mark} | ${res.latency} | ${note} |`);
    }
    lines.push("");
    if (r.suggestions.length > 0) {
        lines.push(`## Suggestions`);
        lines.push("");
        for (const s of r.suggestions) lines.push(`- ${s}`);
        lines.push("");
    }
    return lines.join("\n") + "\n";
}

main().catch((err) => {
    stderr.write(`FATAL: ${err?.stack ?? err}\n`);
    exit(99);
});
