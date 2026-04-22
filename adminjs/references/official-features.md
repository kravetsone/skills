# Official features (`@adminjs/*`)

Beyond `@adminjs/upload`, AdminJS ships four more official MIT-licensed features, one official premium feature, and a few auth providers. This file covers every one that integrates cleanly with the Drizzle + Elysia stack.

| Package | License | Purpose |
|---|---|---|
| `@adminjs/upload` | MIT | File uploads (see [s3-uploads](s3-uploads.md)) |
| `@adminjs/passwords` | MIT | Hash password columns before store |
| `@adminjs/logger` | MIT | Audit log — records every create/edit/delete |
| `@adminjs/import-export` | MIT | CSV/JSON/XML resource import + export actions |
| `@adminjs/leaflet` | MIT | Map/geo picker for lat/lng columns |
| `@adminjs/relations` | **Premium** (requires license key) | Many-to-many UI |
| `@adminjs/firebase-auth` | MIT | Firebase auth provider |
| `@adminjs/themes` | MIT | Pre-built light/dark themes |

---

## `@adminjs/passwords` — hashed password columns

Automatically hashes a password field via a user-supplied `hash()` function before store. The form shows a virtual `password` input; the DB column stores the hash in `encryptedPassword`.

### Install

```bash
bun add @adminjs/passwords bcrypt
# or argon2, scrypt, @node-rs/argon2, etc. — any hashing function works
```

### Schema

```typescript
// src/db/schema.ts
export const adminUsersTable = pgTable("admin_users", {
    id: serial("id").primaryKey(),
    email: text("email").notNull().unique(),
    encryptedPassword: text("encrypted_password").notNull(),
    role: text("role", { enum: ["admin", "editor", "viewer"] }).notNull().default("viewer"),
    createdAt: timestamp("created_at").defaultNow(),
});
```

### Resource wiring

```typescript
import passwordsFeature from "@adminjs/passwords";
import bcrypt from "bcrypt";

{
    resource: { table: adminUsersTable, db },
    options: {
        navigation: { name: "Admins", icon: "Shield" },
        listProperties: ["id", "email", "role", "createdAt"],
        properties: {
            id: READONLY,
            encryptedPassword: HIDDEN, // hash never shown in UI
            createdAt: READONLY,
        },
    },
    features: [
        passwordsFeature({
            componentLoader,
            properties: {
                password: "password",                     // virtual — form input
                encryptedPassword: "encryptedPassword",   // real DB column
            },
            hash: (plain) => bcrypt.hash(plain, 12),
        }),
    ],
},
```

### How it works (source-verified)

The feature registers a `before` hook on `new` + `edit` that:
1. Extracts `payload[password]` (virtual).
2. Runs `hash(plain)` asynchronously.
3. Replaces it with `payload[encryptedPassword] = <hash>`.

And an `after` hook that copies `encryptedPassword` validation errors back onto the virtual `password` field so they appear under the right form input.

The password input is marked `isVisible: { edit: true, list: false, show: false, filter: false }` — never rendered on show/list/filter, only on edit.

### Combining with DefaultAuthProvider

Plug the hash check into `authenticate()`:

```typescript
import { compare } from "bcrypt";

const provider = new DefaultAuthProvider({
    componentLoader,
    authenticate: async ({ email, password }) => {
        const [user] = await db.select().from(adminUsersTable)
            .where(eq(adminUsersTable.email, email)).limit(1);
        if (!user) return null;
        const ok = await compare(password, user.encryptedPassword);
        return ok ? { id: user.id, email: user.email, role: user.role } : null;
    },
});
```

### Gotchas

- The `hash` option is **required**. Passing `undefined` throws at AdminJS init.
- The hashed column **must be nullable** if you want to skip the password on edit — otherwise edits without a new password fail with NOT NULL. Either make `encryptedPassword` nullable, or force a value.
- The virtual `password` key defaults to `"password"`, which collides with nothing in Drizzle because the DB column is `encryptedPassword`. Don't name your DB column `password` — it'll clash with the virtual.

---

## `@adminjs/logger` — audit log

Attaches `before` + `after` hooks to every `new/edit/delete/bulkDelete` action of the target resources, writing a row to a separate `log` resource with the diff.

### Install

```bash
bun add @adminjs/logger
```

### Schema — the log table

