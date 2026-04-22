# Smart playlist rule grammar (Navidrome)

Smart playlists are dynamic — Navidrome evaluates a JSON rule tree on every request and returns matching tracks. Two ways to create them:

1. **Filesystem** — drop a `.nsp` (Navidrome Smart Playlist) file into your `PlaylistsPath`; the scanner imports it.
2. **Native API** — `POST /api/playlist` with `rules` field. Unstable API, see [navidrome-native-api.md](navidrome-native-api.md).

The rule grammar is the same in both. This file documents it exhaustively — straight from Navidrome's `model/criteria` Go package (authoritative source: [fields.go](https://github.com/navidrome/navidrome/blob/master/model/criteria/fields.go), [operators.go](https://github.com/navidrome/navidrome/blob/master/model/criteria/operators.go)).

## Top-level shape

```jsonc
{
    // .nsp-file-only metadata (ignored by native API POST):
    "name": "80s Top Songs",
    "comment": "All my loved, highly-rated tracks from the 80s",
    "public": false,

    // Rule tree (required):
    "all": [ /* ... expressions ... */ ],

    // Sorting & limiting:
    "sort": "year, -rating",
    "order": "desc",
    "limit": 100,
    "limitPercent": 10,
    "offset": 0
}
```

- `all` / `any` — the **root** combinator (exactly one).
- `sort` — one or more field names, comma-separated. Prefix with `+` (ascending, default) or `-` (descending). `sort: "random"` = random order.
- `order` — global `"asc"` or `"desc"`. When set to `"desc"`, inverts every per-field direction.
- `limit` — fixed track count. Takes precedence over `limitPercent`.
- `limitPercent` — 1..100, percentage of total matching tracks (added 2026). E.g. "Top 10% by playcount" scales with library.
- `offset` — skip N results.

## Combinators

Two keywords, nestable to arbitrary depth:

| Keyword | Logic | Example |
|---------|-------|---------|
| `all` | AND — every child must match | `{"all": [A, B, C]}` |
| `any` | OR — at least one child must match | `{"any": [A, B, C]}` |

Negation is achieved via the "not" form of each operator (`isNot`, `notContains`, `notInTheLast`, `notInPlaylist`) — **there is no `none` / `not` combinator**.

### Nesting

```jsonc
{
    "all": [
        { "is": { "genre": "Rock" } },
        { "any": [
            { "inTheRange": { "year": [1970, 1979] } },
            { "inTheRange": { "year": [2000, 2009] } }
        ]}
    ]
}
```

## Operators — full list

Every operator wraps a single `{ fieldName: value }` object. `mapFields()` is case-insensitive.

### Equality

| Op | JSON shape | Applies to |
|----|-----------|-----------|
| `is` | `{"is": {"fieldName": value}}` | Any scalar — strings, numbers, bools, dates |
| `isNot` | `{"isNot": {"fieldName": value}}` | Same |

Booleans use JSON `true`/`false`:

```jsonc
{ "is": { "loved": true } }
{ "is": { "compilation": false } }
```

### Numeric / date comparison

| Op | Meaning |
|----|---------|
| `gt` | `>` |
| `lt` | `<` |
| `before` | Alias for `lt` on date fields (readable) |
| `after` | Alias for `gt` on date fields (readable) |

```jsonc
{ "gt": { "rating": 3 } }             // rating > 3
{ "lt": { "bitrate": 192 } }           // bit rate < 192 kbps
{ "after": { "dateadded": "2025-01-01" } }
{ "before": { "lastplayed": "2024-12-01" } }
```

> **No `gte` / `lte`.** Use `inTheRange` for inclusive bounds.

### Range

| Op | JSON shape |
|----|-----------|
| `inTheRange` | `{"inTheRange": {"field": [min, max]}}` — **inclusive** on both ends |

```jsonc
{ "inTheRange": { "year": [1981, 1990] } }
{ "inTheRange": { "duration": [180, 360] } }  // 3 to 6 minutes (seconds)
```

### Rolling-window date

For date fields — "N days back from today".

| Op | Meaning |
|----|---------|
| `inTheLast` | Date within last N days |
| `notInTheLast` | Either outside last N days, or NULL (never rated/played/etc.) |

```jsonc
{ "inTheLast": { "lastplayed": 30 } }        // played in the last 30 days
{ "notInTheLast": { "lastplayed": 90 } }     // not played in 90 days (or never)
```

