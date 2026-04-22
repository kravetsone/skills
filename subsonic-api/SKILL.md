---
name: subsonic-api
description: "Invoke for ANY Subsonic / OpenSubsonic / Navidrome / Airsonic-Advanced / Gonic / LMS / Supysonic / Funkwhale / Ampache / Astiga client code — imports of `@audioling/open-subsonic-api-client`, `subsonic-api`, `@vmohammad/subsonic-api`, `subsonicjs`; raw `fetch`/`axios` calls to `/rest/ping.view`, `/rest/getAlbumList2.view`, `/rest/search3.view`, `/rest/stream.view`, `/rest/scrobble.view`, `/rest/getOpenSubsonicExtensions.view`; `token`/`salt` MD5 auth with `u`/`p`/`t`/`s`/`v`/`c`/`f` parameters, OpenSubsonic `apiKey` extension, `form POST` extension, `transcodeOffset`, `songLyrics`/`getLyricsBySongId` (synced LRC), `indexBasedQueue`, `playbackReport`/`reportPlayback`, `sonicSimilarity`, `tokenInfo`. Covers Navidrome quirks (IDs-strings MD5/UUID, no video endpoints, no folder-browse, `search3` without Lucene, `getUsers` returns only authenticated user, multi-library via `musicFolderId`, reverse-proxy auth with `ReverseProxyUserHeader`, `ND_BASEURL` subpath mounting, CVE-2025-27112 authbypass fix). Also covers Navidrome **native** `/api/*` JSON REST with `x-nd-authorization` JWT (unstable, react-admin pagination `_sort`/`_order`/`_start`/`_end`/`filter=`), `POST /auth/login`, admin endpoints `/api/plugin`/`/api/library`/`/api/missing`/`/api/config`, SSE `/api/events?jwt=`. Use for building music clients, scrobblers, import/export tools, CLI utilities, Telegram/Discord bots, Hono/Elysia/Express reverse proxies, Cloudflare Workers/Deno Deploy edge, React/Vue/Svelte browser SPAs, Electron desktop players, MPV front-ends. Also invoke for migrations Airsonic → Navidrome, Subsonic → OpenSubsonic, between clients (Sonixd→Feishin→Supersonic). When delegating to a subagent that will write Subsonic code, pass the relevant reference-file paths inline (e.g. `subsonic-api/references/authentication.md`, `endpoints-reference.md`, `streaming-and-transcoding.md`) — this skill does not auto-load in subagent sessions."
allowed-tools: Bash(node scripts/check-server.mjs*)
metadata:
  author: kravetsone
  version: "2026.4.23"
  source: https://github.com/kravetsone/skills/tree/main/subsonic-api
  upstream: https://opensubsonic.netlify.app/
---

# Subsonic / OpenSubsonic / Navidrome API