```typescript
export const logsTable = pgTable("logs", {
    id: serial("id").primaryKey(),
    recordId: text("record_id"),
    recordTitle: text("record_title"),
    difference: jsonb("difference"),   // { field: { from, to } }
    action: text("action"),            // "new" | "edit" | "delete" | "bulkDelete"
    resource: text("resource"),        // SQL name of audited resource
    user: text("user"),                // currentAdmin identifier (from your auth)
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
});
```

### Resource wiring

```typescript
import { loggerFeature, createLoggerResource } from "@adminjs/logger";

// 1) Attach the feature to every resource you want to audit
{
    resource: { table: articlesTable, db },
    options: { /* ... */ },
    features: [
        loggerFeature({
            propertiesMapping: {
                id: "id",
                recordId: "recordId",
                recordTitle: "recordTitle",
                difference: "difference",
                action: "action",
                resource: "resource",
                user: "user",
                createdAt: "createdAt",
                updatedAt: "updatedAt",
            },
            // Optional — derive user identifier from currentAdmin
            userIdAttribute: "email",
        }),
    ],
},

// 2) Register the log resource separately so admins can browse it
createLoggerResource({
    resource: { table: logsTable, db },
    featureOptions: {
        propertiesMapping: { /* same as above */ },
    },
}),
```

`createLoggerResource` returns a ready-to-use resource entry with `list` and `show` custom views that render the diff nicely. Push it into the `resources` array alongside your normal entries.

### Gotchas

- The `difference` column **must be `jsonb`** (or text if your DB has no JSON type) — the feature writes a structured diff object.
- The log action writes happen in an `after` hook — if the main action crashes, the log row is **not** written. That's fine for audit (no half-truth), but means you can't use the log as a WAL.
- `user` needs an identifier. If your `authenticate()` returns `{ email, role }`, set `userIdAttribute: "email"`. If your `currentAdmin` has no stable id, the `user` column is `null`.
- `bulkDelete` logs one row per deleted record (not one for the batch) — can spam.

---

## `@adminjs/import-export` — CSV / JSON / XML import + export

Adds `export` and `import` **resource actions** (top-right buttons on list view). Supports CSV, JSON, XML — delimiter / separator chooseable in the UI. Uses `csvtojson`, `json2csv`, `xml2js` internally.

### Install

```bash
bun add @adminjs/import-export
```

### Wire it

```typescript
import importExportFeature from "@adminjs/import-export";

{
    resource: { table: articlesTable, db },
    options: { /* ... */ },
    features: [
        importExportFeature({ componentLoader }),
    ],
},
```

### What it does

- `export` (resource action): dumps all records → downloaded file in the user's chosen format. Applies the current filter/sort from the list page.
- `import` (resource action): upload a file → parses rows → calls `resource.create(...)` per row. Errors surface per-row.

### Gotchas

- **Export streams in memory** — fine for thousands, bad for millions. For large tables write your own batched export.
- **Import is one-shot**, no preview / dry-run. Users can wipe a resource by accident. Combine with a `before` hook that validates payload shape, or wrap `import` with `isAccessible` to restrict to admins.
- Virtual properties (upload `file`, password `password`) are included in exports by default as empty strings. Users re-importing a CSV may overwrite hashes with empties — validate before import.
- XML is quirky with nested objects; prefer CSV/JSON.

### Alternative — DIY export for big tables

For >100k rows, bypass the feature and write a resource action that streams to S3:

```typescript
actions: {
    exportLarge: {
        actionType: "resource",
        icon: "Download",
        handler: async (_req, _res, context) => {
            const key = `exports/${Date.now()}.csv`;
            // Stream from DB → transform to CSV → PUT to S3
            const url = await generateSignedExport(key);
            return {
                records: [],
                notice: { message: "Export ready", type: "success" as const },
                redirectUrl: url,
            };
        },
    },
},
```

---

## `@adminjs/leaflet` — map picker for geo columns

Renders a `react-leaflet` map with OpenStreetMap tiles for any lat/lng column. Edit view lets you click or search an address; show view pins a marker.

### Install

```bash
bun add @adminjs/leaflet leaflet react-leaflet
```

### Schema

```typescript
export const placesTable = pgTable("places", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
});
```

### Wire it

```typescript
import { leafletFeature } from "@adminjs/leaflet";

{
    resource: { table: placesTable, db },
    options: {
        properties: {
            latitude: HIDDEN,   // hidden — the map widget handles it
            longitude: HIDDEN,
        },
    },
    features: [
        leafletFeature({
            componentLoader,
            properties: {
                latitude: "latitude",
                longitude: "longitude",
                map: "map",  // virtual property name for the widget
            },
        }),
    ],
},
```

