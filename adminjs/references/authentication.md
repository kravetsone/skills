# Authentication

AdminJS ships `DefaultAuthProvider` for simple email/password auth. Under `adminjs-elysia`, login is wrapped in JWT cookies signed with your `cookiePassword`. This file covers the default flow, the cookie-name bug (read this first), DB-backed auth, role gating, and dev bypass.

## TL;DR

```typescript
import { DefaultAuthProvider } from "adminjs";
import { buildAuthenticatedRouter } from "adminjs-elysia";

const provider = new DefaultAuthProvider({
    componentLoader,
    authenticate: async ({ email, password }) => {
        if (email === config.ADMIN_EMAIL && password === config.ADMIN_PASSWORD) {
            return { email };  // any truthy object = success, gets JWT-signed into cookie
        }
        return null;            // false / null = reject
    },
});

export const adminRouter = new Elysia({ detail: { hide: true } }).use(
    await buildAuthenticatedRouter(admin, {
        provider,
        cookiePassword: config.ADMIN_COOKIE_SECRET, // ≥32 chars random
        cookieName: "adminjs",                       // ← REQUIRED: see bug below
    }, {}),
);
```

## The cookie-name bug (v0.1.4)

In `buildAuthenticatedRouter.js`, the login POST defaults `cookieName` to `"adminjs"`, but the protection middleware defaults to `"adminUser"`. If you omit `cookieName`, login sets one cookie, the guard reads another — you're redirected back to login on every protected request.

**Always set `cookieName` explicitly** — any value works, as long as it's identical for both branches. `"adminjs"` is conventional.

```typescript
buildAuthenticatedRouter(admin, {
    provider,
    cookiePassword,
    cookieName: "adminjs",   // ← force consistency
}, {});
```

## What `cookiePassword` actually is

It's the HS256 **JWT secret**, not a password. Use a long random string — 32+ bytes. The authenticated user object is serialized into the JWT payload, so anything returned from `authenticate()` is visible to anyone with the cookie (but not modifiable without the secret).

```bash
# generate one
openssl rand -base64 48
```

Store it as `ADMIN_COOKIE_SECRET` in env. **Never** use the same string as the admin password — if the cookie secret leaks, anyone can forge admin sessions.

## Skipping auth in dev

A clean switch based on whether admin creds are configured at all:

```typescript
async function createRouter() {
    if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD) {
        return buildRouter(admin, {});  // no auth in dev if creds absent
    }
    const provider = new DefaultAuthProvider({
        componentLoader,
        authenticate: async ({ email, password }) => {
            if (email === config.ADMIN_EMAIL && password === config.ADMIN_PASSWORD) {
                return { email };
            }
            return null;
        },
    });
    return buildAuthenticatedRouter(admin, {
        provider,
        cookiePassword: config.ADMIN_COOKIE_SECRET || config.ADMIN_PASSWORD,
        cookieName: "adminjs",
    }, {});
}

export const adminRouter = new Elysia({ detail: { hide: true } }).use(await createRouter());
```

In dev, leave `ADMIN_EMAIL` and `ADMIN_PASSWORD` unset → no login. In prod, required → login gate.

**Never deploy with creds unset in production** — add an assert:

```typescript
if (config.NODE_ENV === "production" && !config.ADMIN_PASSWORD) {
    throw new Error("ADMIN_PASSWORD must be set in production");
}
```

## DB-backed auth — one admin user per row

```typescript
import { compare } from "bcrypt";
import { eq } from "drizzle-orm";
import { adminUsersTable } from "../db/schema";

const provider = new DefaultAuthProvider({
    componentLoader,
    authenticate: async ({ email, password }) => {
        const [user] = await db.select().from(adminUsersTable)
            .where(eq(adminUsersTable.email, email))
            .limit(1);
        if (!user) return null;
        const ok = await compare(password, user.passwordHash);
        if (!ok) return null;
        return {
            id: user.id,
            email: user.email,
            role: user.role,           // persisted into JWT
            permissions: user.perms,   // for isAccessible checks
        };
    },
});
```

Schema for `adminUsersTable`:

