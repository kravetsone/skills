# Endpoints reference

Complete catalogue of Subsonic 1.16.1 + OpenSubsonic endpoints, organised by category, with Navidrome support status.

**Legend:**
- ✅ Fully supported on Navidrome
- ⚠️ Partial / behaviour differs — see notes
- ❌ Not supported (returns error, usually 70 "data not found" or 50 "not authorized")
- 🆕 OpenSubsonic-only (legacy Subsonic servers will 404)

**URL shape:** `<baseUrl>/rest/<method>.view?<params>` (the `.view` suffix is optional on Navidrome but standard on legacy Subsonic).

## System

| Endpoint | Navidrome | Notes |
|----------|-----------|-------|
| `ping` | ✅ | Cheapest call. Use to validate auth + discover `openSubsonic`/`type`/`serverVersion`. |
| `getLicense` | ✅ | Navidrome always reports a valid (non-expiring) license. |
| `getOpenSubsonicExtensions` 🆕 | ✅ | Callable **without auth** per spec. Returns `[{ name, versions: [n, ...] }]`. |

## Browsing

| Endpoint | Navidrome | Notes |
|----------|-----------|-------|
| `getMusicFolders` | ✅ | Returns only folders the authenticated user can access. Multi-library routing uses these IDs. |
| `getIndexes` | ⚠️ | Returns synthetic top-level (no real folder browsing). No `child`/`shortcut` support. Prefer `getArtists`. |
| `getMusicDirectory` | ⚠️ | Simulated folder tree. Prefer `getArtist`/`getAlbum`. |
| `getGenres` | ✅ | |
| `getArtists` | ✅ | ID3-tag-based; **preferred** over `getIndexes`. |
| `getArtist` | ✅ | Returns artist + its albums. |
| `getAlbum` | ✅ | Returns album + its songs, with OS-extended fields (replayGain, genres[], contributors, moods). |
| `getSong` | ✅ | Single-song metadata. |
| `getArtistInfo` | ⚠️ | Requires Last.fm agent enabled server-side; otherwise empty. |
| `getArtistInfo2` | ⚠️ | Same as above, ID3 variant. |
| `getAlbumInfo` | ⚠️ | Last.fm-backed. |
| `getAlbumInfo2` | ⚠️ | Last.fm-backed. |
| `getSimilarSongs` | ⚠️ | Last.fm-backed. |
| `getSimilarSongs2` | ⚠️ | |
| `getTopSongs` | ⚠️ | Last.fm-backed (requires `artist` param). |
| `getVideos` | ❌ | Error 70 — Navidrome is audio-only. |
| `getVideoInfo` | ❌ | Error 70. |
| `findSonicPath` 🆕 | — | Not in Navidrome yet. |

## Album / Song lists

| Endpoint | Navidrome | Notes |
|----------|-----------|-------|
| `getAlbumList` | ⚠️ | Folder-based; prefer `getAlbumList2`. |
| `getAlbumList2` | ✅ | Main home-feed endpoint. `type`: `random`, `newest`, `recent`, `frequent`, `highest`, `starred`, `alphabeticalByName`, `alphabeticalByArtist`, `byGenre` (+`genre`), `byYear` (+`fromYear`, `toYear`). `size` max 500, default 10. `musicFolderId` for multi-library. |
| `getRandomSongs` | ✅ | Filters: `size`, `genre`, `fromYear`, `toYear`, `musicFolderId`. |
| `getSongsByGenre` | ✅ | Pagination via `count`, `offset`. |
| `getNowPlaying` | ✅ | Tracks what each client is streaming. |
| `getStarred` | ⚠️ | Folder variant. |
| `getStarred2` | ✅ | **Preferred** ID3 variant. |

## Searching

| Endpoint | Navidrome | Notes |
|----------|-----------|-------|
| `search` | ❌ | Legacy, removed. |
| `search2` | ⚠️ | Folder-based, still works. |
| `search3` | ✅ | **Preferred**. No Lucene syntax — plain substring tokenisation. Split buckets via `artistCount`/`albumCount`/`songCount` + `*Offset`. |

## Playlists

