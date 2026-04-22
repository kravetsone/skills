# Client libraries

## TypeScript / JavaScript

Four maintained options + the roll-your-own case. Pick based on runtime and how much surface area you need.

### `@audioling/open-subsonic-api-client`

- **npm:** `@audioling/open-subsonic-api-client`
- **Stack:** `@ts-rest/core` + `axios` + `qs` + `zod`
- **Strengths:** Every endpoint typed end-to-end from Zod schemas. Every OpenSubsonic extension covered (`getLyricsBySongId`, `getOpenSubsonicExtensions`, `tokenInfo`, `reportPlayback`, etc.). Handles token+salt generation internally.
- **Weaknesses:** `axios` dependency — works on Node/Bun/Deno fine, but requires XHR shim on Cloudflare Workers / some edge runtimes. Bundle size non-trivial (~70 KB gzipped). README is minimal; rely on types for docs.
- **When to pick:** Node backend, Electron renderer, Bun script, any environment where you want strict types and don't care about bundle size.

```ts
import { initOpenSubsonicApiClient } from "@audioling/open-subsonic-api-client";

const api = initOpenSubsonicApiClient({
    baseUrl, clientName: "my-app", username, password,
});
const ping = await api.ping.get();
const recent = await api.getAlbumList2.get({ query: { type: "recent", size: 20 } });
```

See [`templates/audioling-client.ts`](../templates/audioling-client.ts).

### `subsonic-api` (explodingcamera)

- **npm:** `subsonic-api`
- **Repo:** https://github.com/explodingcamera/subsonic-api
- **Stack:** Native `fetch`, zero-dep.
- **Strengths:** Tiny (~10 KB). Works everywhere `fetch` does — Node, Bun, Deno, Workers, browser. Covers Subsonic 1.16.1 + most OpenSubsonic methods.
- **Weaknesses:** Types are hand-written (not generated from schema); may lag new extensions. Less aggressive on OS-field coverage.
- **When to pick:** Edge runtimes, size-constrained bundles, projects that want minimalism.

### `@vmohammad/subsonic-api`

- **npm:** `@vmohammad/subsonic-api`
- **Repo:** https://github.com/vmohammad/subsonic-api (fork of explodingcamera)
- **Strengths:** Adds helpers for the NaviThingy project. Newer extension coverage than upstream at times.
- **When to pick:** You want `subsonic-api` ergonomics + features the fork maintainer adds before upstream.

### `subsonicjs`

- **npm:** `subsonicjs`
- **Strengths:** Tries to mirror the Subsonic docs 1:1 (same param names, same method names).
- **Weaknesses:** Legacy-focused; OpenSubsonic coverage is thin.
- **When to pick:** Porting a client originally built against the official Subsonic docs.

### Roll your own

Use [`templates/minimal-client.ts`](../templates/minimal-client.ts) as a starting point. ~240 lines, zero dep, MD5 inline, works in every runtime. Good when:

- You only need 5–10 endpoints.
- You want to ship a smaller bundle than any npm lib delivers.
- You need a very specific auth flow (per-request API key, proxy-injected, etc.).

## Server compatibility

The clients above target OpenSubsonic but run against any Subsonic-compatible server. Tested compatibility (from Supersonic / Sonixd / Feishin):

| Server | OpenSubsonic | ID type | Notes |
|--------|--------------|---------|-------|
| **Navidrome** | ✅ many extensions | string (MD5/UUID) | Primary target. Best support. |
| **Airsonic-Advanced** | ⚠️ partial | integer | Predecessor of Navidrome. Extension support lagging. |
| **Gonic** | ⚠️ minimal | integer | Go-based, lightweight. Subset of endpoints. |
| **LMS (Lyrion Music Server)** | ⚠️ partial | mixed | Squeezebox-oriented; Subsonic API is a shim. |
| **Supysonic** | ❌ | integer | Python reference implementation; legacy only. |
| **Funkwhale** | ✅ subset | UUID | Federated; some endpoints federated-scope. |
| **Ampache** | ✅ via Subsonic-compat mode | integer | Ampache has its own API — subsonic is a shim. |
| **Astiga** | ⚠️ partial | mixed | Commercial cloud. |
| **Nextcloud Music** | ⚠️ partial | integer | App plugin. |

Detect at runtime via `ping.type` (`"navidrome"` / `"gonic"` / `"airsonic"` / ...). For portable clients, feature-detect per-extension rather than branching on server kind.

## Non-TS ecosystems (for reference)

- **Go:** `go-subsonic` (github.com/delucks/go-subsonic) — reference Go client.
- **Python:** `py-sonic`, `libsonic`.
- **Dart:** `subsonic_api`.
- **Swift:** `twostraws/Subsonic` (minimal playback helper).
- **Rust:** `opensubsonic-rs`.

These mirror the OpenSubsonic endpoint surface — useful when reverse-engineering an edge case.

## Sibling-client code to learn from

- **[Feishin](https://github.com/jeffvli/feishin)** — TS/Electron/React, dual Subsonic/Navidrome-native adapters. Representative of the "full desktop player" architecture. Source path: `src/renderer/api/` for adapter patterns.
- **[Supersonic](https://github.com/dweymouth/supersonic)** — Go/Fyne, lightweight cross-platform. Source path: `backend/` for scrobble-threshold logic, transcoding policy.
- **[Sonixd](https://github.com/jeffvli/sonixd)** — Jeff Vli's earlier Electron/React client. Archived; good for historical context.
- **[audioling/audioling](https://github.com/audioling/audioling)** — archived web player by the same team as `@audioling/open-subsonic-api-client`.

Read these when you need to see how production clients handle:
- Cross-server feature-detection (falling back between legacy/OS variants).
- Playback state machine + scrobble submission heuristic.
- Cover-art caching + Service Worker patterns.
- Multi-device play-queue sync.

## Decision matrix

| You need… | Pick |
|-----------|------|
| Full typed API surface, Node/Electron | `@audioling/open-subsonic-api-client` |
| Edge runtime (Cloudflare Workers, Deno Deploy) | `subsonic-api` or `templates/minimal-client.ts` |
| Tiny bundle (<15 KB) for browser SPA | `subsonic-api` or `minimal-client.ts` |
| Minimal surface (ping + stream + scrobble) | `minimal-client.ts` |
| Admin features (plugins, libraries, missing files) | `templates/navidrome-native-client.ts` + `minimal-client.ts` for playback |
| Share one client across web + Electron + CLI | `subsonic-api` (identical API in all runtimes) |
| Hide server creds from browsers | `templates/hono-proxy.ts` in front of any above |