### String matching

All string operators are **case-insensitive `LIKE`** with `%` wildcards added automatically. Source field is unchanged.

| Op | SQL shape |
|----|-----------|
| `contains` | `LIKE '%value%'` |
| `notContains` | `NOT LIKE '%value%'` |
| `startsWith` | `LIKE 'value%'` |
| `endsWith` | `LIKE '%value'` |

```jsonc
{ "contains": { "title": "remix" } }
{ "startsWith": { "artist": "The " } }
{ "endsWith": { "filepath": ".flac" } }
{ "notContains": { "comment": "demo" } }
```

### Playlist membership

| Op | JSON shape |
|----|-----------|
| `inPlaylist` | `{"inPlaylist": {"id": "<playlistId>"}}` |
| `notInPlaylist` | `{"notInPlaylist": {"id": "<playlistId>"}}` |

**Only `public: true` playlists are visible to the evaluator.** Personal/private playlists cannot be referenced from a smart playlist.

```jsonc
{ "all": [
    { "is": { "genre": "Jazz" } },
    { "notInPlaylist": { "id": "already-heard-pl-id" } }
]}
```

## Fields — full list

From [fields.go](https://github.com/navidrome/navidrome/blob/master/model/criteria/fields.go). Case-insensitive in JSON.

### Strings (for `is` / `isNot` / `contains` / `startsWith` / `endsWith`)

```
title           album           comment           lyrics
sorttitle       sortalbum       sortartist        sortalbumartist
albumcomment    catalognumber
filepath        filetype        codec
discsubtitle
explicitstatus
```

Plus MusicBrainz IDs (effectively opaque strings):

```
mbz_album_id         mbz_album_artist_id    mbz_artist_id
mbz_recording_id     mbz_release_track_id   mbz_release_group_id
```

Plus tag-sourced (treated as strings, reached through the file's custom tags JSON):

```
genre       mood         grouping        language
producer    engineer     mixer           dj
conductor   remixer      arranger        lyricist
composer    performer    albumartist     artist
releasetype albumtype     (albumtype is an alias for releasetype)
```

### Numbers (for `gt` / `lt` / `inTheRange`)

```
tracknumber     discnumber      year
originalyear    releaseyear
size            duration        bitrate      bitdepth
samplerate      bpm             channels
playcount       rating          averagerating
albumrating     albumplaycount  albumdaterating
artistrating    artistplaycount
library_id
```

### Dates (for `gt`/`lt`/`before`/`after`/`inTheRange`/`inTheLast`/`notInTheLast`)

Format dates as ISO `"YYYY-MM-DD"` strings (or full ISO8601 for timestamps).

```
date            originaldate    releasedate
dateadded       datemodified
dateloved       lastplayed       daterated
albumlastplayed albumdateloved   albumdaterated
artistlastplayed artistdateloved artistdaterated
```

### Booleans (for `is` / `isNot`)

```
hascoverart     compilation     missing
loved           albumloved      artistloved
```

### Special

- `random` — only valid as a **sort** field (`"sort": "random"`); cannot appear in a rule.
- `value` — pseudo-field used internally for tag/role queries; don't reference directly.

### Album-/artist-prefixed fields

Fields beginning with `album*` or `artist*` (`albumrating`, `albumplaycount`, `albumlastplayed`, `albumdateloved`, `albumdaterated`, `albumloved`, plus the `artist*` equivalents) filter the **parent** album/artist annotations rather than the track itself.

```jsonc
// "Tracks from albums I've rated ≥4 stars"
{ "gt": { "albumrating": 3 } }

// "Tracks from artists I've played at least 50 times"
{ "gt": { "artistplaycount": 50 } }
```

## Sort directives

```jsonc
"sort": "year, -rating, artist"
"order": "asc"
```

- Comma-separated list of fields.
- Per-field direction: `+` prefix = asc (default), `-` prefix = desc.
- Global `order: "desc"` **inverts** all per-field directions.
- Unknown fields are logged and ignored.
- `sort: "random"` ignores `order`.

Default sort when unspecified: `title asc`.

## Complete examples

### 1. "Recently Played" — simple

```json
{
    "name": "Recently played",
    "comment": "Tracks played in the last 30 days, most recent first",
    "all": [ { "inTheLast": { "lastplayed": 30 } } ],
    "sort": "lastplayed",
    "order": "desc",
    "limit": 100
}
```

### 2. "80s Loved Highlights"

```json
{
    "name": "80s Top",
    "all": [
        { "inTheRange": { "year": [1980, 1989] } },
        { "is": { "loved": true } },
        { "gt": { "rating": 3 } }
    ],
    "sort": "rating, playcount",
    "order": "desc",
    "limit": 50
}
```

### 3. "Rediscover" — not played for 6 months but you liked it once

```json
{
    "all": [
        { "gt": { "playcount": 5 } },
        { "gt": { "rating": 3 } },
        { "notInTheLast": { "lastplayed": 180 } }
    ],
    "sort": "random",
    "limit": 30
}
```

### 4. "Studio rock, 70s or 90s" — nested combinator

```json
{
    "all": [
        { "is": { "genre": "Rock" } },
        { "is": { "compilation": false } },
        { "any": [
            { "inTheRange": { "year": [1970, 1979] } },
            { "inTheRange": { "year": [1990, 1999] } }
        ]},
        { "notContains": { "title": "live" } }
    ],
    "sort": "year",
    "order": "asc"
}
```

### 5. "Top 10% by playcount, excluding heard-this-week"

```json
{
    "all": [
        { "gt": { "playcount": 0 } },
        { "notInTheLast": { "lastplayed": 7 } }
    ],
    "sort": "playcount",
    "order": "desc",
    "limitPercent": 10
}
```

### 6. "High-quality flac in an existing public playlist"

```json
{
    "all": [
        { "is": { "filetype": "flac" } },
        { "gt": { "bitrate": 800 } },
        { "inPlaylist": { "id": "<other-playlist-id>" } }
    ]
}
```

## Using via native API

```ts
await nativeClient.create("playlist", {
    name: "80s Top",
    public: false,
    rules: {
        all: [
            { inTheRange: { year: [1980, 1989] } },
            { is: { loved: true } },
            { gt: { rating: 3 } },
        ],
        sort: "rating, playcount",
        order: "desc",
        limit: 50,
    },
});
```

## Using via `.nsp` file

Save as `<PlaylistsPath>/80s-top.nsp`:

```jsonc
{
    "name": "80s Top",
    "comment": "Smart",
    "public": true,
    "all": [
        { "inTheRange": { "year": [1980, 1989] } },
        { "is": { "loved": true } }
    ],
    "sort": "rating",
    "order": "desc",
    "limit": 50
}
```

Navidrome rescans `PlaylistsPath` on its schedule (`ND_SCANSCHEDULE`, default 1h) or via explicit `startScan`.

## Pitfalls

- **`none` doesn't exist.** Use the `isNot` / `notContains` / `notInTheLast` / `notInPlaylist` variants or place the negation inside a single-child `all` with `isNot`.
- **Strings are case-insensitive.** `"Rock"` and `"rock"` match identically.
- **`contains` on `lyrics` is expensive.** It full-scans the lyrics column. Combine with selective filters (year/genre) first — `all` short-circuits left to right.
- **`inTheLast` and `notInTheLast` value is in days only.** No `"1h"` / `"2w"` sugar.
- **Date comparisons coerce strings.** Always pass ISO `"YYYY-MM-DD"` (or full ISO8601). `"Jan 2025"` silently yields `NULL`.
- **`inPlaylist` ignores private playlists.** If your rule depends on an existing playlist, make it public.
- **Role / multi-value tag fields** (`artist`, `composer`, `producer`, `mood`, `genre`) are stored in the file's tags JSON — matching is "any occurrence". `{"is": {"artist": "Bowie"}}` matches tracks where **any** credited artist tag is "Bowie".
- **`albumrating` / `artistrating`** measure the **user's** rating on parent entities, not aggregates of track ratings.
- **`library_id`** exposes the multi-library facet — use it to scope smart playlists to a single library (`{"is": {"library_id": 2}}`).

## Source references

- Fields: https://github.com/navidrome/navidrome/blob/master/model/criteria/fields.go
- Operators: https://github.com/navidrome/navidrome/blob/master/model/criteria/operators.go
- Top-level Criteria struct: https://github.com/navidrome/navidrome/blob/master/model/criteria/criteria.go
- Navidrome docs: https://www.navidrome.org/docs/usage/smartplaylists/
- Community collection of example `.nsp` files: https://github.com/TobiasDax/Navidrome-Smart-Playlist-Collection
