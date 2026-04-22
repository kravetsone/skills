# Lyrics & cover art

## Cover art (`getCoverArt`)

```ts
const url = client.coverArtUrl(song.coverArt, 300);
// GET /rest/getCoverArt.view?id=<coverArt>&size=300&<auth>
```

| Param | Purpose |
|-------|---------|
| `id` | Cover-art ID (from `song.coverArt`, `album.coverArt`, or `artist.coverArt`). |
| `size` | Integer pixels — server resizes square and caches. Pick based on UI target: 48 for mini-player, 300 for album grid, 600+ for full-screen. |

**Cache aggressively.** Navidrome serves:

```
Cache-Control: public, max-age=315360000
Last-Modified: <ISO>
ETag: "<hash>"
```

Browser: the default HTTP cache handles this. Service Workers can cache blobs indefinitely. IndexedDB for offline persistence.

**Animated covers** (GIF/WebP): preserved on Navidrome when `ND_ENABLECOVERANIMATION=true` (default). Serve at native size — don't request a `size` smaller than the source unless you accept static frames.

## Placeholder / missing art

If the song has no `coverArt` field, the server returns a 404. Handle gracefully:

```ts
<img
  src={song.coverArt ? client.coverArtUrl(song.coverArt, 300) : "/fallback.svg"}
  onError={(e) => (e.currentTarget.src = "/fallback.svg")}
/>
```

On OpenSubsonic servers, `song.coverArt` is always populated (falls back to the album's cover). On legacy Subsonic, individual songs in the same album may have no cover.

## Lyrics — two APIs

### Legacy: `getLyrics?artist=&title=`

```ts
const { lyrics } = await client.get("getLyrics", {
    artist: song.artist,
    title: song.title,
});
// { value: "Plain-text lyrics here\nLine 2\n..." } — no timing info
```

- **Query by artist+title, not by song ID** — fragile when tags have typos.
- Returns plain text only. No sync.
- Navidrome looks up via Last.fm/embedded tags/agents.

### OpenSubsonic: `getLyricsBySongId` (songLyrics extension)

```ts
const { lyricsList } = await client.get("getLyricsBySongId", { id: "song-id" });
// lyricsList.structuredLyrics: [{ lang, displayArtist, displayTitle, offset, synced, line: [{ start, value }] }]
```

- **Query by song ID** — robust.
- Returns an array of candidates (different languages, synced vs. plain).
- Synced variant (`synced: true`) carries timestamps:
  ```json
  {
    "synced": true,
    "lang": "en",
    "line": [
      { "start": 12300, "value": "Is this the real life?" },
      { "start": 15200, "value": "Is this just fantasy?" }
    ]
  }
  ```
- `offset` compensates for lead-in silence (in ms).

Feature-detect first:

```ts
const hasSongLyrics = (await client.extensions()).some((e) => e.name === "songLyrics");
```

Rendering a synced karaoke view:

```ts
function currentLine(lyrics: { start: number; value: string }[], positionMs: number) {
    let idx = 0;
    for (let i = 0; i < lyrics.length; i++) {
        if (lyrics[i].start <= positionMs) idx = i;
        else break;
    }
    return lyrics[idx]?.value ?? "";
}
```

## Lyric sources on Navidrome

Navidrome resolves lyrics from (in order):
1. **Embedded** tags (LRC tags or `USLT` frames on FLAC/MP3/OGG).
2. **Sidecar file** (`.lrc` next to the audio file) — preferred for synced.
3. **Last.fm agent** — if enabled, fetches plain text.
4. **Plugin agents** — any WASM lyric agent registered.

Which source wins depends on Navidrome's `LyricsProviders` config. Clients just get whatever the server returns.

## Lyric performance & caching

Lyrics are small (KBs). Cache in IndexedDB keyed by song ID. On desktop/mobile, preload the next N songs' lyrics while the current one plays — improves perceived responsiveness when users scroll forward.

## RTL & non-Latin lyrics

`value` is UTF-8; render with the document's font stack. For right-to-left scripts (Arabic, Hebrew), wrap lines in a `dir="auto"` container — the browser infers direction per line from Unicode.

## Avatar

```ts
const { coverArt } = await client.get("getAvatar", { username: "alice" });
// Navidrome: redirects to Gravatar or a placeholder PNG.
```

Return type is **binary** (image bytes). Follow redirects; rely on HTTP cache headers rather than caching the response body yourself (user can change their Gravatar at any time).
