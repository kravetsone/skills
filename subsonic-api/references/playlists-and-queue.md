# Playlists & play queue

Two related but distinct features:

- **Playlists** — user-curated collections, persistent server-side, shareable.
- **Play queue** — the in-flight list of tracks a client is playing right now, synced across a user's devices.

## Playlist CRUD

### List

```ts
const { playlists } = await client.get("getPlaylists");
// playlists.playlist: [{ id, name, songCount, duration, owner, public, created, changed, coverArt }]
```

Navidrome's `getPlaylists` **ignores** the `username` param — it returns the caller's own playlists plus any `public: true` playlists.

### Read

```ts
const { playlist } = await client.get("getPlaylist", { id: "pl-id" });
// playlist.entry: [{ id, title, artist, album, duration, track, ... }]
```

### Create

Two forms:

```ts
// Form A: new playlist by name with initial songs
await client.get("createPlaylist", {
    name: "My mix",
    // Repeat songId for each track — minimal-client serialises arrays as repeated params.
    songId: ["song1", "song2", "song3"],
});

// Form B: overwrite an existing playlist (replaces all tracks)
await client.get("createPlaylist", {
    playlistId: "pl-id",
    songId: ["song1", "song2"],
});
```

### Update (batched)

```ts
await client.get("updatePlaylist", {
    playlistId: "pl-id",
    name: "Renamed mix",
    comment: "Updated 2026",
    public: true,
    songIdToAdd: ["song4", "song5"],       // append these
    songIndexToRemove: [0, 2],             // remove by zero-based index (BEFORE appends)
});
```

- `songIndexToRemove` operates on the **current** playlist state, before `songIdToAdd` applies.
- Pass the same param name multiple times for arrays: `songIdToAdd=x&songIdToAdd=y`.
- For large batches (>50 IDs): use the `formPost` extension and POST the form body to avoid URL length limits.

### Delete

```ts
await client.get("deletePlaylist", { id: "pl-id" });
```

## Importing playlists

Navidrome auto-imports `.m3u`/`.m3u8` files found in the library on scan (see `ND_PLAYLISTSPATH`). There's no Subsonic endpoint to upload a playlist file directly — workarounds:

1. Write the `.m3u` to the watched playlists directory on the server (requires filesystem access, not API).
2. Use the **native** `/api/playlist` POST endpoint (parses .m3u content in body). Unstable API. See [navidrome-native-api.md](navidrome-native-api.md).
3. Create empty via `createPlaylist`, then `updatePlaylist` with batched `songIdToAdd=`. Scales to hundreds of tracks with `formPost`.

## Play queue (current playback state)

Persists across devices so a user can pause on desktop and resume on mobile.

```ts
// Save the current queue state
await client.get("savePlayQueue", {
    id: ["song1", "song2", "song3"],    // ordered list of song IDs
    current: "song2",                   // currently playing — note: Navidrome returns this as a STRING
    position: 45000,                    // ms into the current song
});

// Restore on another device
const { playQueue } = await client.get("getPlayQueue");
// playQueue: { current: "song2" (string), position: 45000, entry: [{ id, ... }], changed, changedBy }
```

Fields:

| Field | Type | Notes |
|-------|------|-------|
| `current` | string | Song ID. **String on Navidrome** (integer on legacy Subsonic). |
| `position` | int | Milliseconds offset into the current song. |
| `entry` | array | Song metadata (fetched at save time). |
| `changed` | ISO8601 | Last modification timestamp. |
| `changedBy` | string | Client name (the `c=` param) that last saved. |

Use `changedBy` to show "Syncing from iPad" indicators in multi-device UIs.

## `indexBasedQueue` extension

OpenSubsonic adds position-aware queue endpoints:

```ts
const { playQueueByIndex } = await client.get("getPlayQueueByIndex");
// Returns: { entry: [...], currentIndex: 1, position: 45000 }

await client.get("savePlayQueueByIndex", {
    id: ["s1", "s2", "s3"],
    currentIndex: 1,
    position: 45000,
});
```

Difference from the legacy endpoints: `current` is an **integer index** (0-based) into the `id` array, not a song ID. This handles edge cases where the queue contains duplicates of the same song.

Feature-detect via `getOpenSubsonicExtensions`:

```ts
const usesIndexQueue = (await client.extensions()).some((e) => e.name === "indexBasedQueue");
```

## Edge cases

- **Empty queue:** `getPlayQueue` returns `status="ok"` but no `playQueue` object at all. Treat as "nothing saved yet".
- **Clearing the queue:** `savePlayQueue` with no `id=` params. Some clients pass `id=""` — Navidrome accepts either.
- **Very long queues:** Subsonic's URL-based protocol caps around 500 IDs per request (URL length). For longer queues, the `formPost` extension is essential.
- **Per-client queues:** Saved queues are scoped by `c=<clientName>` in some implementations but per-user in Navidrome. If two devices share a user + client name, they compete — give each deployment a distinct `c=` (e.g. `my-app-ios`, `my-app-web`).