```typescript
export const adminUsersTable = pgTable("admin_users", {
    id: serial("id").primaryKey(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ["admin", "editor", "viewer"] }).notNull(),
    perms: jsonb("perms").$type<string[]>().default([]),
    createdAt: timestamp("created_at").defaultNow(),
});
```

Use bcrypt (10+ rounds) or argon2id. **Never** store plain passwords.

### Seeding the first admin

Bun one-liner:

```bash
bun run -e "import bcrypt from 'bcrypt'; console.log(await bcrypt.hash('changeme', 12))"
```

Then:

```sql
INSERT INTO admin_users (email, password_hash, role) VALUES
    ('admin@example.com', '$2b$12$...', 'admin');
```

## Role gating at the action level

Use `isAccessible` on custom + built-in actions:

```typescript
options: {
    actions: {
        delete: {
            isAccessible: ({ currentAdmin }) =>
                currentAdmin?.role === "admin",
        },
        new: {
            isAccessible: ({ currentAdmin }) =>
                ["admin", "editor"].includes(currentAdmin?.role ?? ""),
        },
        // custom actions
        approve: {
            actionType: "record",
            isAccessible: ({ currentAdmin }) =>
                currentAdmin?.permissions?.includes("items:approve"),
            handler: /*...*/
        },
    },
},
```

`currentAdmin` comes from the JWT payload — the same object you returned from `authenticate()`.

## Role gating at the resource level

Hide an entire resource from viewers:

```typescript
{
    resource: { table: secretTable, db },
    options: {
        navigation: ({ currentAdmin }) =>
            currentAdmin?.role === "admin" ? { name: "Secret" } : null,
    },
},
```

`navigation: null` hides from the sidebar but the resource is still accessible via URL — add `isAccessible` on actions for true enforcement.

## OAuth / OIDC via Keycloak (`@gugupy/adminjs-keycloak`)

For Keycloak / OIDC / most SSO setups, use `@gugupy/adminjs-keycloak`. It implements the OAuth code flow end-to-end and returns an AdminJS `CurrentAdmin` ready for JWT signing.

```bash
bun add @gugupy/adminjs-keycloak
```

**Upstream caveat:** the package README states it's **tested with `@adminjs/express` only**. Under `adminjs-elysia`, the login endpoint integration is different — the package's "paste this Express middleware" snippet does not apply. The **auth provider itself** (`KeycloakAuthProvider` — exchanges code for tokens, fetches userinfo, builds `CurrentAdmin`) is framework-agnostic and works fine. What you need to write yourself is the Elysia route that captures the `?code=...` callback from Keycloak and POSTs it into AdminJS's login endpoint.

### Plug-in provider

```typescript
import { KeycloakAuthProvider } from "@gugupy/adminjs-keycloak";

const provider = new KeycloakAuthProvider({
    componentLoader,
    config: {
        realm: config.KEYCLOAK_REALM,
        authServerUrl: config.KEYCLOAK_URL,
        clientId: config.KEYCLOAK_CLIENT_ID,
        clientSecret: config.KEYCLOAK_CLIENT_SECRET,
        redirectUri: `${config.API_URL}/admin/login`,
    },
});

buildAuthenticatedRouter(admin, {
    provider,
    cookiePassword: config.ADMIN_COOKIE_SECRET,
    cookieName: "adminjs",
}, {});
```

### Elysia callback bridge

Keycloak redirects to `/admin/login?code=<authCode>` as a **GET**, but AdminJS's login handler listens for **POST**. Add a small Elysia route that catches the GET, extracts the code, and submits it as a form POST to AdminJS:

```typescript
import Elysia from "elysia";

export const keycloakCallback = new Elysia()
    .get("/admin/login", ({ query, set }) => {
        if (!query.code) return; // let AdminJS render the normal login page
        set.headers["Content-Type"] = "text/html; charset=utf-8";
        return `<!DOCTYPE html>
<html><body>
  <p>Signing you in…</p>
  <form id="f" method="POST" action="/admin/login">
    <input type="hidden" name="code" value="${query.code}" />
    <input type="hidden" name="redirectUri" value="${config.API_URL}/admin/login" />
  </form>
  <script>document.getElementById('f').submit();</script>
