# Authentication

Four schemes exist. Pick based on server capabilities (see the `getOpenSubsonicExtensions` response) and deployment constraints.

| Scheme | Params | When to use |
|--------|--------|-------------|
| Token + salt (md5) | `u`, `t`, `s`, `v`, `c`, `f` | **Default** for Subsonic ≥1.13.0 and all OpenSubsonic servers |
| Cleartext / enc:hex | `u`, `p` | Legacy only (pre-1.13.0); avoid — exposes password |
| API Key | `apiKey` | Best choice when `apiKeyAuthentication` extension is advertised |
| Reverse proxy (Navidrome only) | — (no client-side auth) | Navidrome behind Authelia/oauth2-proxy etc. |

All four share the common parameters:

| Param | Required | Purpose |
|-------|----------|---------|
| `v` | yes | API version the **client** speaks. Use `1.16.1`. |
| `c` | yes | Client name — short, stable, human-readable. Server uses it for analytics and per-client play-queue persistence. |
| `f` | no | Response format — `xml` (default), `json`, `jsonp`. Always send `json`. |

## 1. Token + salt (recommended baseline)

Compute for **every** request:

```
salt  = 6+ random ASCII chars (use hex for safety)
token = md5(UTF-8(password) + UTF-8(salt))  ← lowercase hex, 32 chars
```

### Node / Bun / Deno

```ts
import { createHash, randomBytes } from "node:crypto";

function authParams(password: string) {
    const salt = randomBytes(8).toString("hex"); // 16 chars
    const token = createHash("md5").update(password + salt).digest("hex");
    return { t: token, s: salt };
}
```

### Browser / Cloudflare Workers / Edge

`crypto.subtle` does **not** expose MD5. Use a pure-JS implementation.

```ts
import md5 from "js-md5"; // or 'spark-md5'

function authParams(password: string) {
    const salt = crypto.getRandomValues(new Uint8Array(8))
        .reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
    const token = md5(password + salt); // lowercase hex string
    return { t: token, s: salt };
}
```

### URL example

```
GET https://navidrome.example.com/rest/ping.view
    ?u=alice
    &t=26719a1196d2a940705a59634eb18eab
    &s=c19b2d
    &v=1.16.1
    &c=my-app
    &f=json
```

- **Never reuse a salt.** Regenerate on every request — replay attacks otherwise become trivial if a URL leaks.
- **Salt ≥ 6 characters.** Some servers reject shorter. Hex salts of 8 random bytes (16 chars) are a safe default.
- **Password is UTF-8.** Non-ASCII (Cyrillic, emoji) passwords must be byte-encoded before hashing.
- **Do not log full URLs** — the token is bearer-equivalent. Mask `t=`/`s=` in logs.

## 2. Cleartext / enc:hex (legacy — avoid)

```
?u=alice&p=hunter2                          ← plain
?u=alice&p=enc:68756e74657232                ← hex-encoded (just for URL safety, NOT encryption)
```

Only use when connecting to a pre-1.13.0 Subsonic instance that doesn't understand tokens. Navidrome accepts `p=` but will log warnings. Any LDAP-backed Subsonic returns **error 41** if you try token auth — fall back to `p=`.

## 3. API Key (OpenSubsonic extension `apiKeyAuthentication`)

**Provisioning is implementation-specific** — the spec deliberately leaves this to servers:

- **Navidrome:** user settings → API keys (UI). Also available via the native `/api/user/:id/apikey` endpoint (admin).
- **Other OpenSubsonic servers:** check their docs.

**Request shape:**

```
GET /rest/ping.view?apiKey=<key>&v=1.16.1&c=my-app&f=json
```

**Hard rules:**

- **Do not send `u=`** when using `apiKey`. The server returns **error 43** "Multiple conflicting authentication mechanisms provided".
- **Do not mix** `apiKey` with `t`/`s` or `p`. Same error 43.
- **Feature-detect first:**
  ```ts
  const exts = (await client.get("getOpenSubsonicExtensions")).openSubsonicExtensions ?? [];
  const supportsApiKey = exts.some((e) => e.name === "apiKeyAuthentication");
  ```
- Error codes for this extension: **42** unsupported mechanism, **43** conflict, **44** (reserved). All responses carry an optional `helpUrl` field — surface it to the user.

## 4. Reverse-proxy authentication (Navidrome only)

When Navidrome sits behind an identity-aware proxy (Authelia, oauth2-proxy, Keycloak gatekeeper, Tailscale Funnel), delegate auth entirely:

```toml
# navidrome.toml
ReverseProxyUserHeader   = "X-Forwarded-User"
ReverseProxyWhitelist    = "10.0.0.0/8,127.0.0.1/32"
```

- The proxy strips/overwrites the header for untrusted paths and injects the authenticated username.
- Navidrome trusts `X-Forwarded-User` **only** from CIDRs in `ReverseProxyWhitelist`. Everything else is rejected.
- Clients **do not** send credentials — the proxy enforces auth upstream. Subsonic API calls still need `u=`, but `t/s/p` can be anything (the server ignores them if the header is trusted).
- See https://www.navidrome.org/docs/usage/integration/authentication/ for full matrix.

## 5. `form POST` extension (OpenSubsonic)

When a request has many params (e.g. `updatePlaylist` with hundreds of `songIdToAdd`), URL length can exceed proxy limits (~8 KB). The `formPost` extension allows:

```http
POST /rest/updatePlaylist.view HTTP/1.1
Content-Type: application/x-www-form-urlencoded

u=alice&t=...&s=...&v=1.16.1&c=my-app&f=json&playlistId=abc&songIdToAdd=id1&songIdToAdd=id2&...
```

Feature-detect by checking for `formPost` in `getOpenSubsonicExtensions`. Fall back to `GET` with URL-chunking otherwise.

## CVE-2025-27112 — Navidrome Subsonic authbypass

Navidrome `<0.54.1` had a bug: Subsonic API accepted requests for **non-existent usernames** without validating credentials (they simply failed silently in certain paths). Impact: information disclosure via crafted usernames.

- **Fixed in:** Navidrome 0.54.1 (Feb 2025).
- **Detection:** call `ping.view` with a random `u=totallyrandom_xyz123&t=garbage&s=garbage` — if the response is `status="ok"` instead of error 40, the server is vulnerable.
- **Advisory:** https://github.com/advisories/GHSA-c3p4-vm8f-386p

Your client should warn loudly when probing detects a vulnerable version.

## Worked example: pick-best auth flow

```ts
async function negotiateAuth(baseUrl: string, user: string, pass: string, clientName: string) {
    // Step 1: ping with token+salt
    const { token, salt } = computeTokenSalt(pass);
    const url = new URL(`${baseUrl}/rest/ping.view`);
    url.search = new URLSearchParams({
        u: user, t: token, s: salt,
        v: "1.16.1", c: clientName, f: "json",
    }).toString();
    const pong = await (await fetch(url)).json();
    if (pong["subsonic-response"]?.status !== "ok") {
        throw new Error(`Auth failed: ${JSON.stringify(pong)}`);
    }

    // Step 2: if OpenSubsonic, offer API key flow
    if (pong["subsonic-response"].openSubsonic === true) {
        const ext = await fetchExtensions(baseUrl, user, pass, clientName);
        if (ext.some((e) => e.name === "apiKeyAuthentication")) {
            console.log("Server supports apiKeyAuthentication — consider upgrading.");
        }
    }
    return { mode: "tokenSalt" as const };
}
```

Output of [`scripts/check-server.mjs`](../scripts/check-server.mjs) already encodes this negotiation and prints actionable suggestions.