Subsonic is a 2000s-era music-streaming REST API (v1.16.1, XML first, JSON added later) that became a de-facto standard after the original Subsonic server went closed-source. **[OpenSubsonic](https://opensubsonic.netlify.app/)** is a community spec that extends it non-breakingly: a discovery endpoint (`getOpenSubsonicExtensions`), modern auth (`apiKey`), richer song/album fields (MusicBrainz IDs, ReplayGain, synced lyrics, contributor/mood/label arrays), and explicit versioning. **[Navidrome](https://www.navidrome.org/)** is the reference server — Go, SQLite/PostgreSQL, WASM plugin system, multi-library — and drives where the ecosystem is heading. All major clients (Feishin, Supersonic, Sonixd, Symfonium, Amperfy, Tempo) target this stack.

This skill codifies everything you need to **build a client** — Node/Bun/Deno backend, Cloudflare Worker, Electron app, browser SPA — against Navidrome first and every other Subsonic-compatible server second.

## When to Use This Skill

- Writing a Subsonic / OpenSubsonic / Navidrome client in TypeScript (Node 20+, Bun, Deno, Cloudflare Workers, browser).
- Integrating a music library into a service: scrobbler, bot, CLI, import/export, backup, stats dashboard.
- Wrapping Navidrome behind a Hono / Elysia / Express / Fastify reverse proxy (hide creds, add caching, bridge CORS).
- Building a desktop player with Tauri / Electron / Neutralino — the API layer is identical to server-side.
- Migrating **between servers** (Airsonic-Advanced → Navidrome, Subsonic → OpenSubsonic): same endpoints, different quirks.
- Migrating **between clients** (Sonixd → Feishin, custom → Supersonic) and need a canonical reference.
- Answering "is extension X available on this server?" — the `getOpenSubsonicExtensions` discovery flow.
- Writing code that touches the **native Navidrome `/api/*` JWT** endpoints (admin panels, plugin toggles) — use with care, officially unstable.

Works with the full Subsonic spectrum: **Navidrome** (primary target), Airsonic-Advanced, Gonic, LMS, Supysonic, Funkwhale (subset), Ampache (subsonic-compat), Astiga. Compatibility matrix lives in [references/client-libraries.md](references/client-libraries.md).

## Quick Start

### Default: typed client via [`@audioling/open-subsonic-api-client`](https://github.com/audioling/open-subsonic-api-client)

```bash
npm i @audioling/open-subsonic-api-client axios zod
```

```ts
import { initOpenSubsonicApiClient } from "@audioling/open-subsonic-api-client";

const api = initOpenSubsonicApiClient({
    baseUrl: "https://navidrome.example.com",
    clientName: "my-app/1.0.0",
    username: "alice",
    password: "hunter2", // library computes t = md5(password + random_salt) per request
});

// Probe capabilities first
const ping = await api.ping.get();
console.log(ping.body); // { status: "ok", version: "1.16.1", openSubsonic: true, ... }

if (ping.body.openSubsonic) {
    const ext = await api.getOpenSubsonicExtensions.get();
    // ext.body.openSubsonicExtensions: [{ name: "apiKeyAuthentication", versions: [1] }, ...]
}

// Load a home feed
const recent = await api.getAlbumList2.get({ query: { type: "recent", size: 20 } });
```

> **Edge-runtime caveat.** `@audioling/open-subsonic-api-client` depends on `axios` + `qs` + `@ts-rest/core` + `zod`. For Cloudflare Workers / Deno Deploy / smallest-bundle Deno, use [`templates/minimal-client.ts`](templates/minimal-client.ts) — a zero-dep `fetch` + Web Crypto implementation (~80 lines, works in every runtime).

### Alternative: zero-dep fetch client

```ts
import { SubsonicClient } from "./templates/minimal-client.ts";

const client = new SubsonicClient({
    baseUrl: "https://navidrome.example.com",
    username: "alice",
    password: "hunter2",
    clientName: "my-app",
});

await client.ping();
await client.get("getAlbumList2", { type: "recent", size: 20 });
```

## Introspection Script

Before writing a single API call, run the probe against the target server:

```bash
node scripts/check-server.mjs https://navidrome.example.com alice hunter2
# or with an apiKey
node scripts/check-server.mjs https://navidrome.example.com --apikey <key>
```

It prints a markdown report:

- `ping` → `status`, `version`, `type`, `serverName`, `serverVersion`, `openSubsonic` flag
- Extensions catalog (from `getOpenSubsonicExtensions`)
- Smoke-test of `getMusicFolders`, `getAlbumList2`, `search3`, `getScanStatus` → ✅/❌ per endpoint
- Suggested auth mode (`apiKey` if extension present, else `token+salt`)

Save the output into your project's docs — it becomes the source of truth for feature-detection logic.

## Critical Concepts

Read these **once** before writing any Subsonic code. Each is a gotcha that will silently break in production.

1. **Every request is `<baseUrl>/rest/<method>.view` (or without `.view` — both work on Navidrome).** Params go in the query string (or form body with the `formPost` extension). One deployed app = one stable `c=<clientName>` — the server uses it for analytics and to key the play queue per client.

2. **Auth v1.13+: `t = md5(password + salt)`, `s` = random hex/ASCII string ≥6 chars, generated per request.** Never reuse a salt, never send `p=` cleartext. In Node/Bun/Deno use `crypto.createHash("md5")`; in browser/Workers use a pure-JS MD5 (`spark-md5`, `js-md5`) — MD5 is **not** exposed by Web Crypto `SubtleCrypto`. Password is UTF-8.
   ```ts
   const salt = crypto.randomBytes(8).toString("hex");
   const t = crypto.createHash("md5").update(password + salt).digest("hex");
   // URL: ?u=alice&t=<t>&s=<salt>&v=1.16.1&c=my-app&f=json
   ```

3. **OpenSubsonic `apiKey` extension replaces `u`+`p`/`t`/`s` entirely.** When sending `apiKey=<key>` you **must not** send `u` — server returns error **43 "Multiple conflicting authentication mechanisms"**. New error codes: **42** unsupported mechanism, **43** conflict, **44** (reserved). Always call `getOpenSubsonicExtensions` first to confirm `apiKeyAuthentication` is available before switching. See [references/authentication.md](references/authentication.md).

4. **`status="failed"` is returned inside an HTTP 200.** Do not rely on HTTP status. Always parse `subsonic-response.status` and `subsonic-response.error.{code,message,helpUrl}`. The `helpUrl` field is an OpenSubsonic addition — show it to the user verbatim.

5. **The response envelope carries `openSubsonic: true`, `type`, `serverVersion`, `serverName` only when the server supports OpenSubsonic.** These four fields are your server-capability flag. Do not access OS-only fields on songs/albums (e.g. `musicBrainzId`, `replayGain`, `contributors`, `moods`, `sortName`) unless `openSubsonic === true`. See [references/opensubsonic-extensions.md](references/opensubsonic-extensions.md).

6. **IDs in Navidrome are always strings** (MD5 hashes or UUIDs, opaque). Legacy Subsonic used numeric IDs. Type every `id`, `albumId`, `artistId`, `coverArtId`, `playlistId` as `string` — do not `parseInt`, do not compare numerically.

7. **The `stream` endpoint NEVER increments playcount.** Playback tracking is two separate calls:
   ```ts
   // 1. On playback start
   await client.get("scrobble", { id, submission: "false", time: Date.now() });
   // 2. After ≥50% played OR ≥4 minutes continuous (Supersonic's heuristic)
   await client.get("scrobble", { id, submission: "true", time: startedAtMs });
   ```
   OpenSubsonic-aware clients can use the `playbackReport` extension (`reportPlayback`) for richer event types (position, pause, seek). Mix: use `scrobble` for server-side tracking (Navidrome forwards to Last.fm/ListenBrainz), `reportPlayback` for UX telemetry.

8. **Always prefer the `...2` / `...3` endpoint variants** on modern servers: `getArtists`, `getAlbumList2`, `getStarred2`, `search3`, `getArtistInfo2`, `getAlbumInfo2`, `getSimilarSongs2`. They're ID3-tag-based rather than folder-based and return stable, richer data on Navidrome. The unnumbered versions simulate a folder tree.

9. **Navidrome's `search3` does not parse Lucene syntax** — it's substring matching with tokenization. `AND`/`OR`/`title:foo` are **not** honored; they're matched as literal substrings. Just pass the user's raw query. Use `artistCount`/`albumCount`/`songCount` + `*Offset` to paginate each bucket independently.

10. **Transcoding knobs live on `stream`:** `format=raw` disables transcoding entirely (original bytes), `format=mp3` forces re-encode, `maxBitRate=0` means no cap (numeric otherwise, kbps), `estimateContentLength=true` makes the server emit `Content-Length` so players show a seek bar, `timeOffset=<sec>` requires the `transcodeOffset` extension for audio (video-only by default in legacy). See [references/streaming-and-transcoding.md](references/streaming-and-transcoding.md).

11. **Navidrome-specific quirks that break spec-compliant clients:**
    - No video endpoints — `getVideos`, `getVideoInfo`, `getCaptions` return error 70.
    - `getIndexes` is a simulation (no real folder browsing); no `children`/`shortcut` support.
    - `getUser` / `getUsers` **ignore the `username` parameter** and return only the authenticated user (unless admin).
    - `getAvatar` redirects to Gravatar or a placeholder.
    - `getPlayQueue.current` is a **string** ID, not an integer.
    - `startScan` accepts a non-standard `fullScan=true` parameter.
    - Upgrade to Navidrome **≥0.54.1** — earlier versions have **[CVE-2025-27112](https://github.com/advisories/GHSA-c3p4-vm8f-386p)**, Subsonic authbypass on non-existent username.
    - Full list in [references/navidrome-specifics.md](references/navidrome-specifics.md).

12. **Subagent delegation.** This skill does **not** auto-activate in subagent sessions. When spawning an agent that will write Subsonic/Navidrome code, pass the relevant reference-file paths inline (e.g. `subsonic-api/references/authentication.md`, `endpoints-reference.md`, `streaming-and-transcoding.md`) or inline the Critical Concepts block above into the agent prompt. Also pass the target server's capability report from `scripts/check-server.mjs` so the agent knows which extensions it can use.

## References

Each file is standalone — load only what the current task needs.

### Core

| Topic | Description | Reference |
|-------|-------------|-----------|
| Authentication | `token`+`salt` MD5 recipe, `apiKey` ext, form POST ext, Navidrome reverse-proxy auth, CVE-2025-27112 | [authentication](references/authentication.md) |
| Endpoints reference | Full catalog by category × Navidrome support matrix (✅/⚠️/❌) + OS-only markers | [endpoints-reference](references/endpoints-reference.md) |
| Errors & debugging | Codes 0/10/20/30/40/41/42/43/44/50/60/70, status=failed in HTTP 200, request-logging patterns | [errors-and-debugging](references/errors-and-debugging.md) |
| OpenSubsonic extensions | Catalog + discovery flow + feature-detection code snippets | [opensubsonic-extensions](references/opensubsonic-extensions.md) |

### Playback & Library

| Topic | Description | Reference |
|-------|-------------|-----------|
| Browsing & search | Home feed (`getAlbumList2` types), artist→album→song drill-down, `search3` gotchas | [browsing-and-search](references/browsing-and-search.md) |
| Streaming & transcoding | `stream` params, HLS, `download`, `format=raw`, `maxBitRate`, pre-signed URLs for `<audio>` | [streaming-and-transcoding](references/streaming-and-transcoding.md) |
| Playlists & queue | Playlist CRUD, `updatePlaylist` batching, `.m3u` import, `getPlayQueue`/`savePlayQueue`, `indexBasedQueue` | [playlists-and-queue](references/playlists-and-queue.md) |
| Annotations & playback | `star`/`unstar`/`setRating`, `scrobble` submission heuristic, `reportPlayback` ext | [annotations-and-playback](references/annotations-and-playback.md) |
| Lyrics & covers | `getLyrics` (legacy), `getLyricsBySongId` (songLyrics ext, synced LRC), `getCoverArt` sizing | [lyrics-and-covers](references/lyrics-and-covers.md) |

### Server-specific

| Topic | Description | Reference |
|-------|-------------|-----------|
| Navidrome specifics | Base URL, CORS, multi-library, ID-strings, no-video, reverse-proxy, plugins (WASM), Last.fm/ListenBrainz | [navidrome-specifics](references/navidrome-specifics.md) |
| Navidrome native API | **Unstable** `/api/*` JWT REST — `/auth/login`, react-admin pagination, admin endpoints, SSE `/api/events` | [navidrome-native-api](references/navidrome-native-api.md) |
| Smart playlists grammar | Full Navidrome rule DSL — every field, every operator, nested `all`/`any`, `limitPercent`, `.nsp` files | [smart-playlists](references/smart-playlists.md) |

### Integration

| Topic | Description | Reference |
|-------|-------------|-----------|
| Client libraries | Comparison of `@audioling/open-subsonic-api-client` / `subsonic-api` / `@vmohammad/subsonic-api` / `subsonicjs` + when to roll your own, server compatibility matrix | [client-libraries](references/client-libraries.md) |
| Integration patterns | Node/Bun/Deno, Hono/Elysia/Express proxy, browser SPA (CORS), Cloudflare Workers, caching strategies | [integration-patterns](references/integration-patterns.md) |

## Templates

Ready-to-copy files under [`templates/`](templates/):

| File | What it is |
|------|------------|
| [`audioling-client.ts`](templates/audioling-client.ts) | Quick-Start default — wraps `@audioling/open-subsonic-api-client` with feature-detection helper |
| [`minimal-client.ts`](templates/minimal-client.ts) | Zero-dep `fetch` + Web Crypto (Node/Bun/Deno/Workers/browser) — ~80 lines, MIT, copy-paste |
| [`apikey-client.ts`](templates/apikey-client.ts) | `apiKey=` flow with runtime guard against `apiKeyAuthentication` extension |
| [`navidrome-native-client.ts`](templates/navidrome-native-client.ts) | JWT client for `/api/*` (react-admin pagination, x-nd-authorization refresh) |
| [`hono-proxy.ts`](templates/hono-proxy.ts) | Reverse proxy that hides creds and fixes CORS for browser SPAs |

## Runnable example

- [`examples/home-feed.ts`](examples/home-feed.ts) — load recent/starred/random albums, print first song stream URL. `bun run examples/home-feed.ts` with env `NAVIDROME_URL`/`USER`/`PASS`.

## On-demand docs

Primary sources — fetch these when a local reference is missing a detail:

- https://opensubsonic.netlify.app/docs/ — spec overview
- https://opensubsonic.netlify.app/docs/api-reference/ — every endpoint, every field
- https://opensubsonic.netlify.app/docs/extensions/ — each extension as its own page
- https://opensubsonic.netlify.app/docs/openapi/ — OpenAPI 3 schema (JSON)
- https://www.subsonic.org/pages/api.jsp — canonical Subsonic 1.16.1 (legacy)
- https://www.navidrome.org/docs/developers/subsonic-api/ — Navidrome's own compatibility notes
- https://github.com/opensubsonic/open-subsonic-api — spec discussions & proposals
- https://deepwiki.com/navidrome/navidrome — reverse-engineered architecture wiki
