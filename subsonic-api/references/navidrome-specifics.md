# Navidrome specifics

Everything that differs between the Subsonic/OpenSubsonic spec and what Navidrome actually does.

## Base URL

- Default: `https://<host>/rest/<method>.view`
- Behind a subpath (mounted under `/music`): set `ND_BASEURL=/music` in the server env; clients must then use `https://<host>/music/rest/<method>.view`.
- The `.view` suffix is accepted and omittable on Navidrome. Legacy Subsonic servers require it — always include it in code meant to run against arbitrary servers.
- HTTPS is expected. HTTP is only safe on localhost / LAN; the token+salt scheme leaks to MITM.

## CORS

Navidrome serves `/rest/*` with permissive CORS by default — `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: *`. Browser SPAs can call the Subsonic API **directly** without a proxy.

Exceptions:
- Custom reverse-proxy configurations may strip these headers — test with your deployment.
- The native `/api/*` endpoints are **not** permissively CORS'd — only same-origin requests from the WebUI are allowed by default.

For production multi-tenant browser apps, still route through a server proxy to avoid exposing user credentials in client JS. See [integration-patterns.md](integration-patterns.md).

## IDs are strings

Every `id`, `albumId`, `artistId`, `coverArtId`, `playlistId`, `shareId` is a **string** — usually a 32-char MD5 or a UUID. Never:

```ts
const id: number = Number(song.id); // ❌ silent data loss
const next = parseInt(song.id) + 1; // ❌ meaningless
```

Legacy Subsonic used numeric IDs; clients written against that assumption need fixing. Use `string` everywhere.

## Multi-library

Navidrome supports multiple music libraries per server (introduced in 0.51). Endpoints that accept `musicFolderId`:

- `getMusicFolders` → lists libraries the **authenticated user** can access (admin grants).
- `getArtists`, `getAlbumList2`, `getRandomSongs`, `getSongsByGenre`, `search3`, `getStarred2`, `getGenres` → optional `musicFolderId` scopes the query.
- `startScan` scans all libraries by default; no per-library param.
- Only a single `musicFolderId` per request — combine multiple via client-side merging.

## No video, no jukebox, no chat

- `getVideos`, `getVideoInfo`, `getCaptions`, `hls` → error 70 (data not found).
- `jukeboxControl` → not implemented (Navidrome is a streaming server, not a player controller). Error 70.
- `getChatMessages`, `addChatMessage` → not implemented.

Plan UIs accordingly — hide these features entirely or run feature-detection.

## No real folder browsing

Navidrome organises music by ID3 tags, not filesystem hierarchy. `getIndexes` and `getMusicDirectory` return **synthetic** folder trees built from tags — consistent and stable, but don't map to what's on disk. Always prefer `getArtists` → `getArtist` → `getAlbum` → songs.

## `search3` has no Lucene

Legacy Subsonic (based on Airsonic) parsed Lucene query syntax. **Navidrome does not** — it tokenises the input and does case-insensitive substring matching across artist/album/song titles. Given `query="Beatles Abbey"`:

- Legacy: would reject the quote/syntax error.
- Navidrome: splits into `["Beatles", "Abbey"]` and returns records containing **both** tokens.

So: pass the raw user input, paginate via `*Count` + `*Offset` per bucket (artist/album/song), and don't try to use `AND`/`OR`/field selectors — they'll be treated as substrings.

## User endpoints are self-only for non-admins

- `getUser?username=foo` → ignored; returns the caller.
- `getUsers` → returns a single-element array with the caller.
- Only admin users get the full listing / arbitrary-user queries. Everything else is 403-like (error 50) or silently self-scoped.

Clients displaying "manage users" should check admin status first:

```ts
const me = (await client.get("getUser", {})).user;
if (me.adminRole) { /* show user management UI */ }
```

## `getAvatar` is a redirect

`/rest/getAvatar.view?username=alice` returns a 302 to:
1. The user's Gravatar (if they have an email registered), or
2. A placeholder PNG generated from the username's hash.

Clients should follow redirects. Do not cache the redirect target — the user can change their email/Gravatar at any time; rely on HTTP cache-control headers instead.

