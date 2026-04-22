/**
 * navidrome-native-client.ts — JWT client for Navidrome's native `/api/*` REST.
 *
 * ⚠️  UNSTABLE — the native API is officially "subject to change" on every Navidrome
 * release. Use only when Subsonic API can't do what you need (admin tasks, plugin
 * management, library config, smart-playlist evaluation, missing-files list).
 *
 * Auth:
 *   POST /auth/login { username, password } → { token, ... }
 *   Subsequent requests: x-nd-authorization: Bearer <token>
 *   The server returns a refreshed token in the response header on every call;
 *   this client auto-refreshes.
 *
 * Pagination is react-admin style: ?_sort=&_order=ASC&_start=&_end=&filter={...}
 */

export class NavidromeNativeClient {
    private baseUrl: string;
    private token: string | null = null;

    constructor(opts: { baseUrl: string }) {
        this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    }

    async login(username: string, password: string): Promise<void> {
        // Newer Navidrome (≥0.50) exposes POST /auth/login; older builds used
        // /api/authenticate. Try both — cache the one that works.
        const candidates = [`${this.baseUrl}/auth/login`, `${this.baseUrl}/api/authenticate`];
        let lastErr: unknown;
        for (const url of candidates) {
            try {
                const res = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ username, password }),
                });
                if (!res.ok) {
                    lastErr = new Error(`${url} → HTTP ${res.status}`);
                    continue;
                }
                const body = (await res.json()) as { token?: string };
                if (!body.token) {
                    lastErr = new Error(`${url} returned no token`);
                    continue;
                }
                this.token = body.token;
                return;
            } catch (e) {
                lastErr = e;
            }
        }
        throw new Error(`Navidrome native login failed: ${String(lastErr)}`);
    }

    private ensureToken(): string {
        if (!this.token) throw new Error("Not logged in — call .login() first.");
        return this.token;
    }

    private async request(
        method: "GET" | "POST" | "PUT" | "DELETE",
        path: string,
        params?: Record<string, string | number | boolean | object>,
        body?: unknown,
    ): Promise<Response> {
        const url = new URL(`${this.baseUrl}${path}`);
        if (params) {
            for (const [k, v] of Object.entries(params)) {
                url.searchParams.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
            }
        }
        const res = await fetch(url, {
            method,
            headers: {
                "x-nd-authorization": `Bearer ${this.ensureToken()}`,
                ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
                Accept: "application/json",
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        // Refresh token from response header if present.
        const refreshed = res.headers.get("x-nd-authorization");
        if (refreshed) this.token = refreshed.replace(/^Bearer\s+/i, "");
        if (!res.ok) {
            throw new Error(`Navidrome /api ${method} ${path} → HTTP ${res.status}`);
        }
        return res;
    }

    /** React-admin-style list query. Returns {items, total} (total parsed from X-Total-Count). */
    async list<T = unknown>(
        resource: string,
        opts: {
            sort?: string;
            order?: "ASC" | "DESC";
            start?: number;
            end?: number;
            filter?: Record<string, unknown>;
        } = {},
    ): Promise<{ items: T[]; total: number }> {
        const params: Record<string, string | number | object> = {};
        if (opts.sort) params._sort = opts.sort;
        if (opts.order) params._order = opts.order;
        if (opts.start !== undefined) params._start = opts.start;
        if (opts.end !== undefined) params._end = opts.end;
        if (opts.filter) params.filter = opts.filter;
        const res = await this.request("GET", `/api/${resource}`, params);
        const total = Number(res.headers.get("X-Total-Count") ?? "0");
        const items = (await res.json()) as T[];
        return { items, total };
    }

    async get<T = unknown>(resource: string, id: string): Promise<T> {
        const res = await this.request("GET", `/api/${resource}/${id}`);
        return (await res.json()) as T;
    }

    async create<T = unknown>(resource: string, body: unknown): Promise<T> {
        const res = await this.request("POST", `/api/${resource}`, undefined, body);
        return (await res.json()) as T;
    }

    async update<T = unknown>(resource: string, id: string, body: unknown): Promise<T> {
        const res = await this.request("PUT", `/api/${resource}/${id}`, undefined, body);
        return (await res.json()) as T;
    }

    async remove(resource: string, id: string): Promise<void> {
        await this.request("DELETE", `/api/${resource}/${id}`);
    }

    /** Open an SSE stream. EventSource can't set headers, so the JWT rides in `?jwt=`. */
    events(onMessage: (ev: MessageEvent) => void): () => void {
        const url = new URL(`${this.baseUrl}/api/events`);
        url.searchParams.set("jwt", this.ensureToken());
        const src = new EventSource(url.toString());
        src.onmessage = onMessage;
        return () => src.close();
    }
}

// Example usage (admin task: list all playlists across users)
//
//   const nav = new NavidromeNativeClient({ baseUrl: "https://nav.example.com" });
//   await nav.login("admin", "pw");
//   const { items, total } = await nav.list("playlist", {
//       sort: "name", order: "ASC", start: 0, end: 50,
//       filter: { public: true },
//   });