### Gotchas

- Leaflet pulls in ~50 KB of CSS via `leaflet/dist/leaflet.css` — included automatically but adds to the first admin page weight.
- Tiles come from OSM — rate-limited. For production, configure a custom tile provider (Mapbox, Maptiler) via feature options.
- No polygon/polyline editing in v2 — lat/lng point only.

---

## `@adminjs/relations` — many-to-many UI (premium)

**Not MIT.** Part of the paid AdminJS marketplace (`cloud.adminjs.co`). Requires a license key that the package validates against a remote server.

### What it does

Adds a "Related" tab on each resource's show page, listing records from another table via a join table. Users can attach/detach rows without writing a custom action.

### How licensing works

1. Buy a license via `cloud.adminjs.co` / `adminjs.co/pricing`.
2. Set `ADMIN_JS_LICENSE_KEY=...` in env.
3. `@adminjs/license` (transitively installed) phones home on startup to validate. If validation fails, the feature refuses to render — but the rest of AdminJS still works.

### Decision tree

- You need M2M admin UI, you're on a paid team, buying is fine → use `@adminjs/relations`.
- Free project / hobby / OSS → roll your own: two resources for the two sides of the relation + a custom `attach` / `detach` record action. ~60 lines of code. See [custom-actions](custom-actions.md) for the action shape.
- Community alternative: **`@hero-truong/adminjs-relation`** (GitHub: `hero-truong/adminjs-relation-hero`) — 185 npm score. Enhances `@adminjs/relations` but still needs the base (still paid).

### Rolling your own M2M

```typescript
// schema
export const postsToTags = pgTable("posts_to_tags", {
    postId: integer("post_id").notNull().references(() => postsTable.id),
    tagId: integer("tag_id").notNull().references(() => tagsTable.id),
}, (t) => ({ pk: primaryKey({ columns: [t.postId, t.tagId] }) }));

// register as its own AdminJS resource — users can CRUD joins directly
{
    resource: { table: postsToTags, db },
    options: {
        navigation: { name: "Content" },
        listProperties: ["postId", "tagId"],
    },
},
```

Simple but ugly UX. For something nicer, write a custom record action on `postsTable` that opens a modal with checkboxes for all tags and POSTs the diff to an `attachTags` handler.

---

## `@adminjs/firebase-auth` — Firebase auth provider

Drop-in replacement for `DefaultAuthProvider` when your users already live in Firebase. Verifies Firebase ID tokens + fetches user record.

```typescript
import { FirebaseAuthProvider } from "@adminjs/firebase-auth";

const provider = new FirebaseAuthProvider({
    componentLoader,
    firebaseProject: {
        credentials: { /* Firebase service account JSON */ },
    },
});

buildAuthenticatedRouter(admin, { provider, cookiePassword, cookieName: "adminjs" }, {});
```

Useful if you're already on Firebase. Otherwise stick with `DefaultAuthProvider` + password hashing.

---

## `@adminjs/themes` — light / dark

Already documented in [templates/admin-index.ts](../templates/admin-index.ts). Quick recap:

```typescript
import { dark, light } from "@adminjs/themes";

new AdminJS({
    defaultTheme: dark.id,
    availableThemes: [dark, light],
    // ...
});
```

Users can toggle via the topbar. No per-user persistence out of the box.

---

## Choosing features — a short decision matrix

| If you want to... | Use |
|---|---|
| Store hashed passwords for admin users | `@adminjs/passwords` + `DefaultAuthProvider` |
| Full audit trail of admin actions | `@adminjs/logger` + a `logsTable` |
| Let admins dump/import CSV quickly | `@adminjs/import-export` |
| Edit geo coordinates visually | `@adminjs/leaflet` |
| M2M editor on a paid project | `@adminjs/relations` |
| M2M editor on OSS / cheap | Roll your own, or register the join table as its own resource |
| OAuth / SSO | `@gugupy/adminjs-keycloak` (OIDC), `@adminjs/firebase-auth` (Firebase), or write a `BaseAuthProvider` subclass |
| Drag-drop reorder, slug gen, EditorJS rich text, tabs, singletons | `@rulab/adminjs-components` — see [community-components](community-components.md) |