## Scan control

```
getScanStatus → { scanning, count, folderCount, lastScan }
startScan      → accepts ?fullScan=true to force full rescan (not just changed files)
```

Background scans are incremental by default. The `fullScan` parameter is a Navidrome extension on top of Subsonic — other servers will ignore it.

## Reverse-proxy authentication

Common deployment: Navidrome behind Authelia/oauth2-proxy/Traefik-ForwardAuth. Config:

```toml
ReverseProxyUserHeader  = "X-Forwarded-User"   # header the trusted proxy injects
ReverseProxyWhitelist   = "10.0.0.0/8,127.0.0.1/32"
```

- Navidrome only trusts the header when the request comes from a whitelisted CIDR.
- Subsonic API calls still require `u=<username>` to route authorisation, but `t`/`s`/`p` are **ignored** (the proxy has already authenticated).
- **Do not** ship clients that assume reverse-proxy auth — it's a server-side deployment choice. But **do** document it as a supported mode.

Full matrix: https://www.navidrome.org/docs/usage/integration/authentication/

## Agents (metadata & scrobbling)

Navidrome proxies external services via "agents":

- **Embedded** (built-in): ID3/Vorbis tags, embedded artwork, embedded LRC lyrics.
- **Last.fm agent**: artist bio, similar artists, top songs, scrobble forwarding.
- **Spotify agent**: artist images (requires client-id/secret).
- **ListenBrainz agent**: scrobble forwarding, listens sync.
- **WASM plugins** (0.56+): custom agents written in Rust/Go/AssemblyScript via the `/api/plugin` endpoint.

Implications for clients:
- `getArtistInfo2`, `getAlbumInfo2`, `getSimilarSongs2`, `getTopSongs` return useful data **only** when Last.fm agent is configured. Check for empty responses and degrade gracefully.
- `scrobble` with `submission=true` triggers server-side forwarding to every configured scrobble agent. **Never** scrobble to Last.fm/ListenBrainz directly from the client when connected to Navidrome — you'll double-count.

## CVE-2025-27112

Navidrome versions **< 0.54.1** had a Subsonic API authbypass on non-existent usernames. Upgrade. Clients can detect vulnerable servers by calling `ping` with a nonsense username and garbage token — a vulnerable server returns `status="ok"`, a fixed one returns error 40.

Advisory: https://github.com/advisories/GHSA-c3p4-vm8f-386p

## Useful server env vars (`ND_*`)

These affect client-observable behaviour:

| Env var | Default | Affects |
|---------|---------|---------|
| `ND_BASEURL` | `/` | Subpath mount. Clients must prepend. |
| `ND_PORT` | `4533` | |
| `ND_SCANSCHEDULE` | `1h` | How often the server rescans. |
| `ND_TRANSCODINGCACHESIZE` | `100MB` | Cap on cached transcoded files. 0 disables caching. |
| `ND_IMAGECACHESIZE` | `100MB` | Cover-art cache. |
| `ND_ENABLESHARING` | `false` | Gates all `/rest/{get,create,update,delete}Share` endpoints. |
| `ND_ENABLEGRAVATAR` | `false` | If disabled, `getAvatar` serves the placeholder only. |
| `ND_ENABLECOVERANIMATION` | `true` | Preserves animated cover art (GIF/WebP). |
| `ND_DEFAULTLANGUAGE` | `en` | Affects lyric provider fallbacks. |
| `ND_REVERSEPROXYUSERHEADER` | — | Proxy auth (see above). |

Full list: https://www.navidrome.org/docs/usage/configuration/options/

## Plugin subsystem (0.56+)

WASM plugins live in `/data/plugins/` and are managed via the native admin API (`/api/plugin`). Public-facing changes they can introduce:

- New metadata agents (custom Last.fm alternatives).
- Custom scrobble sinks.
- Import/export hooks.

Clients **cannot** introspect loaded plugins via the Subsonic API — use the native `/api/plugin` endpoint if admin access is available, else treat plugin-introduced fields as opaque OpenSubsonic additions.
