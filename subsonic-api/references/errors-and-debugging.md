# Errors & debugging

## Error codes

Every failure comes inside an HTTP **200** with `status="failed"` and an `error` object. Canonical codes (Subsonic 1.16.1 + OpenSubsonic additions):

| Code | Message | Meaning / action |
|------|---------|------------------|
| 0 | Generic error | Server bug or unexpected state. Inspect `message`. |
| 10 | Required parameter missing | Fix the call. The message names the missing param. |
| 20 | Incompatible Subsonic REST protocol version (client must upgrade) | You sent `v=1.X` older than the server accepts. Raise `v`. |
| 30 | Incompatible Subsonic REST protocol version (server must upgrade) | You sent `v=1.Y` newer than the server supports. Lower `v` to `1.16.1` (or what `ping` reports). |
| 40 | Wrong username or password | Standard auth fail. |
| 41 | Token authentication not supported for LDAP users | Fall back to cleartext `p=` (only over HTTPS). |
| 42 🆕 | Provided authentication mechanism not supported | OpenSubsonic: the server rejects this auth mode (e.g. API key disabled). |
| 43 🆕 | Multiple conflicting authentication mechanisms provided | You sent `apiKey` and `u=` / `t=` together. Use one scheme only. |
| 44 🆕 | Invalid API key | Reserved/soft — some servers use code 40 for this. |
| 50 | User is not authorized for the given operation | Admin-only endpoint called without admin role, or `EnableSharing=false` etc. |
| 60 | The trial period for the Subsonic server is over | Legacy Subsonic Premium. Doesn't apply to Navidrome. |
| 70 | The requested data was not found | Unknown id, or endpoint not implemented (Navidrome uses 70 for video/jukebox/chat). |

OpenSubsonic adds an optional **`helpUrl`** on every error — surface it to the user verbatim.

```jsonc
{
  "subsonic-response": {
    "status": "failed",
    "version": "1.16.1",
    "type": "navidrome",
    "serverVersion": "0.55.2",
    "openSubsonic": true,
    "error": {
      "code": 43,
      "message": "Multiple conflicting authentication mechanisms provided",
      "helpUrl": "https://opensubsonic.netlify.app/docs/extensions/apikeyauth/"
    }
  }
}
```

## Response envelope checking

```ts
type SubsonicResponse<T> = {
    "subsonic-response": {
        status: "ok" | "failed";
        version: string;
        type?: string;
        serverVersion?: string;
        serverName?: string;
        openSubsonic?: boolean;
        error?: { code: number; message: string; helpUrl?: string };
    } & Partial<T>;
};

function assertOk<T>(json: SubsonicResponse<T>): asserts json is SubsonicResponse<T> & {
    "subsonic-response": { status: "ok" };
} {
    const env = json["subsonic-response"];
    if (env.status !== "ok") {
        const err = env.error;
        const msg = `Subsonic ${err?.code ?? "?"}: ${err?.message ?? "unknown"}`;
        const e = new Error(msg) as Error & { code?: number; helpUrl?: string };
        e.code = err?.code;
        e.helpUrl = err?.helpUrl;
        throw e;
    }
}
```

## Common failure modes

### HTTP 404 from the server (not `status="failed"`)

The endpoint doesn't exist on this server. Causes:
- Typo in method name (`searchThree` instead of `search3`).
- OpenSubsonic-only endpoint on a legacy server (check `openSubsonic` flag first).
- Navidrome version too old for a new endpoint (e.g. `getLyricsBySongId` needs Navidrome ≥ 0.53).

### HTTP 501 / 405

Some reverse proxies reject methods they don't know. If you're sending `POST` (via `formPost` extension) and get 405/501, the extension isn't supported — fall back to GET.

### Silent `status="ok"` with empty payload

Auth is fine, but the endpoint returned no data:
- `getArtistInfo2` — no Last.fm agent configured.
- `getAlbumList2?type=frequent` — user has no playback history yet.
- `search3` — no tokens match (but check you didn't accidentally send Lucene syntax).

### CORS preflight fails in browser

The `/rest/*` endpoints are CORS-open on Navidrome. If you still see CORS errors:
- You hit `/api/*` (native) from a browser — that route is same-origin only.
- Reverse proxy stripped the ACA-O headers — check Nginx/Caddy config.
- You sent a non-standard header (custom `X-My-Client`) — preflight requires server echo.

## Debug logging

**Never log the full URL** — the `t=` / `s=` parameters are a replayable bearer. Mask them:

```ts
function maskUrl(u: string | URL): string {
    const url = new URL(u);
    for (const key of ["t", "s", "p", "apiKey", "token"]) {
        if (url.searchParams.has(key)) url.searchParams.set(key, "***");
    }
    return url.toString();
}
```

For deep debugging, enable a verbose mode that prints:
- Method + masked URL
- Response HTTP status + `status` field
- On error: code, message, helpUrl
- Latency

Print only to a user-invoked debug channel — never to server logs by default.

## Retry policy

- **Transport errors (DNS / connection reset / 5xx):** exponential backoff, 3–5 tries, jitter. `stream` is idempotent at the byte level — safe to retry with `Range: bytes=<resumeFrom>-`.
- **`status="failed"` with code 0/10/40/43/50/70:** **do not retry** — they're programmer errors.
- **Code 20/30:** switch `v=` and retry once.
- **`scrobble` submissions that fail in offline mode:** queue locally (IndexedDB / SQLite), retry on reconnect with original `time` values. Navidrome accepts historical scrobbles.

## Version detection at startup

```ts
const pong = await client.get("ping");
const env = pong["subsonic-response"];

const isOpenSubsonic = env.openSubsonic === true;
const serverKind = env.type ?? "unknown";     // "navidrome", "gonic", "airsonic", ...
const serverVersion = env.serverVersion ?? ""; // "0.55.2"

// Navidrome ≥ 0.54.1 is required (CVE-2025-27112)
if (serverKind === "navidrome") {
    const [maj, min, patch] = serverVersion.split(".").map(Number);
    if (maj === 0 && (min < 54 || (min === 54 && patch < 1))) {
        console.warn(
            "⚠️  Navidrome < 0.54.1 is vulnerable to CVE-2025-27112. Upgrade.",
        );
    }
}
```

## Quick-check cheat sheet

| Symptom | First thing to check |
|---------|----------------------|
| "Wrong username or password" on correct creds | Salt too short, non-UTF8 password encoding, or LDAP user needs `p=` |
| Works in curl, fails in browser | MD5 — Web Crypto doesn't expose it; use `js-md5` |
| Works against demo.navidrome.org, not self-hosted | Reverse proxy stripping CORS / auth headers |
| `status="ok"` but `albumList2` is empty | Wrong `type=`, `size`/`offset` out of range, or no library access for this user |
| Scrobble 200 OK but play count unchanged | Missing `submission=true` (only `submission=false` was sent for "now playing") |
| `stream` returns XML, not audio | Error response — parse it; likely invalid `id` |
| `getLyricsBySongId` returns 404 | Server doesn't advertise `songLyrics` extension — fall back to `getLyrics?artist=&title=` |
