# Navidrome native `/api/*` JWT REST

> ⚠️  **UNSTABLE.** This is the JSON REST that powers Navidrome's own WebUI — it is officially *"subject to change on every Navidrome release"*. There are no backwards-compatibility guarantees and no formal spec. **Prefer the Subsonic API whenever it covers your use case.**
>
> Use the native API only when Subsonic API cannot do what you need:
> - Admin operations (user management UI, plugin toggles, library config, scan-source setup).
> - Smart-playlist evaluation & rule editing.
> - Bulk admin queries (missing files, orphans).
> - Listening to server-side events (library scan progress, user notifications).
>
> Reverse-engineered from the Feishin / Supersonic / Navidrome source. Double-check against your installed Navidrome version before relying on anything here.

## Base path

- **Base:** `<baseUrl>/api/<resource>`
- **Router:** go-chi ([source](https://github.com/navidrome/navidrome/tree/master/server/nativeapi)).
- **Auth lives OUTSIDE `/api`** — `POST /auth/login` (public route).

## Authentication

```http
POST /auth/login HTTP/1.1
Content-Type: application/json

{ "username": "alice", "password": "hunter2" }
```

Response:

```json
{
    "id": "user-id",
    "name": "alice",
    "username": "alice",
    "isAdmin": false,
    "token": "<JWT>",
    "subsonicSalt": "...",       // can be reused for Subsonic API calls
    "subsonicToken": "..."
}
```

### Using the token

Every `/api/*` request:

```
x-nd-authorization: Bearer <token>
```

The server **rotates the token on every successful request** and returns the refreshed JWT in the same `x-nd-authorization` response header. Clients **must** read this header and persist the new token, else the session expires ~48h later (default `ND_SESSIONTIMEOUT`).

### Legacy path

Some older Navidrome builds used `POST /api/authenticate` instead of `/auth/login`. A robust client tries both, caching the one that responds successfully. The [`templates/navidrome-native-client.ts`](../templates/navidrome-native-client.ts) implements this.

## React-admin-style conventions

Every list endpoint accepts:

| Param | Example | Meaning |
|-------|---------|---------|
| `_sort` | `title` | Field to sort by. Per-resource — see the repo file (`server/nativeapi/*_repository.go`) for allowed fields. |
| `_order` | `ASC` / `DESC` | |
| `_start` | `0` | Offset. |
| `_end` | `50` | Upper bound (NOT a count — `end - start` is the page size). |
| `filter` | `{"genre":"Rock"}` | **JSON-encoded** object. Per-resource allowed keys. |

Response includes a **`X-Total-Count`** response header — use it for pagination UIs.

## Publicly accessible resources

| Resource | Path | CRUD | Purpose |
|----------|------|------|---------|
| Songs | `/api/song` | R | Metadata for a song + listings. |
| Albums | `/api/album` | R | |
| Artists | `/api/artist` | R | |
| Genres | `/api/genre` | R | |
| Tags | `/api/tag` | R | Custom tags (roles, moods, contributors). |
| Playlists | `/api/playlist` | CRUD | Create/rename/delete. Supports smart playlists via `rules` field. |
| Playlist tracks | `/api/playlist/:id/tracks` | CRUD | Batch add/remove/reorder tracks on a playlist. Body: `{ ids: string[] }`. |
| Shares | `/api/share` | CRUD | Share-link management (if `ND_ENABLESHARING=true`). |
| User (self) | `/api/user` | R / partial U | Reads own profile; admins see all users. |

## Admin-only resources

Return 403 for non-admin tokens:

| Resource | Path | Purpose |
|----------|------|---------|
| Config | `/api/config` | View / mutate `Server.*` config values (excluding secrets). |
| Plugins | `/api/plugin` | List, enable, disable, configure WASM plugins. |
| Libraries | `/api/library` | Manage music-library paths and their per-library options. |
| Missing files | `/api/missing` | Files present in the DB but not on disk (after a scan). |

## Server-Sent Events

```
GET /api/events?jwt=<token>
```

EventSource does **not** support custom headers — the JWT rides in the query string. Events are JSON-encoded in `data:` fields and include:

- `scan_progress` — during a library scan.
- `server_start` — on server restart (invalidate client caches).
- `refresh_resource` — React-admin hint: resource `x` has changed, re-fetch it.
- `notify` — user-visible notifications.

### Example

```ts
const src = new EventSource(`${baseUrl}/api/events?jwt=${token}`);
src.addEventListener("message", (ev) => {
    const payload = JSON.parse(ev.data);
    // { event: "scan_progress", data: { count: 1234, total: 5678 } }
});
```

When the token rotates (via a regular `/api/*` call), the SSE connection stays on the old token until it drops — reconnect with the fresh token periodically, or treat the old session as sufficient for idle monitoring.

## Example: bulk admin query

Find all playlists with no tracks (candidate for cleanup):

```ts
const nav = new NavidromeNativeClient({ baseUrl: "https://nav.example.com" });
await nav.login("admin", "pw");

const { items, total } = await nav.list<{ id: string; name: string; songCount: number }>(
    "playlist",
    {
        sort: "changed",
        order: "DESC",
        start: 0,
        end: 500,
        filter: { songCount: 0 },
    },
);
// Now iterate + DELETE each id via nav.remove("playlist", id).
```

## Example: smart playlist creation

Smart playlists store rules server-side (evaluated on every access). The shape mirrors Navidrome's WebUI builder:

```ts
await nav.create("playlist", {
    name: "Rock from the 70s (≥4★)",
    public: false,
    rules: {
        all: [
            { field: "genre", operator: "is", value: "Rock" },
            { field: "year", operator: "inTheRange", value: [1970, 1979] },
            { field: "rating", operator: "gte", value: 4 },
        ],
        sort: "random",
        limit: 100,
    },
});
```

Full grammar — every field, every operator, nesting rules, `limitPercent`, `.nsp` filesystem format — is in [smart-playlists.md](smart-playlists.md).

## When NOT to use the native API

- **Playback** — use Subsonic `stream`. Native `/api/song/:id` returns metadata, not audio.
- **Browse for a music-player UI** — use Subsonic browse endpoints. They're stable and cross-server.
- **Scrobbling** — use Subsonic `scrobble`. Native API has no equivalent.
- **Cover art** — use Subsonic `getCoverArt`. Native API doesn't serve images.

## Alternative: Navidrome MCP

For agentic access to a Navidrome library, there's a community MCP server ([Blakeem/Navidrome-MCP](https://github.com/Blakeem/Navidrome-MCP)) that wraps both Subsonic and native APIs in tool calls. Useful for non-client integrations (chatbots, automation).
