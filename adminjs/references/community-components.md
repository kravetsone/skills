# Community components — `@rulab/adminjs-components`

A curated feature pack that covers 90% of "I need a small UI component" requests without writing custom React. Eight features in one package, all pluggable via `features: [...]` on a resource. Peer-deps `@adminjs/design-system@^4.1`, `@adminjs/upload@^4`, `adminjs@^7.8.1`, `react@^18.2`, `styled-components@^6.1`.

## Install

```bash
bun add @rulab/adminjs-components
```

## Setup — share the ComponentLoader

The package's features all need your `ComponentLoader` to register their React components. Two ways:

```typescript
// Option A — set once globally
import { setComponentLoader } from "@rulab/adminjs-components";

const componentLoader = new ComponentLoader();
setComponentLoader(componentLoader);

// Now every feature picks it up automatically
features: [ColorStatusFeature({ key: "status", availableValues: [...] })],
```

```typescript
// Option B — pass per-feature (more explicit)
features: [
    ColorStatusFeature({ componentLoader, key: "status", availableValues: [...] }),
],
```

Use Option A for consistency. Option B when you have multiple panels with different loaders.

## Feature-order rule (IMPORTANT)

AdminJS merges `list.after` / `list.before` hooks in registration order. Several `@rulab` features register on `list.after`. **`@adminjs/upload` also registers a `list.after` that expects `records` to exist**.

**Rule:** if you combine features, put `SingletonFeature` **first**, `@adminjs/upload`'s `uploadFileFeature` **before** any feature that transforms `records` (like `ColorStatusFeature`), and anything that adds a custom `list` handler **last**.

```typescript
features: [
    SingletonFeature(),              // 1st when present — redirects list based on row count
    uploadFileFeature({ ... }),      // before status/color features that read records
    ColorStatusFeature({ ... }),
    TabsFeature({ ... }),            // tabs operate on edit/show, not list — order flexible
    SortableListFeature({ ... }),    // LAST — replaces the list handler entirely
],
```

The package prints a console notice if the order is wrong.

## `SingletonFeature` — one-row resources ("Settings", "HomePage")

Turns a resource into a singleton. Opening the list redirects:
- 0 rows → `/new`
- 1 row → `/edit/{id}`
- >1 rows → normal list with an error notice

```typescript
import { SingletonFeature } from "@rulab/adminjs-components";

{
    resource: { table: siteConfigTable, db },
    options: {
        navigation: { name: "Settings", icon: "Settings" },
    },
    features: [SingletonFeature()],
},
```

Classic use cases: site config, pricing page content, home banner, about-us text. No need for a bespoke route handler.

## `ColorStatusFeature` — colored badges instead of plain enum text

Drop-in replacement for AdminJS's default enum dropdown. Edit/list/show all render a colored pill.

```typescript
import { ColorStatusFeature } from "@rulab/adminjs-components";

features: [
    ColorStatusFeature({
        key: "status",
        nullable: false, // default false — first option auto-selected on new
        availableValues: [
            { value: "draft",     label: "Draft",      color: "#64748b" },
            { value: "review",    label: "In review",  color: "#f59e0b" },
            { value: "published", label: "Published",  color: "#16a34a" },
            { value: "archived",  label: "Archived",   color: "#dc2626" },
        ],
    }),
],
```

Replaces the `availableValues` + plain dropdown pattern from [resources-configuration](resources-configuration.md).

## `SlugFeature` — auto-generate URL slug from another field

Adds a "Generate slug" button next to a slug field. Clicking it slugifies the `source` field.

```typescript
import { SlugFeature } from "@rulab/adminjs-components";

features: [
    SlugFeature({
        key: "slug",
        source: "title",
        button: "Create slug", // optional label
    }),
],
```

Schema:

```typescript
export const articlesTable = pgTable("articles", {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    slug: text("slug").notNull().unique(),
    // ...
});
```

Replaces a typical `after` hook that slugifies on save — the feature lets editors pick / tweak the slug before save.

## `UuidFeature` — generate a UUID with one click

```typescript
import { UuidFeature } from "@rulab/adminjs-components";

features: [
    UuidFeature({
        key: "publicId",
        button: "Generate ID", // optional
    }),
],
```

Handy when users need a stable public id that's distinct from the auto-increment primary key.

## `EditorFeature` — EditorJS as a replacement for the buggy Tiptap richtext

**The big one.** If `@adminjs/design-system`'s Tiptap editor is causing pain (the broken link button, the horizontal-rule crash, the sparse toolbar), swap it for EditorJS.

```typescript
import { EditorFeature } from "@rulab/adminjs-components";

features: [
    EditorFeature({
        key: "content",
        // Optional — if set, Editor.js image-block uses @adminjs/upload provider
        uploadProvider: createProvider("editor-images"),
    }),
],
```

The `uploadProvider` accepts any `BaseProvider` subclass — your S3 provider from [s3-uploads](s3-uploads.md) plugs in directly. Image-block uploads land in the S3 prefix you configured.

Storage: EditorJS outputs a JSON block structure. Store it in a `jsonb` column:

```typescript
content: jsonb("content").$type<{ blocks: unknown[] }>(),
```

Render back to HTML on the frontend with the package's `parseHtml(data)` helper, or with [editorjs-html](https://www.npmjs.com/package/editorjs-html).

## `StringListFeature` — comma-/pipe-separated list in a single column

Edit view shows a sortable list with add/remove buttons. Stored as a single string with a chosen separator.

```typescript
import { StringListFeature } from "@rulab/adminjs-components";

features: [
    StringListFeature({
        key: "tags",
        separator: "|", // default "|"
    }),
],
```

Schema: just `text("tags")`. Simpler than a M2M tags table when you don't need to query individual tags.