| Endpoint | Navidrome | Notes |
|----------|-----------|-------|
| `getPlaylists` | ⚠️ | `username` param is **ignored** (returns caller's + public). |
| `getPlaylist` | ✅ | Returns songs + metadata. |
| `createPlaylist` | ✅ | Either `name=` (new) + repeated `songId=` OR `playlistId=` (update existing, replaces tracks). |
| `updatePlaylist` | ✅ | Batched: repeated `songIdToAdd=`, repeated `songIndexToRemove=`, optional `name`/`comment`/`public`. Prefer `formPost` ext for large batches. |
| `deletePlaylist` | ✅ | |

## Media retrieval

| Endpoint | Navidrome | Notes |
|----------|-----------|-------|
| `stream` | ✅ | Binary. Params: `id`, `maxBitRate` (kbps, 0 = no limit), `format` (`mp3`/`opus`/`raw` = passthrough), `timeOffset` (requires `transcodeOffset` ext for audio), `estimateContentLength` (bool). Never increments playcount. |
| `download` | ✅ | Original bytes, no transcoding, no accounting. Use for offline caching. |
| `hls` | ❌ | Not in Navidrome (it's streaming-only). |
| `getCaptions` | ❌ | Video. |
| `getCoverArt` | ✅ | `id` + `size=<px>` (square). `Cache-Control: public, max-age=315360000` — cache aggressively. |
| `getLyrics` | ⚠️ | Legacy: query by `artist`+`title`, not by song id. |
| `getLyricsBySongId` 🆕 | ✅ | Part of `songLyrics` extension. Returns synced LRC if present. |
| `getAvatar` | ⚠️ | Redirects to Gravatar or a placeholder. |
| `getTranscodeDecision` 🆕 | — | Preview which codec the server would pick. |
| `getTranscodeStream` 🆕 | — | |

## Media annotation

| Endpoint | Navidrome | Notes |
|----------|-----------|-------|
| `star` | ✅ | Pass any of `id`, `albumId`, `artistId` (repeatable). |
| `unstar` | ✅ | |
| `setRating` | ✅ | `id` + `rating` (0–5). |
| `scrobble` | ✅ | `id`, `submission` (`true`/`false`), `time` (epoch ms). See [annotations-and-playback.md](annotations-and-playback.md) for the heuristic. |
| `reportPlayback` 🆕 | — | Part of `playbackReport` extension. Richer: position, pause, seek, stop. |

## Sharing

| Endpoint | Navidrome | Notes |
|----------|-----------|-------|
| `getShares` | ⚠️ | Requires `EnableSharing = true` in config. |
| `createShare` | ⚠️ | Same. |
| `updateShare` | ⚠️ | Same. |
| `deleteShare` | ⚠️ | Same. |

## Podcast

| Endpoint | Navidrome | Notes |
|----------|-----------|-------|
| `getPodcasts` | ✅ | Requires `EnablePodcasts`. |
| `getNewestPodcasts` | ✅ | |
| `refreshPodcasts` | ✅ | |
| `createPodcastChannel` | ✅ | |
| `deletePodcastChannel` | ✅ | |
| `deletePodcastEpisode` | ✅ | |
| `downloadPodcastEpisode` | ✅ | |
| `getPodcastEpisode` 🆕 | ✅ | |

## Jukebox / Internet Radio / Chat / Bookmarks

| Endpoint | Navidrome | Notes |
|----------|-----------|-------|
| `jukeboxControl` | ❌ | Navidrome does not implement jukebox mode. |
| `getInternetRadioStations` | ✅ | |
| `createInternetRadioStation` | ✅ | |
| `updateInternetRadioStation` | ✅ | |
| `deleteInternetRadioStation` | ✅ | |
| `getChatMessages` | ❌ | Navidrome drops chat (multi-user IRC-like feature). |
| `addChatMessage` | ❌ | |
| `getBookmarks` | ✅ | |
| `createBookmark` | ✅ | |
| `deleteBookmark` | ✅ | |
| `getPlayQueue` | ⚠️ | `current` is a **string** ID (not integer). |
| `savePlayQueue` | ✅ | |
| `getPlayQueueByIndex` 🆕 | — | Needs `indexBasedQueue` ext. |
| `savePlayQueueByIndex` 🆕 | — | |

## User management

| Endpoint | Navidrome | Notes |
|----------|-----------|-------|
| `getUser` | ⚠️ | `username` param **ignored** unless caller is admin. Regular users always get their own record. |
| `getUsers` | ⚠️ | Same — non-admins get a one-element list. |
| `createUser` | ✅ | Admin-only. |
| `updateUser` | ✅ | Admin-only for other users. |
| `deleteUser` | ✅ | Admin-only. |
| `changePassword` | ✅ | Self or admin-for-others. |
| `tokenInfo` 🆕 | — | Returns info about the API key currently in use (extension-gated). |

## Library scanning

| Endpoint | Navidrome | Notes |
|----------|-----------|-------|
| `getScanStatus` | ✅ | Extra fields: `lastScan` (ISO8601), `folderCount`. |
| `startScan` | ✅ | Extra param: `fullScan=true` (force full rescan). |

## Parameter conventions

- Numbers are decimal, no units (except `maxBitRate` — kbps, and `time` — epoch ms).
- Booleans are literal `true` / `false` strings in the URL.
- Repeated params (e.g. `songId` on `createPlaylist`) are multiple `?songId=a&songId=b` pairs, not comma-joined.
- `musicFolderId` is optional and, when present, scopes the query to that library. Multi-value is not supported — use multiple calls.

## Response envelope (every endpoint)

```jsonc
{
  "subsonic-response": {
    "status": "ok" | "failed",
    "version": "1.16.1",
    // --- OpenSubsonic additions (only when server supports it) ---
    "type": "navidrome",
    "serverVersion": "0.55.2",
    "serverName": "Navidrome",
    "openSubsonic": true,
    // --- per-endpoint payload ---
    "albumList2": { /* ... */ },
    // --- on failure ---
    "error": { "code": 40, "message": "Wrong username or password", "helpUrl": "https://..." }
  }
}
```

Error codes are catalogued in [errors-and-debugging.md](errors-and-debugging.md).
