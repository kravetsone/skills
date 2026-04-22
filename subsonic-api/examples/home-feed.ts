/**
 * home-feed.ts — end-to-end smoke test against a real Navidrome server.
 *
 * Run:
 *   NAVIDROME_URL=https://nav.example.com \
 *   NAVIDROME_USER=alice \
 *   NAVIDROME_PASS=hunter2 \
 *     bun run examples/home-feed.ts
 *
 * Prints: server identity, extensions, 5 recent albums with their first song
 * stream URL (ready to paste into mpv / VLC / <audio>).
 */

import { SubsonicClient } from "../templates/minimal-client.ts";

const baseUrl = process.env.NAVIDROME_URL;
const username = process.env.NAVIDROME_USER;
const password = process.env.NAVIDROME_PASS;

if (!baseUrl || !username || !password) {
    console.error(
        "Set NAVIDROME_URL, NAVIDROME_USER, NAVIDROME_PASS env vars first.",
    );
    process.exit(1);
}

const client = new SubsonicClient({
    baseUrl,
    username,
    password,
    clientName: "subsonic-api-skill-example/1",
});

// 1. Identify + capability probe
const ping = await client.ping();
console.log(
    `\n# ${(ping as any).serverName ?? "server"} ${(ping as any).serverVersion ?? ""}`,
);
console.log(`OpenSubsonic: ${(ping as any).openSubsonic === true ? "yes" : "no"}`);

const exts = await client.extensions();
if (exts.length > 0) {
    console.log(`Extensions: ${exts.map((e) => e.name).join(", ")}`);
}

// 2. Load recent albums
const { albumList2 } = await client.get<{
    albumList2?: { album?: Array<{ id: string; name: string; artist: string; coverArt?: string }> };
}>("getAlbumList2", { type: "recent", size: 5 });

const albums = albumList2?.album ?? [];
console.log(`\n## Recent albums (${albums.length})`);
for (const album of albums) {
    console.log(`- ${album.artist} — ${album.name}`);

    // 3. First song of each album
    const { album: full } = await client.get<{
        album?: { song?: Array<{ id: string; title: string; duration: number }> };
    }>("getAlbum", { id: album.id });

    const first = full?.song?.[0];
    if (first) {
        const streamUrl = client.streamUrl(first.id, { format: "mp3", maxBitRate: 192 });
        console.log(
            `  ▶️  ${first.title} (${first.duration}s)\n     ${maskAuth(streamUrl)}`,
        );
    }
}

// 4. Starred items
const { starred2 } = await client.get<{
    starred2?: { song?: Array<{ id: string; title: string; artist: string }> };
}>("getStarred2");

const starredSongs = starred2?.song ?? [];
console.log(`\n## Starred songs (${starredSongs.length})`);
for (const song of starredSongs.slice(0, 10)) {
    console.log(`- ⭐ ${song.artist} — ${song.title}`);
}

function maskAuth(url: string): string {
    const u = new URL(url);
    for (const k of ["t", "s", "p", "apiKey"]) {
        if (u.searchParams.has(k)) u.searchParams.set(k, "***");
    }
    return u.toString();
}
