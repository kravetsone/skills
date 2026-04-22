# Browsing & search

## The ID3 vs folder split

Every browse endpoint exists in two flavours:

- **Folder-based** (`getIndexes`, `getMusicDirectory`, `getAlbumList`, `getStarred`, `search2`) — reflect the on-disk structure.
- **ID3-tag-based** (`getArtists`, `getArtist`, `getAlbum`, `getAlbumList2`, `getStarred2`, `search3`) — reflect the tag database.

**On Navidrome, always use the ID3 variants.** Folder endpoints are kept for compatibility with ancient clients but return synthetic trees that don't match disk. Tag-based calls return stable IDs and the full OpenSubsonic extension fields.

## Home feed pattern

Spotify-style home surface with one network round trip:

```ts
const [recent, frequent, random, newest, starred] = await Promise.all([
    client.get("getAlbumList2", { type: "recent", size: 20 }),
    client.get("getAlbumList2", { type: "frequent", size: 20 }),
    client.get("getAlbumList2", { type: "random", size: 20 }),
    client.get("getAlbumList2", { type: "newest", size: 20 }),
    client.get("getStarred2"),
]);
```

`getAlbumList2.type` values:

| `type` | What you get |
|--------|--------------|
| `random` | Random subset. Good for "Discover" rails. |
| `newest` | By date added to library. |
| `recent` | By last played. |
| `frequent` | By play count. |
| `highest` | By user rating. |
| `starred` | Only starred albums (like `getStarred2.album` but paginated). |
| `alphabeticalByName` | |
| `alphabeticalByArtist` | |
| `byYear` | Requires `fromYear` + `toYear` (ascending if fromYear<toYear, descending otherwise). |
| `byGenre` | Requires `genre=` param. |

Params: `size` (max 500, default 10), `offset` (for pagination), `musicFolderId` (multi-library).

## Artist → album → song drill-down

```ts
const { artists } = await client.get("getArtists"); // { index: [{ name, artist: [...] }] }

// Select one
const artistId = artists.index[0].artist[0].id;
const { artist } = await client.get("getArtist", { id: artistId });
// artist.album: [{ id, name, songCount, duration, year, genre, coverArt, ... }]

const albumId = artist.album[0].id;
const { album } = await client.get("getAlbum", { id: albumId });
// album.song: [{ id, title, artist, duration, bitRate, path, ... }]
```

On OpenSubsonic servers (`openSubsonic === true`), songs carry extended fields:

```ts
song.musicBrainzId         // MBID track
song.genres                // [{ name }]
song.artists               // [{ id, name }] — split multi-artist
song.displayArtist         // "A & B feat. C" — pre-formatted
song.albumArtists          // [{ id, name }]
song.contributors          // [{ role: "composer" | "producer" | ..., artist }]
song.moods                 // ["Happy", "Uplifting"]
song.replayGain            // { trackGain, albumGain, trackPeak, albumPeak }
song.channelCount          // 2
song.samplingRate          // 44100
song.bitDepth              // 16
song.sortName              // canonical sort string
song.mediaType             // "song" | "podcastEpisode" | ...
song.bpm                   // integer or null
song.explicitStatus        // "explicit" | "clean" | null
```

Gate access to these behind a capability check (see [opensubsonic-extensions.md](opensubsonic-extensions.md)).

## Genre filters

```ts
const genres = (await client.get("getGenres")).genres?.genre ?? [];
// [{ value: "Rock", songCount, albumCount }, ...]

const rock = await client.get("getSongsByGenre", {
    genre: "Rock",
    count: 50,
    offset: 0,
    musicFolderId: "1", // optional — restrict to one library
});
```

## search3

Best practice: pass the user's literal input, paginate per bucket.

```ts
const { searchResult3 } = await client.get("search3", {
    query: userInput,            // "beatles abbey"
    artistCount: 10, artistOffset: 0,
    albumCount: 20, albumOffset: 0,
    songCount: 50, songOffset: 0,
});

const artists = searchResult3.artist ?? [];
const albums = searchResult3.album ?? [];
const songs = searchResult3.song ?? [];
```

**Navidrome tokenisation rules:**
- Input is lowercased, split on whitespace.
- Each token must appear (substring) in at least one of {artist, album, title}.
- No `AND`/`OR`/`NOT` — all tokens are implicit AND.
- No field scoping (`artist:foo`) — that's Lucene, not Navidrome.
- No fuzzy matching, no stemming.

Quick debug: if users complain about "missing" tracks, try the exact query in the Navidrome WebUI — it uses the same engine.

## Starred items

```ts
const { starred2 } = await client.get("getStarred2");
// starred2: { artist: [...], album: [...], song: [...] }
```

These are the user's personal stars. Star/unstar via the annotation endpoints (see [annotations-and-playback.md](annotations-and-playback.md)).

## "Now playing"

```ts
const { nowPlaying } = await client.get("getNowPlaying");
// nowPlaying.entry: [{ username, playerId, playerName, minutesAgo, id, title, ... }]
```

Useful for "your other devices" / "what friends are listening to" UIs. Updated by the server when clients call `scrobble?submission=false` (i.e. "now playing" pings).

## Pagination pitfalls

- Legacy Subsonic `getAlbumList` maxes at 500 per call — pagination via `offset` is mandatory for large libraries.
- `search3` has independent paginators per bucket — don't assume they share `offset`.
- `getRandomSongs` has **no pagination at all** — each call returns a fresh random set. Don't deduplicate via offset; keep a client-side Set of seen IDs.
- `getSongsByGenre` uses `count`+`offset` (not `size`+`offset`). Easy typo.

## Fetching by batch

Want full metadata for a list of IDs (e.g. a scrobble queue)? The Subsonic API has no batch-get endpoint. Two options:

1. N individual `getSong` calls with `Promise.all`. Simple, but each costs a DB query server-side — cap at ~20 parallel.
2. The Navidrome native `/api/song?_start=0&_end=100&filter={"id":["a","b","c"]}` supports array filters. Faster but uses the unstable API. See [navidrome-native-api.md](navidrome-native-api.md).