</body></html>`;
    });

// Mount BEFORE the admin router
new Elysia()
    .use(keycloakCallback)
    .use(adminRouter);
```

Why the HTML form trick? You could redirect with a 307 and preserve the GET method, but POSTing gives you a clean same-origin request through which AdminJS's login handler can set cookies. This is the pattern the upstream Express README demonstrates.

### Example logout

Keycloak sessions outlive AdminJS cookies. To fully sign out, add a logout handler that clears the local cookie and redirects to Keycloak's end-session endpoint:

```typescript
new Elysia()
    .get("/admin/logout", ({ cookie, set }) => {
        cookie.adminjs?.remove();
        set.redirect = `${config.KEYCLOAK_URL}/realms/${config.KEYCLOAK_REALM}/protocol/openid-connect/logout?redirect_uri=${encodeURIComponent(config.API_URL + "/admin")}`;
    });
```

### Role mapping from Keycloak realm roles

`KeycloakAuthProvider` populates `currentAdmin.roles` from the token's `realm_access.roles` array. Gate actions by realm role:

```typescript
isAccessible: ({ currentAdmin }) =>
    (currentAdmin?.roles as string[] | undefined)?.includes("admin") ?? false,
```

## Custom `BaseAuthProvider`

For OAuth / SSO / magic links not covered by Keycloak or Firebase, subclass `BaseAuthProvider<Context>`:

```typescript
import { BaseAuthProvider, type LoginHandlerOptions } from "adminjs";
import type { Context } from "elysia";

class OAuthProvider extends BaseAuthProvider<Context> {
    async handleLogin(opts: LoginHandlerOptions, ctx: Context) {
        // opts.data is the form body; opts.query is the URL query
        // return the authenticated user object, or null to reject
    }

    getUiProps() {
        // Return props injected into the AdminJS env — used to render login UI
        return { inputType: "email" };
    }
}
```

Then pass `provider: new OAuthProvider()` to `buildAuthenticatedRouter`. For true external OAuth, the login page needs a custom component (render a "Sign in with X" button that redirects to the OAuth provider); handle the callback in a separate Elysia route that forges the cookie using the same JWT secret and then redirects to `/admin`.

## Logout

`adminjs-elysia` registers `GET /logout` that clears the cookie and redirects to `rootPath`. There's no UI button for it by default — add one in a custom header component, or send users to `https://example.com/admin/logout` manually.

## Common issues

| Symptom | Cause | Fix |
|---|---|---|
| Login appears to succeed, then redirects back to `/admin/login` | Cookie-name mismatch (v0.1.4 bug) | Set `cookieName: "adminjs"` explicitly |
| "Invalid credentials" with correct creds | Your `authenticate()` returned `false` or the wrong type — must return truthy object or `null` | Return `{ email }` on success |
| JWT expired / malformed | `cookiePassword` changed between deploys; rolling deploys with different secrets kick sessions | Pin the secret; rotate via a blue/green deploy if needed |
| Login page 404 | `rootPath` + `loginPath` misconfigured | Default `loginPath: "/admin/login"` works; only customize if you truly moved the panel |
| Auth bypassed on some routes | `buildAuthenticatedRouter`'s guard excludes the bundle route (`/admin/frontend/assets/components.bundle.js`). That's intentional — the login page needs JS. | Don't worry about it |
| CSRF protection? | None built-in — AdminJS relies on same-origin fetch + the session cookie being `HttpOnly`. For extra safety, front with a reverse proxy that enforces same-origin | |
| Want to see current admin in a component | `const [currentAdmin] = useCurrentAdmin()` from `adminjs` | |

## Environment variables — copy to `.env.example`

```bash
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-me
ADMIN_COOKIE_SECRET=<openssl rand -base64 48>
```

## Don't do this

- Don't store the admin password in version control.
- Don't reuse the `BOT_TOKEN` or `DATABASE_URL` as `ADMIN_COOKIE_SECRET`.
- Don't authenticate against an **untrusted** header (`x-user`) in a real deployment — the guard only checks the JWT cookie, so spoofed headers are ignored anyway, but if you write a custom provider that reads headers, think about who controls them.
- Don't omit `cookieName` and hope the default works — see bug section above.
