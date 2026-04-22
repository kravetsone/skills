/**
 * hono-proxy.ts — reverse proxy that hides server credentials and fixes CORS.
 *
 * Deploy on Bun / Node / Cloudflare Workers / Deno Deploy as a lightweight
 * auth-injecting proxy. Browsers hit your domain; you hit Navidrome with the
 * shared server credentials (or per-user sessions backed by a DB, adapt below).
 *
 *   bun add hono
 *   bun run templates/hono-proxy.ts
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { createHash, randomBytes } from "node:crypto";

type Env = {
    NAVIDROME_URL: string;
    NAVIDROME_USER: string;
    NAVIDROME_PASS: string;
    CLIENT_NAME: string;
    ALLOWED_ORIGIN: string;
};

const env: Env = {
    NAVIDROME_URL: process.env.NAVIDROME_URL!,
    NAVIDROME_USER: process.env.NAVIDROME_USER!,
    NAVIDROME_PASS: process.env.NAVIDROME_PASS!,
    CLIENT_NAME: process.env.CLIENT_NAME ?? "hono-proxy",
    ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN ?? "*",
};

function authQuery(): URLSearchParams {
    const salt = randomBytes(8).toString("hex");
    const token = createHash("md5").update(env.NAVIDROME_PASS + salt).digest("hex");
    return new URLSearchParams({
        u: env.NAVIDROME_USER,
        t: token,
        s: salt,
        v: "1.16.1",
        c: env.CLIENT_NAME,
        f: "json",
    });
}

const app = new Hono();

app.use("*", cors({ origin: env.ALLOWED_ORIGIN }));

// Proxy /rest/* with injected auth. Body = streamed through for binary endpoints.
app.all("/rest/:method", async (c) => {
    const method = c.req.param("method");
    const upstream = new URL(`${env.NAVIDROME_URL.replace(/\/+$/, "")}/rest/${method}`);
    const auth = authQuery();

    // Merge client-provided query with injected auth (client must NOT send u/t/s/p).
    const clientParams = new URL(c.req.url).searchParams;
    for (const [k, v] of clientParams) {
        if (["u", "t", "s", "p", "apiKey"].includes(k)) continue;
        upstream.searchParams.set(k, v);
    }
    for (const [k, v] of auth) upstream.searchParams.set(k, v);

    const res = await fetch(upstream, {
        method: c.req.method,
        headers: { Accept: c.req.header("Accept") ?? "*/*" },
        body: c.req.method === "POST" ? await c.req.blob() : undefined,
    });
    // Stream the body back — works for binary stream/download/getCoverArt.
    return new Response(res.body, {
        status: res.status,
        headers: {
            "Content-Type": res.headers.get("Content-Type") ?? "application/octet-stream",
            "Cache-Control": res.headers.get("Cache-Control") ?? "no-store",
        },
    });
});

export default app;

// Bun entrypoint:
if (import.meta.main) {
    const port = Number(process.env.PORT ?? 3000);
    Bun.serve({ port, fetch: app.fetch });
    console.log(`navidrome proxy listening on http://localhost:${port}`);
}
