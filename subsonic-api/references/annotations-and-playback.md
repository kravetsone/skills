# Annotations & playback reporting

## Stars & ratings

Persistent user annotations on songs, albums, and artists.

### star / unstar

```ts
await client.get("star", { id: "song-id" });
await client.get("star", { albumId: "album-id" });
await client.get("star", { artistId: "artist-id" });

// Bulk — all three are repeatable
await client.get("star", {
    id: ["song1", "song2"],
    albumId: ["album1"],
    artistId: ["artist1"],
});

await client.get("unstar", { id: "song-id" });
```

Servers allow any combination of `id`/`albumId`/`artistId` in a single call. On Navidrome, stars affect what shows up in `getStarred2`, and (when Last.fm agent is enabled) can be mirrored as Last.fm "loves".

### setRating

```ts
await client.get("setRating", { id: "song-id", rating: 4 }); // 0..5
```

Ratings are per-user. Rating `0` clears the rating. Used by `getAlbumList2?type=highest`.

## Scrobble — the playcount protocol

`scrobble` is a **two-phase** API call per play:

1. **Now playing** (on playback start):
   ```ts
   await client.get("scrobble", {
       id: "song-id",
       submission: "false",
       time: Date.now(),   // ms epoch
   });
   ```
   Marks the song as "currently playing" in `getNowPlaying`. Does **not** count as a play.

2. **Submission** (after the user has "really listened"):
   ```ts
   await client.get("scrobble", {
       id: "song-id",
       submission: "true",
       time: startedAtMs,  // when playback STARTED, not now
   });
   ```
   Increments playcount, adds to "recently played", forwards to configured scrobble agents (Last.fm, ListenBrainz).

### The "really listened" heuristic

Following Supersonic / Sonixd / Last.fm conventions:

```ts
function shouldSubmit(playedMs: number, durationMs: number): boolean {
    return playedMs >= Math.min(durationMs * 0.5, 4 * 60 * 1000);
}
```

**Submit when played ≥ 50% of the track OR ≥ 4 minutes continuously.** Whichever comes first. Skip if user pauses and never resumes, or if user skips before the threshold.

```ts
class ScrobbleTracker {
    private startedAt = 0;
    private playedMs = 0;
    private submitted = false;

    onPlay(song: { id: string; duration: number }) {
        this.startedAt = Date.now();
        this.playedMs = 0;
        this.submitted = false;
        client.get("scrobble", { id: song.id, submission: "false", time: this.startedAt });
    }
    onTick(song: { id: string; duration: number }, deltaMs: number) {
        this.playedMs += deltaMs;
        if (!this.submitted && shouldSubmit(this.playedMs, song.duration * 1000)) {
            client.get("scrobble", { id: song.id, submission: "true", time: this.startedAt });
            this.submitted = true;
        }
    }
}
```

`time` should be the **playback start** epoch, not the submission time — the server uses it to order the play history correctly.

### Don't double-scrobble

When connected to Navidrome, the server forwards submissions to Last.fm/ListenBrainz via agents. **Never** scrobble directly from the client to those services in parallel — you'll double-count. Let the server be the source of truth.

### Offline queue

`scrobble` can be called with historical `time` values. In offline modes:

```ts
// While offline: push to local queue
queue.push({ id, submission: "true", time: Date.now() });

// On reconnect: drain
for (const item of queue) {
    try { await client.get("scrobble", item); }
    catch (err) { /* stop on transient errors, retry later */ }
}
```

Navidrome accepts submissions up to several weeks old. For longer staleness, the server may refuse — log and drop.

## reportPlayback extension (OpenSubsonic)

When the server advertises `playbackReport`:

```ts
await client.get("reportPlayback", {
    id: "song-id",
    event: "play" | "pause" | "seek" | "stop",
    position: 45000,       // ms into the song
    time: Date.now(),
});
```

Richer than scrobble — gives the server exact event telemetry, useful for "continue where you left off" across devices. Does **not** replace `scrobble`; use both:

- `scrobble` → playcount, history, external services.
- `reportPlayback` → fine-grained position/event log for the server's own UX features.

Feature-detect:

```ts
const hasReport = (await client.extensions()).some((e) => e.name === "playbackReport");
```

## Bookmarks (seekable resume for long tracks)

Separate from play queue — bookmarks are per-song, persistent, explicit saves. Ideal for podcasts and audiobooks.

```ts
await client.get("createBookmark", {
    id: "song-id",
    position: 1_234_567,    // ms
    comment: "Chapter 4 start",
});

const { bookmarks } = await client.get("getBookmarks");
// bookmarks.bookmark: [{ entry: {id, title, ...}, position, comment, created }]

await client.get("deleteBookmark", { id: "song-id" });
```

Only one bookmark per song per user. Re-creating overwrites.

## Common bugs

- **Forgot `submission=true`** → only "now playing" pings are sent; playcount never increments.
- **`time` is current time, not start time** → scrobble history is misordered.
- **Calling `scrobble` from the server + client** → double counts.
- **Sending submissions faster than the track duration** → some servers reject as "impossible"; guard with the heuristic.
- **Forgetting to `scrobble` on podcast episodes** → same protocol, same endpoint; podcast episodes have song-like IDs.
