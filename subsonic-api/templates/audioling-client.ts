/**
 * audioling-client.ts — typed client using @audioling/open-subsonic-api-client.
 *
 * Best default for Node / Bun / Deno backends and Electron renderers with `nodeIntegration`.
 * Pulls `axios`, `@ts-rest/core`, `qs`, `zod` — tests in Cloudflare Workers can fail
 * because of axios internals; for edge runtimes use `minimal-client.ts` instead.
 *
 *   npm i @audioling/open-subsonic-api-client axios zod
 */

import { initOpenSubsonicApiClient } from "@audioling/open-subsonic-api-client";

export type ServerCapabilities = {
    openSubsonic: boolean;
    serverName: string;
    serverVersion: string;
    apiVersion: string;
    extensions: Array<{ name: string; versions: number[] }>;
    has: (extensionName: string) => boolean;
};

export async function createNavidromeClient(opts: {
    baseUrl: string;
    username: string;
    password: string;
    clientName: string;
}) {
    const api = initOpenSubsonicApiClient({
        baseUrl: opts.baseUrl.replace(/\/+$/, ""),
        clientName: opts.clientName,
        username: opts.username,
        password: opts.password,
    });

    const ping = await api.ping.get();
    if (ping.body.status !== "ok") {
        throw new Error(`Auth failed: ${JSON.stringify(ping.body.error)}`);
    }

    const extensions = ping.body.openSubsonic === true
        ? (await api.getOpenSubsonicExtensions.get()).body.openSubsonicExtensions ?? []
        : [];

    const capabilities: ServerCapabilities = {
        openSubsonic: ping.body.openSubsonic === true,
        serverName: ping.body.serverName ?? "unknown",
        serverVersion: ping.body.serverVersion ?? "unknown",
        apiVersion: ping.body.version,
        extensions,
        has: (name) => extensions.some((e) => e.name === name),
    };

    return { api, capabilities };
}

/** Example: load a Spotify-style home feed. */
export async function loadHomeFeed(api: ReturnType<typeof initOpenSubsonicApiClient>) {
    const [recent, frequent, random, starred] = await Promise.all([
        api.getAlbumList2.get({ query: { type: "recent", size: 20 } }),
        api.getAlbumList2.get({ query: { type: "frequent", size: 20 } }),
        api.getAlbumList2.get({ query: { type: "random", size: 20 } }),
        api.getStarred2.get(),
    ]);
    return {
        recent: recent.body.albumList2?.album ?? [],
        frequent: frequent.body.albumList2?.album ?? [],
        random: random.body.albumList2?.album ?? [],
        starredAlbums: starred.body.starred2?.album ?? [],
        starredSongs: starred.body.starred2?.song ?? [],
    };
}
