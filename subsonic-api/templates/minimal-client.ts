/**
 * minimal-client.ts — zero-dependency Subsonic / OpenSubsonic client.
 *
 * Works on Node ≥20, Bun, Deno, Cloudflare Workers, and modern browsers.
 * Uses Web Crypto where available; falls back to node:crypto.
 * MD5 is not in SubtleCrypto — inline tiny implementation (public-domain, ~40 lines).
 *
 * Usage:
 *   const c = new SubsonicClient({ baseUrl, username, password, clientName: "my-app" });
 *   await c.ping();
 *   const { albumList2 } = await c.get("getAlbumList2", { type: "recent", size: 20 });
 *   const audioUrl = c.streamUrl("song-id-here", { maxBitRate: 192, format: "mp3" });
 */

export type SubsonicEnvelope<T = Record<string, unknown>> = {
    "subsonic-response": {
        status: "ok" | "failed";
        version: string;
        type?: string;
        serverName?: string;
        serverVersion?: string;
        openSubsonic?: boolean;
        error?: { code: number; message: string; helpUrl?: string };
    } & Partial<T>;
};

type AuthOptions =
    | { username: string; password: string; apiKey?: never }
    | { apiKey: string; username?: never; password?: never };

export type ClientOptions = AuthOptions & {
    baseUrl: string;
    clientName: string;
    apiVersion?: string; // default 1.16.1
    fetchImpl?: typeof fetch;
};

export class SubsonicError extends Error {
    constructor(
        public code: number,
        message: string,
        public helpUrl?: string,
    ) {
        super(`Subsonic ${code}: ${message}`);
    }
}

export class SubsonicClient {
    private baseUrl: string;
    private clientName: string;
    private apiVersion: string;
    private fetchImpl: typeof fetch;
    private auth: AuthOptions;

    constructor(opts: ClientOptions) {
        this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
        this.clientName = opts.clientName;
        this.apiVersion = opts.apiVersion ?? "1.16.1";
        this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
        if ("apiKey" in opts && opts.apiKey) {
            this.auth = { apiKey: opts.apiKey };
        } else {
            this.auth = { username: opts.username!, password: opts.password! };
        }
    }

    /** Build a signed URL — useful for <audio src=...>, <img src=...>, or sharing. */
    url(method: string, params: Record<string, string | number | boolean | undefined> = {}): string {
        const u = new URL(`${this.baseUrl}/rest/${method}.view`);
        const sp = u.searchParams;
        sp.set("v", this.apiVersion);
        sp.set("c", this.clientName);
        sp.set("f", "json");
        if ("apiKey" in this.auth) {
            sp.set("apiKey", this.auth.apiKey!);
        } else {
            const salt = randomHex(8);
            const token = md5((this.auth.password ?? "") + salt);
            sp.set("u", this.auth.username!);
            sp.set("t", token);
            sp.set("s", salt);
        }
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined) sp.set(k, String(v));
        }
        return u.toString();
    }

    /** Build a stream URL (binary endpoint). */
    streamUrl(
        id: string,
        opts: {
            maxBitRate?: number;
            format?: string;
            estimateContentLength?: boolean;
            timeOffset?: number;
        } = {},
    ): string {
        return this.url("stream", { id, ...opts });
    }

    /** Build a cover-art URL. */
    coverArtUrl(id: string, size?: number): string {
        return this.url("getCoverArt", { id, size });
    }

    /** Call a JSON endpoint and return the unwrapped payload. Throws on error. */
    async get<T = Record<string, unknown>>(
        method: string,
        params: Record<string, string | number | boolean | undefined> = {},
    ): Promise<T> {
        const res = await this.fetchImpl(this.url(method, params), {
            headers: { Accept: "application/json" },
        });
        const json = (await res.json()) as SubsonicEnvelope<T>;
        const env = json["subsonic-response"];
        if (!env || env.status !== "ok") {
            const err = env?.error;
            throw new SubsonicError(err?.code ?? 0, err?.message ?? "Unknown", err?.helpUrl);
        }
        return env as unknown as T;
    }

    ping() {
        return this.get<{ version: string; openSubsonic?: boolean; type?: string }>("ping");
    }

    /** Discover OpenSubsonic extensions. Returns empty array on legacy servers. */
    async extensions(): Promise<Array<{ name: string; versions: number[] }>> {
        try {
            const r = await this.get<{
                openSubsonicExtensions?: Array<{ name: string; versions: number[] }>;
            }>("getOpenSubsonicExtensions");
            return r.openSubsonicExtensions ?? [];
        } catch {
            return [];
        }
    }
}

// --- tiny crypto helpers ------------------------------------------------

function randomHex(bytes: number): string {
    const out = new Uint8Array(bytes);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
        crypto.getRandomValues(out);
    } else {
        // Node <19 fallback; modern runtimes always have globalThis.crypto.
        for (let i = 0; i < bytes; i++) out[i] = Math.floor(Math.random() * 256);
    }
    let s = "";
    for (const b of out) s += b.toString(16).padStart(2, "0");
    return s;
}

/**
 * md5(string) → 32-char lowercase hex.
 * Public-domain implementation — faster than pulling js-md5 for a single call.
 */
function md5(input: string): string {
    const bytes = new TextEncoder().encode(input);
    const msg = new Uint8Array(bytes.length + 64);
    msg.set(bytes);
    const bitLen = bytes.length * 8;
    msg[bytes.length] = 0x80;
    const padLen = bytes.length + 1 + ((56 - ((bytes.length + 1) % 64)) + 64) % 64;
    const view = new DataView(msg.buffer, 0, padLen + 8);
    view.setUint32(padLen, bitLen & 0xffffffff, true);
    view.setUint32(padLen + 4, Math.floor(bitLen / 0x100000000), true);

    const K = [
        0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
        0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
        0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
        0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
        0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
        0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
        0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
        0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
    ];
    const R = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
        5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];

    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    const rot = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;

    for (let chunk = 0; chunk < padLen + 8; chunk += 64) {
        const M = new Array(16);
        for (let i = 0; i < 16; i++) {
            M[i] =
                msg[chunk + i * 4] |
                (msg[chunk + i * 4 + 1] << 8) |
                (msg[chunk + i * 4 + 2] << 16) |
                (msg[chunk + i * 4 + 3] << 24);
            M[i] = M[i] >>> 0;
        }
        let A = a0, B = b0, C = c0, D = d0;
        for (let i = 0; i < 64; i++) {
            let F: number, g: number;
            if (i < 16) { F = (B & C) | (~B & D); g = i; }
            else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
            else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
            else { F = C ^ (B | ~D); g = (7 * i) % 16; }
            F = ((F + A + K[i] + M[g]) | 0) >>> 0;
            A = D;
            D = C;
            C = B;
            B = (B + rot(F, R[i])) >>> 0;
        }
        a0 = (a0 + A) >>> 0;
        b0 = (b0 + B) >>> 0;
        c0 = (c0 + C) >>> 0;
        d0 = (d0 + D) >>> 0;
    }

    const toHex = (n: number) =>
        [0, 1, 2, 3]
            .map((i) => ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, "0"))
            .join("");
    return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0);
}
