# Integration patterns

Deployment topologies and framework recipes. Pair with [client-libraries.md](client-libraries.md) for which library to pick per runtime.

## Runtime matrix

| Runtime | Recommended client | Auth concern | Notes |
|---------|-------------------|--------------|-------|
| Node ≥20 | `@audioling/open-subsonic-api-client` | `node:crypto.createHash("md5")` | ESM-only — set `"type": "module"`. |
| Bun | `@audioling/...` or minimal | `node:crypto` polyfilled | `Bun.serve` + `Hono` is the simplest proxy pairing. |
| Deno | `subsonic-api` or minimal | `node:crypto` via `deno.json` `"nodeModulesDir"` | Import from `npm:` specifiers. |
| Cloudflare Workers / Deno Deploy | **minimal-client.ts** | MD5 **not** in SubtleCrypto — the inline JS MD5 is required | axios-based libs may choke; test before deploy. |
| Electron (main) | `@audioling/...` | Node crypto | Don't ship creds in the renderer — proxy via IPC. |
| Electron (renderer) | Via IPC to main | — | Treat renderer as "browser". |
| Browser SPA (React/Vue/Svelte) | `subsonic-api` or minimal | `js-md5` / `spark-md5` | CORS is open on Navidrome `/rest`; still prefer a proxy in prod. |
| React Native | `subsonic-api` | `react-native-quick-md5` | Avoid node-crypto shims — too heavy. |
| Tauri (frontend) | Same as browser | — | Tauri's Rust backend can proxy if you want to hide creds. |

## Backend pattern: Hono reverse proxy

Run in front of Navidrome to inject auth server-side. Your browser client only needs to know your proxy URL.

```ts
// proxy.ts (Bun / Node)
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createHash, randomBytes } from "node:crypto";

const app = new Hono();
app.use("*", cors({ origin: "https://app.example.com" }));

function auth() {
    const salt = randomBytes(8).toString("hex");
    const t = createHash("md5").update(process.env.NAV_PASS! + salt).digest("hex");
    return new URLSearchParams({
        u: process.env.NAV_USER!, t, s: salt,
        v: "1.16.1", c: "hono-proxy", f: "json",
    });
}

app.all("/rest/:method", async (c) => {
    const u = new URL(`${process.env.NAV_URL}/rest/${c.req.param("method")}`);
    const clientParams = new URL(c.req.url).searchParams;
    for (const [k, v] of clientParams) {
        if (!["u", "t", "s", "p", "apiKey"].includes(k)) u.searchParams.set(k, v);
    }
    for (const [k, v] of auth()) u.searchParams.set(k, v);
    const upstream = await fetch(u, { method: c.req.method, body: c.req.raw.body });
    return new Response(upstream.body, {
        status: upstream.status,
        headers: upstream.headers,
    });
});

export default { port: 3000, fetch: app.fetch };
```

Full template: [`templates/hono-proxy.ts`](../templates/hono-proxy.ts). The same shape works as an Elysia plugin, Express middleware, Fastify plugin, or Cloudflare Worker — the core is "strip user auth params, inject server auth, stream body through".

## Backend pattern: Elysia plugin

```ts
import { Elysia } from "elysia";
import { createHash, randomBytes } from "node:crypto";

export const subsonicProxy = (opts: {
    baseUrl: string; user: string; pass: string; clientName: string;
}) => new Elysia({ name: "subsonic-proxy" })
    .get("/rest/:method", async ({ params, query, set }) => {
        const salt = randomBytes(8).toString("hex");
        const t = createHash("md5").update(opts.pass + salt).digest("hex");
        const u = new URL(`${opts.baseUrl}/rest/${params.method}`);
        for (const [k, v] of Object.entries(query)) {
            if (!["u", "t", "s", "p", "apiKey"].includes(k)) u.searchParams.set(k, String(v));
        }
        u.searchParams.set("u", opts.user);
        u.searchParams.set("t", t);
        u.searchParams.set("s", salt);
        u.searchParams.set("v", "1.16.1");
        u.searchParams.set("c", opts.clientName);
        u.searchParams.set("f", "json");
        const res = await fetch(u);
        set.headers["Content-Type"] = res.headers.get("Content-Type") ?? "application/octet-stream";
        return res.body;
    });
```

## Backend pattern: Cloudflare Worker

```ts
export default {
    async fetch(req: Request, env: { NAV_URL: string; NAV_USER: string; NAV_PASS: string }) {
        const method = new URL(req.url).pathname.replace(/^\/rest\//, "").replace(/\.view$/, "");
        // MD5 in a Worker — use js-md5 (no Web Crypto support).
        const { default: md5 } = await import("js-md5");
        const salt = crypto.getRandomValues(new Uint8Array(8))
            .reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
        const t = md5(env.NAV_PASS + salt);

        const upstream = new URL(`${env.NAV_URL}/rest/${method}.view`);
        for (const [k, v] of new URL(req.url).searchParams) {
            if (!["u", "t", "s", "p", "apiKey"].includes(k)) upstream.searchParams.set(k, v);
        }
        upstream.searchParams.set("u", env.NAV_USER);
        upstream.searchParams.set("t", t);
        upstream.searchParams.set("s", salt);
        upstream.searchParams.set("v", "1.16.1");
        upstream.searchParams.set("c", "cf-worker");
        upstream.searchParams.set("f", "json");
        return fetch(upstream);
    },
};
```