## `SortableListFeature` — drag-and-drop reorder

Replaces the default list view with a table you can drag rows in. On drop, the feature POSTs to a hidden resource action that updates the `sortField`.

```typescript
import { SortableListFeature } from "@rulab/adminjs-components";

features: [
    SortableListFeature({
        sortField: "sort",                  // numeric column — default "sort"
        reorderActionName: "sortableListReorder", // default shown
        direction: "ASC",                    // "ASC" | "DESC"
    }),
],
```

Schema: add a numeric column for the sort position.

```typescript
sort: integer("sort").default(0),
```

**Replaces the `sortByOrder` before-hook trick from [drizzle-adapter](drizzle-adapter.md).** Much better UX — editors drag instead of editing numbers.

**Feature-order:** register this **last** — it replaces the whole `list` handler, and any feature registered after it won't see the custom list.

## `TabsFeature` — split long forms into tabs

Groups edit/show fields based on `props.tab` or `custom.tab` metadata. Fields without a tab go to a "Common" group (configurable).

```typescript
import { TabsFeature } from "@rulab/adminjs-components";

features: [
    TabsFeature({
        commonTabLabel: "General", // default "Common"
    }),
],

// And mark fields in resource options:
options: {
    properties: {
        title:          { props: { tab: "Main" } },
        description:    { props: { tab: "Main" } },
        seoTitle:       { props: { tab: "SEO" } },
        seoDescription: { props: { tab: "SEO" } },
        ogImage:        { props: { tab: "SEO" } },
        publishedAt:    { props: { tab: "Publishing" } },
        status:         { props: { tab: "Publishing" } },
    },
},
```

Renders three tabs — Main, SEO, Publishing — in that declaration order.

## `PreviewFeature` — iframe preview as a record action

Adds a "Preview" record action that renders an iframe pointing at your frontend's preview URL, with `$id` / `$slug` template substitution.

```typescript
import { PreviewFeature } from "@rulab/adminjs-components";

features: [
    PreviewFeature({
        url: "https://staging.example.com/posts/$slug?preview=1",
        actionName: "preview", // default
    }),
],
```

The record's params (`$id`, `$slug`, any `$<propertyName>`) are substituted into the URL. Good for CMS-style workflows where editors want to see their draft before publishing.

## Putting it all together — a real content resource

```typescript
import {
    ColorStatusFeature,
    EditorFeature,
    PreviewFeature,
    SlugFeature,
    SortableListFeature,
    TabsFeature,
    setComponentLoader,
} from "@rulab/adminjs-components";
import uploadFileFeature from "@adminjs/upload";

setComponentLoader(componentLoader);

{
    resource: { table: articlesTable, db },
    options: {
        navigation: { name: "Content", icon: "Book" },
        listProperties: ["id", "title", "slug", "posterFile", "status", "sort"],
        properties: {
            id: READONLY,
            title:          { props: { tab: "Main" } },
            slug:           { props: { tab: "Main" } },
            description:    { props: { tab: "Main" }, type: "textarea" },
            content:        { props: { tab: "Main" } },
            seoTitle:       { props: { tab: "SEO" } },
            seoDescription: { props: { tab: "SEO" }, type: "textarea" },
            status:         { props: { tab: "Publishing" } },
            publishedAt:    { props: { tab: "Publishing" } },
            posterPath:     HIDDEN,
            posterMimeType: HIDDEN,
            createdAt:      READONLY,
            updatedAt:      READONLY,
        },
    },
    features: [
        // 1. Upload — register before features that read records
        uploadFileFeature({
            componentLoader,
            provider: createProvider("articles"),
            properties: {
                key: "posterPath", file: "posterFile", mimeType: "posterMimeType",
            },
            uploadPath: (_r, name) => `${crypto.randomUUID()}${path.extname(name)}`,
            validation: { mimeTypes: IMAGE_MIME_TYPES },
        }),
        // 2. Status badges
        ColorStatusFeature({
            key: "status",
            availableValues: [
                { value: "draft",     label: "Draft",     color: "#64748b" },
                { value: "published", label: "Published", color: "#16a34a" },
            ],
        }),
        // 3. Slug button
        SlugFeature({ key: "slug", source: "title" }),
        // 4. EditorJS for long-form body
        EditorFeature({ key: "content", uploadProvider: createProvider("article-body") }),
        // 5. Tabs
        TabsFeature({ commonTabLabel: "General" }),
        // 6. Preview action
        PreviewFeature({ url: "https://staging.example.com/posts/$slug?preview=1" }),
        // 7. Drag-drop reorder — LAST, replaces list handler
        SortableListFeature({ sortField: "sort" }),
    ],
},
```

This one resource entry replaces: a `sortByOrder` before-hook, a custom slug hook, a rolled-your-own EditorJS integration, a bespoke preview action, and a custom status badge component. **~10 lines instead of ~300.**

## Trade-offs

- **Peer-deps `styled-components@^6`.** If your project uses emotion-only React, adding `styled-components` costs ~40 KB. Not a dealbreaker but worth noting.
- **Bundle size.** EditorJS + DnD Kit + all the sub-editorjs packages add ~200 KB to the admin bundle. Only matters if admin panel load time is already an issue.
- **Community-maintained.** `@rulab` is active (last update recent, 199 npm score) but not "official AdminJS". Breaking AdminJS upgrades may lag.
- **Not a hard replacement for built-in Tiptap.** The `EditorFeature` (EditorJS) is a different content format. Migrating existing Tiptap HTML content to EditorJS JSON requires a one-time script.

## When to skip this package

- Single-resource hobby panel → the features are overkill.
- You've already built your own slug/sort/tabs components → keep them, don't mix.
- Corporate policy against non-official packages → stick with raw `@adminjs/*` + custom React.
