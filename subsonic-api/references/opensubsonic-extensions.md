# OpenSubsonic extensions

OpenSubsonic is a superset of Subsonic 1.16.1. Every extension is **opt-in and discoverable**: clients ask the server what it supports, then feature-detect per feature.

## Discovery

```ts
const { openSubsonicExtensions } = await client.get<{
    openSubsonicExtensions: Array<{ name: string; versions: number[] }>;
}>("getOpenSubsonicExtensions");
// [{ name: "apiKeyAuthentication", versions: [1] }, { name: "songLyrics", versions: [1] }, ...]
```

**`getOpenSubsonicExtensions` is callable without authentication** per spec — probe even before logging in. If the server returns HTTP 404 or `status="failed"` code 70, it's a legacy Subsonic server (no extensions available).

Also gate on the response envelope:

```ts
const { ["subsonic-response"]: env } = pingResponse;
const isOpenSubsonic = env.openSubsonic === true;
if (!isOpenSubsonic) {
    // No extensions. Fall back to Subsonic 1.16.1 feature set.
}
```

## Feature-detection helper

```ts
function createExtensionChecker(extensions: Array<{ name: string; versions: number[] }>) {
    const map = new Map(extensions.map((e) => [e.name, new Set(e.versions)]));
    return (name: string, minVersion = 1) => {
        const v = map.get(name);
        return v !== undefined && [...v].some((n) => n >= minVersion);
    };
}

const has = createExtensionChecker(await client.extensions());
if (has("songLyrics")) { /* use getLyricsBySongId */ }
if (has("apiKeyAuthentication")) { /* offer API key flow */ }
```

## Extension catalogue

### `apiKeyAuthentication`

Replaces `u`+`p`/`t`/`s` with a single `apiKey=<key>` query parameter.

- New error codes: 42 (unsupported mechanism), 43 (conflict with `u=`), 44 (reserved).
- All error responses may carry a `helpUrl` guiding users to obtain/manage keys.
- Key provisioning is implementation-specific — Navidrome exposes keys in user settings.

See [authentication.md](authentication.md) for full flow.

### `formPost`

Allows `POST application/x-www-form-urlencoded` bodies instead of URL-based params. Solves URL-length issues with large `updatePlaylist`, `savePlayQueue`, batch `star`, etc.

```http
POST /rest/updatePlaylist.view HTTP/1.1
Content-Type: application/x-www-form-urlencoded

playlistId=abc&songIdToAdd=a&songIdToAdd=b&...&u=alice&t=...&s=...&v=1.16.1&c=my-app&f=json
```

Fall back to GET + URL-chunking when unsupported.

### `songLyrics`

Adds `getLyricsBySongId` endpoint + structured lyric responses with synced LRC timestamps.

```ts
const { lyricsList } = await client.get("getLyricsBySongId", { id: "song-id" });
// lyricsList.structuredLyrics: [{ synced, lang, offset, line: [{ start, value }] }]
```

See [lyrics-and-covers.md](lyrics-and-covers.md).

### `transcodeOffset`

Lets `stream?timeOffset=<sec>` work for **audio** files. In legacy Subsonic, `timeOffset` was video-only.

```ts
const resumeUrl = client.streamUrl(song.id, {
    timeOffset: 45,   // seek 45 s into the audio (server transcodes from that point)
    format: "opus",
});
```

Useful for "continue listening" and chapter navigation in long-form audio.

### `indexBasedQueue`

Adds `getPlayQueueByIndex` / `savePlayQueueByIndex`. Tracks the currently playing entry by **numeric index** into the queue array instead of by song ID — handles queues containing duplicates of the same song.

See [playlists-and-queue.md](playlists-and-queue.md).

### `playbackReport`

Adds `reportPlayback` endpoint — richer playback telemetry.

```ts
await client.get("reportPlayback", {
    id: "song-id",
    event: "play" | "pause" | "seek" | "stop",
    position: 45000,
    time: Date.now(),
});
```

Supplements `scrobble` (which handles playcount + external service forwarding). Used by servers for "resume where you left off", per-device listening timelines, etc.

### `transcoding`

A high-level capabilities descriptor that lists the audio formats a server can transcode to (e.g. `mp3`, `opus`, `aac`, `flac`). Present on Navidrome ≥ 0.61. Use before picking a `format=` for `stream`:

```ts
const exts = await client.extensions();
const tc = exts.find((e) => e.name === "transcoding");
if (tc) {
    // The server advertises transcoding — fetch the supported list
    // (implementation-specific; Navidrome exposes it via native /api/transcoding).
}
```

Absence means the server is pass-through-only — stick to `format=raw`.

### `sonicSimilarity`

Adds `getSonicSimilarTracks` — ML-based audio-feature similarity (not metadata-based like `getSimilarSongs2`, which relies on Last.fm co-listeners).

```ts
const { similarTracks } = await client.get("getSonicSimilarTracks", {
    id: "song-id",
    count: 20,
});
```

On Navidrome this relies on embedding vectors computed by a plugin — requires server-side setup.

### `getPodcastEpisode`

Adds a direct lookup for a single episode (`getPodcastEpisode?id=ep-id`). Legacy Subsonic only let you fetch whole podcast channels and enumerate client-side.

### `tokenInfo`

Returns metadata about the currently used API key — when it expires, what permissions it has, who owns it. Requires `apiKeyAuthentication`.

```ts
const { tokenInfo } = await client.get("tokenInfo");
// { username, validUntil, scopes, ... }  (exact shape per server)
```

### Template extension

A placeholder name used in the OpenSubsonic docs to demonstrate how a new extension is defined. Real servers don't advertise this.

## Extension vs. spec

The OpenSubsonic additions also include **non-extension** field additions to existing endpoints (not gated by the extensions array) — see [browsing-and-search.md](browsing-and-search.md) for the enriched song/album/artist fields (`musicBrainzId`, `replayGain`, `contributors`, `moods`, `displayArtist`, `sortName`, etc.). These are available on **any** OpenSubsonic server (`openSubsonic === true`), not per-extension.

Distinguishing the two:

- **Envelope-wide:** gated by `openSubsonic === true` on `ping` response. Covers enriched fields, `type`/`serverVersion`/`serverName`, `helpUrl` on errors.
- **Per-extension:** gated by appearance in `openSubsonicExtensions`. Covers new endpoints and new auth modes.

## Graceful degradation

```ts
const has = createExtensionChecker(await client.extensions());

// Pick best lyrics API
const lyrics = has("songLyrics")
    ? await client.get("getLyricsBySongId", { id: song.id })
    : await client.get("getLyrics", { artist: song.artist, title: song.title });

// Pick best auth
const authMode = has("apiKeyAuthentication") && userApiKey
    ? "apiKey"
    : "tokenSalt";

// Pick best queue API
const saveQueue = has("indexBasedQueue")
    ? "savePlayQueueByIndex"
    : "savePlayQueue";
```

Make extension usage opt-in per feature — never assume the target server has a specific extension without having probed first. Cache the probe result for the server's lifetime.

## Reference

- Extensions index: https://opensubsonic.netlify.app/docs/extensions/
- Per-extension pages: `https://opensubsonic.netlify.app/docs/extensions/<extension-name>/`
- OpenAPI schema: https://opensubsonic.netlify.app/docs/openapi/