**Gotchas in Workers:** `node:crypto` is not available; `axios` may fail due to XHR internals; use pure-fetch clients. `new URL(req.url).hostname` is the Worker's hostname, not Navidrome's — always use the configured `NAV_URL`.

## Browser SPA pattern

```tsx
// React + TanStack Query
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { SubsonicClient } from "./subsonic-client"; // minimal-client.ts

const client = new SubsonicClient({
    baseUrl: "/proxy",            // points to your backend proxy, NOT Navidrome directly
    username: "session",          // proxy injects real creds
    password: "session",
    clientName: "my-spa",
});

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 5 * 60_000,            // music metadata is pretty stable
            refetchOnWindowFocus: false,
        },
    },
});

function AlbumGrid() {
    const { data } = useQuery({
        queryKey: ["albumList", "recent"],
        queryFn: () => client.get("getAlbumList2", { type: "recent", size: 50 }),
    });
    return (
        <div className="grid">
            {data?.albumList2?.album?.map((a) => (
                <a key={a.id} href={`/album/${a.id}`}>
                    <img src={client.coverArtUrl(a.coverArt, 300)} alt={a.name} />
                    <h3>{a.name}</h3>
                </a>
            ))}
        </div>
    );
}
```

### Service Worker for offline cover art

```ts
// sw.ts
const CACHE = "subsonic-covers-v1";
self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    if (url.pathname.includes("/rest/getCoverArt")) {
        event.respondWith(
            caches.open(CACHE).then(async (cache) => {
                const hit = await cache.match(event.request);
                if (hit) return hit;
                const res = await fetch(event.request);
                cache.put(event.request, res.clone());
                return res;
            }),
        );
    }
});
```

Navidrome sets `Cache-Control: max-age=10years` on cover art; the browser HTTP cache alone may be sufficient. Add a SW only if you need offline access.

## IndexedDB for offline playback

```ts
// Cache song bytes after download
const db = await openDB("subsonic-offline", 1, {
    upgrade(db) { db.createObjectStore("songs"); },
});

async function cacheSong(client: SubsonicClient, id: string) {
    const res = await fetch(client.url("download", { id }));
    const blob = await res.blob();
    await db.put("songs", blob, id);
}

async function playCached(id: string) {
    const blob = await db.get("songs", id) as Blob;
    if (!blob) throw new Error("Not cached");
    new Audio(URL.createObjectURL(blob)).play();
}
```

Pair with an "offline-available" column in your UI. Scrobble offline plays into a queue and drain on reconnect (see [annotations-and-playback.md](annotations-and-playback.md)).

## CORS handling cheat sheet

| Situation | Fix |
|-----------|-----|
| `Access-Control-Allow-Origin` missing from `/rest/*` | Navidrome normally returns `*`. Check reverse proxy (Nginx / Caddy / Traefik) — it may strip the header. |
| Custom header `X-Client-ID` blocked by preflight | Don't send custom headers — stick to standard ones. Subsonic has no client ID header; use the `c=` query param. |
| 401 from preflight OPTIONS | Preflights shouldn't require auth. Ensure reverse proxy isn't injecting auth middleware before CORS. |
| Browser caches preflight for too long | Add `Access-Control-Max-Age: 60` to your proxy responses. |

## Caching strategies

1. **HTTP cache** (free, built-in) — cover art `max-age=10years`; artist info / album info ~1 day (set on your proxy).
2. **TanStack Query / SWR** — in-memory per tab; `staleTime: 5m` is a reasonable default for library metadata.
3. **Service Worker** — persistent across tabs; scope to `/rest/getCoverArt` only.
4. **IndexedDB** — for offline playback + lyrics. Don't use for cover art (the SW cache does this better).

## Security hygiene

- **Never ship server creds in client JS.** Use a proxy. This is the single biggest recurring mistake in Subsonic clients.
- **Never log the full stream URL.** It contains `t=` / `s=` — a bearer. Mask with the helper in [errors-and-debugging.md](errors-and-debugging.md).
- **Use HTTPS.** Token+salt MD5 is replayable once the URL leaks.
- **Rotate `c=` per major client version.** Helps users track "this device" in Navidrome's "now playing" view and scrobble history.
- **Upgrade Navidrome ≥ 0.54.1** to mitigate [CVE-2025-27112](https://github.com/advisories/GHSA-c3p4-vm8f-386p).
