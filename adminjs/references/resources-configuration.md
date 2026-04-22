# Resource configuration

A **resource** is a table exposed in the admin UI. AdminJS discovers columns from the Drizzle adapter automatically, but you almost always want to override visibility, types, and ordering. This file catalogs every per-resource knob.

## Resource shape

```typescript
{
    resource: { table: usersTable, db },
    options: {
        // — metadata —
        id?: string,                    // override resource id; default = SQL table name
        parent?: string | NavigationGroup,

        // — navigation —
        navigation?: string | NavigationGroup | null,
        // Usage:
        //   navigation: { name: "Content", icon: "Book" }
        //   navigation: null  // hide from sidebar

        // — list/show/edit defaults —
        listProperties?: string[],       // which columns show in the list table
        showProperties?: string[],
        editProperties?: string[],
        filterProperties?: string[],
        sort?: { sortBy: string, direction: "asc" | "desc" },

        // — per-property overrides —
        properties?: Record<string, PropertyOptions>,

        // — hooks + custom actions —
        actions?: Record<string, ActionDecorator>,
    },
    features?: FeatureType[],
}
```

## `PropertyOptions` — the cheatsheet

```typescript
{
    // visibility
    isVisible?: boolean | { list?, show?, edit?, filter? },
    isDisabled?: boolean,
    isRequired?: boolean,

    // rendering
    type?: "string" | "number" | "float" | "boolean" | "date" | "datetime"
         | "uuid" | "textarea" | "richtext" | "mixed" | "reference" | "currency",
    availableValues?: Array<{ value: string, label: string }>,
    description?: string,
    position?: number,

    // component overrides
    components?: {
        list?: ComponentId,
        show?: ComponentId,
        edit?: ComponentId,
        filter?: ComponentId,
    },

    // reference (foreign-key) options
    reference?: string, // override detected reference target resource id
}
```

## Helper constants (every project should define these once)

```typescript
const READONLY    = { isDisabled: true };
const HIDDEN      = { isVisible: false };
const SHOW_ONLY   = { isVisible: { list: false, show: true, edit: false, filter: false } };
const EDIT_ONLY   = { isVisible: { list: false, show: true, edit: true, filter: false } };
const FILTER_ONLY = { isVisible: { list: false, show: true, edit: false, filter: true } };
const LIST_ONLY   = { isVisible: { list: true, show: true, edit: false, filter: false } };
```

Usage:

```typescript
properties: {
    id:              READONLY,
    startParameter:  FILTER_ONLY,      // don't clutter list, keep filterable
    languageCode:    SHOW_ONLY,
    termsAcceptedAt: SHOW_ONLY,
    createdAt:       READONLY,
    internalNotes:   HIDDEN,
},
```

## `listProperties` — curating the list table

Without `listProperties`, AdminJS dumps every column. That's unreadable after 5 columns. Pick 4–8 that matter:

```typescript
listProperties: [
    "id",
    "name",
    "avatarFile",        // virtual — renders uploaded image thumbnail
    "email",
    "isBanned",
    "createdAt",
],
```

- **Use the virtual upload property (`avatarFile`), not the raw path column.** The virtual one renders as a thumbnail; the path column renders as `"avatars/abc123.png"` plain text.
- `createdAt` in the last slot is a good default.
- For resources with an `order` column, include `order` and add a default sort (see below).

## Default sort — per-resource

AdminJS respects `options.sort`:

```typescript
options: {
    sort: { sortBy: "order", direction: "asc" },
    // ...
}
```

This **does not** apply to initial page load on some versions — if you see unsorted results, also attach a `before` hook:

```typescript
function sortByOrder(request: ActionRequest) {
    if (!request.query?.sortBy) {
        request.query = { ...request.query, sortBy: "order", direction: "asc" };
    }
    return request;
}

options: {
    sort: { sortBy: "order", direction: "asc" },
    actions: { list: { before: [sortByOrder] } },
},
```

## Navigation groups

```typescript
options: {
    navigation: { name: "Content", icon: "Book" },
}
```

Groups resources into collapsible sidebar sections. Use consistent names across resources ("Users", "Content", "Chat", "Feed", "Shop", "Tasks", "Game", "Broadcasts") — they become the sidebar headers. Icons come from Feather icons (`Book`, `User`, `Users`, `Send`, `Image`, `Package`, `Target`, `Play`, etc.).

- `navigation: null` hides the resource from the sidebar entirely (still accessible via direct URL).
- `navigation: "Content"` is a shorthand — no icon.

## Types — when to override

| Drizzle column | Auto type | Override to |
|---|---|---|
| `text("body")` for long prose | `string` | `"textarea"` or `"richtext"` |
| `jsonb("config")` | `textarea` | `"mixed"` (always) |
| `integer("price_cents")` where you want formatted currency | `number` | `"currency"` (with a custom component) or keep `number` + format in list component |
| `text("status", { enum: [...] })` | `string` with `availableValues` | Usually leave — the adapter detects enums |
| Date-only dates (no time) | `date` | Leave `date`; if Drizzle maps to `timestamp`, override to `"date"` |

### Richtext — the tiptap editor

```typescript
content: { type: "richtext" },
```

Renders the `@adminjs/design-system` tiptap editor. **Has a bug** (see main SKILL.md): the link button only *removes* links. Patch via [templates/patch-adminjs-richtext.mjs](../templates/patch-adminjs-richtext.mjs) as a postinstall.

### Textarea — plain multi-line

```typescript
description: { type: "textarea" },
```

Plain `<textarea>`. Use for descriptions, prompts, code snippets, etc.

