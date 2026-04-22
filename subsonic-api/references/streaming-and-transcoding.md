# Streaming & transcoding

## `stream` endpoint

Binary response — the raw or transcoded audio bytes.

```
GET /rest/stream.view?id=<songId>&<other>&<auth>
```

| Param | Type | Default | Purpose |
|-------|------|---------|---------|
| `id` | string | — | **Required.** The song's opaque ID. |
| `maxBitRate` | int (kbps) | user preference | 0 = no limit (pass-through original unless `format` forces transcoding). |
| `format` | string | server default | `mp3`, `opus`, `raw` (no transcode), or any codec the server supports. |
| `timeOffset` | int (sec) | 0 | Seek before streaming. **Audio** only works when the server advertises `transcodeOffset` extension. Video is always supported (and Navidrome has no video). |
| `estimateContentLength` | bool | `false` | `true` → server sets `Content-Length` header, letting the player show a seek bar and duration. Use `true` for transcoded streams. |
| `converted` | bool | `false` | Video-only; Navidrome ignores. |

## Passing stream URLs directly to `<audio>` / players

```ts
const url = client.streamUrl(song.id, {
    format: "mp3",         // force-transcode to mp3 on the wire
    maxBitRate: 192,       // cap at 192 kbps
    estimateContentLength: true,
});

// HTMLAudioElement
const audio = new Audio(url);
await audio.play();
```

The URL is **bearer-equivalent** (`t=`/`s=`/`apiKey=` parameters). Don't paste it in logs, don't embed in publicly shared pages, don't leak via `Referer` headers. If you need to share, use the `createShare` API — it returns a separate, revocable URL.

## Transcoding policy

Navidrome's server picks a transcoding profile based on the user's settings + the client's `c=` identifier. The decision tree:

1. If `format=raw` → always pass original bytes through.
2. Else if `format=<codec>` → force transcode to that codec.
3. Else use the user's "transcoding player" profile (opus 128 by default).

Effective transcoding requires `ffmpeg` installed on the server. Missing ffmpeg → `format=raw` silently (or error depending on version).

## Resume / range requests

Modern servers honour `Range: bytes=<start>-<end>`:

```ts
const res = await fetch(url, { headers: { Range: "bytes=131072-" } });
// res.status === 206 Partial Content
```

Works for **raw** streams (original bytes) and for **transcoded** streams when `estimateContentLength=true` was set on the initial request. Resume across disconnect:

```ts
async function resumableStream(url: string, onChunk: (buf: Uint8Array) => void) {
    let position = 0;
    while (true) {
        const res = await fetch(url, {
            headers: position > 0 ? { Range: `bytes=${position}-` } : {},
        });
        const reader = res.body!.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) return;
            position += value.byteLength;
            onChunk(value);
        }
        // On network error: loop retries with updated position.
    }
}
```

## HLS / DASH

Navidrome does not implement `/rest/hls.m3u8` — it's designed for direct streaming. For adaptive bitrate on mobile networks, use client-side logic: pick `maxBitRate` based on the detected connection speed and re-open the stream if the user roams to worse network.

## Cover art

```ts
const url = client.coverArtUrl(song.coverArt, 300); // 300×300 px (server resizes + caches)
```

Headers on response:

```
Cache-Control: public, max-age=315360000   ← ~10 years
Last-Modified: <ISO>
ETag: ...
```

Cache aggressively. For browser apps, a Service Worker with Cache API works perfectly; on Node servers, `Last-Modified` + `If-Modified-Since` is enough. Navidrome will pass `304 Not Modified` efficiently.

Sizes are flexible (any integer). The server resizes via `libvips` and caches the output under `ND_IMAGECACHESIZE` (100 MB default).

## download vs stream

- `download` → always original bytes, no transcoding, no usage counting. Use for offline caching.
- `stream` → transcoding-aware, counts against per-client stream stats, honours `maxBitRate`/`format`.

Both need the same auth. Both are binary.

## Playlist export (.m3u8)

Construct on the client:

```ts
function toM3U(playlist: { name: string; entry: Array<{ id: string; title: string; duration: number }> }, client: SubsonicClient) {
    const lines = ["#EXTM3U", `#PLAYLIST:${playlist.name}`];
    for (const song of playlist.entry) {
        lines.push(`#EXTINF:${song.duration},${song.title}`);
        lines.push(client.streamUrl(song.id)); // contains auth — be careful where you share this
    }
    return lines.join("\n");
}
```

For **sharing outside your app** (emailed playlists, public URLs), use `createShare` instead — the URL it returns is auth-less, revocable, and tracked server-side.

## Bandwidth & bitrate tips

- **Speaker listening** → `format=mp3`, `maxBitRate=192` (CBR). Simple and universally decoded.
- **Headphones / audiophile** → `format=raw`, `maxBitRate=0` (pass-through FLAC / original). Relies on strong network.
- **Mobile data** → `format=opus`, `maxBitRate=96`. Opus is the size/quality sweet spot; every browser can decode it.
- **Podcasts** → `format=raw` or `opus` + `maxBitRate=64`. Voice transcodes efficiently.

## Playback events & telemetry

Streaming bytes **does not** count as a play. See [annotations-and-playback.md](annotations-and-playback.md) for the scrobble flow — it's a separate, explicit API call.

## When to proxy streaming

Direct client → Navidrome streaming is simplest. Proxy when:
- You want to hide Navidrome credentials from end-users.
- You need edge-level caching (CDN) — paste through a Cloudflare Worker and let the high `Cache-Control` work for you.
- You need rate-limiting per user (multiple apps sharing one Navidrome account).

The [`hono-proxy.ts`](../templates/hono-proxy.ts) template handles the binary streaming path (via `res.body` streaming, not `arrayBuffer`) so you don't buffer full tracks in memory.