### Geo / lat-lng — `@adminjs/leaflet`

For lat/lng columns, the official `@adminjs/leaflet` feature gives you a map widget with OSM tiles, click-to-drop-pin, and address search:

```typescript
import { leafletFeature } from "@adminjs/leaflet";

features: [
    leafletFeature({
        componentLoader,
        properties: { latitude: "latitude", longitude: "longitude", map: "map" },
    }),
],
```

See [official-features](official-features.md) → Leaflet.

### Mixed — structured object editor

```typescript
metadata: { type: "mixed" },
```

Renders each top-level key as a subfield. Essential for JSON columns. If the JSON is deeply nested, custom edit component is usually better.

## Custom enums / dropdowns

For non-enum string columns where you want a dropdown, provide `availableValues`:

```typescript
status: {
    availableValues: [
        { value: "draft",     label: "Draft" },
        { value: "review",    label: "In review" },
        { value: "published", label: "Published" },
    ],
},
```

Drizzle `pgEnum` columns auto-detect and don't need this.

## `description` — inline help text

Long-form guidance shown below the form field:

```typescript
dailySendHour: {
    description: "⏰ DAILY broadcast: hour of day in UTC (0–23). 14 = every day at 14:00 UTC. Leave blank for one-off.",
},
triggerOnCsvImport: {
    description: "🛒 IMPORT: auto-send to users whose points were credited, immediately after CSV processing.",
},
```

Use emojis sparingly but do use them for **high-impact distinguishing marks** — they anchor the admin's visual scan in a form full of similar fields.

## Position — field ordering in the form

Columns render in table-declaration order by default. Override per-field:

```typescript
properties: {
    title: { position: 1 },
    body:  { position: 2 },
    tags:  { position: 3 },
},
```

Positions are sparse; any fields without `position` fill in after positioned ones in declaration order.

## Reference (foreign-key) properties

Auto-detected from Drizzle `.references(() => otherTable.id)`. Renders as a searchable dropdown of the referenced resource's records.

```typescript
properties: {
    userId: {
        reference: "users",   // override target resource id (rarely needed)
        description: "Owner",
    },
},
```

The list/show view shows the referenced record's **title** — AdminJS picks the first string column as the title. Override with `options.titleProperty`:

```typescript
options: {
    titleProperty: "name",   // column to display when this resource is referenced
    // ...
}
```

## Custom property components

You can inject a React component for any property/view slot:

```typescript
// in componentLoader setup
export const Components = {
    PriceDisplay: componentLoader.add("PriceDisplay", "components/price-display"),
};

// in resource options
properties: {
    price: {
        components: {
            list: Components.PriceDisplay,
            show: Components.PriceDisplay,
        },
    },
},
```

The component receives `{ record, property, resource }`. For edit slots, also accepts `onChange(propertyName, value)`. See [custom-components](custom-components.md).

## `filterProperties` — curating filters

By default every property is filterable. On a big table that's noise. Restrict:

```typescript
filterProperties: ["status", "createdAt", "authorId"],
```

Or per-property:

```typescript
properties: {
    internalNotes: { isVisible: { filter: false } },
},
```

## Conditional visibility

`isVisible` accepts a function receiving `{ record, property, resource }`:

```typescript
properties: {
    bannedReason: {
        isVisible: ({ record }) =>
            record?.params.is_banned === true || record?.params.is_banned === "true",
    },
},
```

Remember the snake_case + boolean-as-string normalization from the main SKILL.md.

## Titles, icons, translations

```typescript
options: {
    titleProperty: "name",
    // localization keys — looked up in the AdminJS locale file
    translations: {
        labels: { usersTable: "Users" },
        properties: { isBanned: "Banned?" },
    },
},
```

For multi-language admin panels, configure locales on the `AdminJS` constructor, not per-resource.

## Feature-injected virtual properties

`uploadFileFeature` adds virtual properties (`imageFile`, `imageFilePath`, `imageFilesToDelete`). They appear in lists/forms automatically. **Don't redeclare them in `properties`** — the feature manages their visibility. You only touch the underlying `key` / `mimeType` columns (usually to `HIDDEN` them).

## Full example — an articles resource

```typescript
{
    resource: { table: articlesTable, db },
    options: {
        navigation: { name: "Content", icon: "Book" },
        listProperties: ["id", "title", "posterFile", "authorId", "publishedAt", "order"],
        properties: {
            id:              READONLY,
            content:         { type: "richtext" },
            description:     { type: "textarea" },
            posterPath:      HIDDEN,
            posterMimeType:  HIDDEN,
            summary: {
                isDisabled: true,
                description: "Auto-generated from content on save. Not editable.",
            },
            authorId: {
                description: "The character who wrote this article.",
            },
            order: {
                description: "Lower appears first.",
            },
            createdAt: READONLY,
            updatedAt: READONLY,
        },
        actions: {
            list: { before: [sortByOrder] },
            new:  { after: [articleSummaryHook(db)] },
            edit: { after: [articleSummaryHook(db)] },
        },
    },
    features: [
        uploadFileFeature({
            componentLoader,
            provider: createProvider("articles"),
            properties: {
                key: "posterPath",
                file: "posterFile",
                mimeType: "posterMimeType",
            },
            uploadPath: (_r, name) => `${crypto.randomUUID()}${path.extname(name)}`,
            validation: { mimeTypes: IMAGE_MIME_TYPES },
        }),
    ],
},
```

Every pattern used here is documented above. See [templates/resources.ts](../templates/resources.ts) for a skeleton that generalizes this.
