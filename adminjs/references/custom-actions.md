# Custom actions

AdminJS actions are the extension point for everything beyond CRUD — exports, imports, state transitions, mass operations, integrations. This file covers the three action types, their handler contract, `before` / `after` hooks, and how to trigger an action from inside a custom React component.

## Three action types

| `actionType` | Scope | Where it shows up |
|---|---|---|
| `"resource"` | Table-wide | In the top-right action bar of the list view |
| `"record"` | Single row | In the row's `...` menu + on the show page |
| `"bulk"` | Selected rows | Appears after the user ticks checkboxes in the list |

Default built-in actions: `list`, `show`, `new`, `edit`, `delete`, `bulkDelete`. You can **override** these by declaring them under `options.actions` — same key, extended config.

## Record action skeleton

```typescript
{
    actionType: "record",
    icon: "Send",                              // Feather icon name
    guard: "Are you sure you want to send this broadcast?", // confirmation dialog
    isAccessible: ({ record, currentAdmin }) => boolean,    // visible-per-record logic
    component: Components.SomeModal,           // optional — opens a custom React view
    handler: async (request, response, context) => {
        // context.record, context.currentAdmin, context.resource, context._admin, context.h
        // ...side effects...
        return {
            record: context.record.toJSON(context.currentAdmin),
            notice: { message: "OK", type: "success" as const },
            redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
        };
    },
}
```

## Handler return shape

A record-action handler **MUST** return an object containing `record`. Missing `record` crashes the frontend with `Cannot read properties of undefined (reading 'id')`.

```typescript
return {
    record: context.record.toJSON(context.currentAdmin),  // required
    notice?: {                                             // optional toast
        message: string,
        type: "success" | "error" | "info",
    },
    redirectUrl?: string,                                  // optional redirect
};
```

The frontend re-renders the record with the returned `record`, then navigates if `redirectUrl` is set, then toasts `notice`.

For `resource` actions, return `{ records: BaseRecord[] }` instead of `record`.
For `bulk` actions, same — return `records`.

## Example: "send broadcast" record action

Pulled from production. Uses `isAccessible` to hide the button once sent, `guard` for confirmation, and `notice` for feedback:

```typescript
actions: {
    send: {
        actionType: "record",
        icon: "Send",
        guard: "Are you sure you want to send this broadcast?",
        isAccessible: ({ record }: { record: { params: Record<string, unknown> } }) => {
            const isStarted =
                record.params.is_started === true ||
                record.params.is_started === "true";
            const isRecurring =
                record.params.daily_send_hour != null ||
                record.params.trigger_on_event === true ||
                record.params.trigger_on_event === "true";
            // Recurring: allow manual re-send (resets after each run)
            if (isRecurring) return !isStarted;
            // One-time: hide once sent
            return !isStarted && !record.params.sent_at;
        },
        handler: async (_req, _res, context) => {
            try {
                await sendBroadcast(Number(context.record.params.id));
                return {
                    record: context.record.toJSON(context.currentAdmin),
                    notice: { message: "Broadcast started", type: "success" as const },
                };
            } catch (error) {
                return {
                    record: context.record.toJSON(context.currentAdmin),
                    notice: {
                        message: error instanceof Error ? error.message : "Unknown error",
                        type: "error" as const,
                    },
                };
            }
        },
    },
},
```

Key points:

- **`isAccessible` uses raw `record.params` with snake_case keys** — that's the snake_case quirk from [drizzle-adapter](drizzle-adapter.md). Always normalize booleans as `x === true || x === "true"`.
- **The try/catch is mandatory** — an unhandled throw in a record handler leaves the UI spinning with no feedback. Catch everything and translate to a `notice.error`.
- **`Number(context.record.params.id)`** — ids arrive as strings in action handlers; coerce.

## Example: CSV upload via a custom component + record action

Two parts working together — a custom React component that renders the UI and POSTs to the action endpoint, and a record action that handles the POST.

### The action

```typescript
uploadCodes: {
    actionType: "record",
    icon: "Upload",
    component: Components.PromoUpload,  // custom React view
    handler: async (request, _response, context) => {
        if (request.method !== "post") {
            return { record: context.record.toJSON(context.currentAdmin) };
        }
        const csvText = (request.payload as { csvText?: string })?.csvText?.trim();
        if (!csvText) {
            return {
                record: context.record.toJSON(context.currentAdmin),
                notice: { message: "CSV is empty", type: "error" as const },
            };
        }
        const codes = csvText.split(/\r?\n/).map(c => c.trim()).filter(Boolean);
        const itemId = Number(context.record.params.id);
        await db.insert(codesTable)
            .values(codes.map(code => ({ itemId, code })))
            .onConflictDoNothing({ target: codesTable.code });
        return {
            record: context.record.toJSON(context.currentAdmin),
            notice: { message: `Uploaded ${codes.length} codes`, type: "success" as const },
        };
    },
},
```

### The React component

```tsx
// src/admin/promo-upload.tsx
import { Box, Button, H5, MessageBox } from "@adminjs/design-system";
import { useState } from "react";

export default function PromoUpload({ record, resource }: {
    record: { id: string | number; params: Record<string, unknown> };
    resource: { id: string };
}) {
    const [csvText, setCsvText] = useState("");
    const [notice, setNotice] = useState<{ type: "success" | "danger"; message: string } | null>(null);

    async function submit() {
        const res = await fetch(
            `/admin/api/resources/${resource.id}/records/${record.id}/uploadCodes`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ csvText }),
            },
        );
        const data = await res.json();
        setNotice({
            type: res.ok ? "success" : "danger",
            message: data.notice?.message ?? (res.ok ? "Done" : "Failed"),
        });
    }

    return (
        <Box padding="xl">
            <H5>Upload codes</H5>
            <textarea value={csvText} onChange={e => setCsvText(e.target.value)} />
            <Button onClick={submit} variant="primary">Upload</Button>
            {notice && <MessageBox variant={notice.type} message={notice.message} />}
        </Box>
    );
}
```

### The action endpoint URL — the only correct form

When a record action has a custom `component`, the component is responsible for POSTing back to AdminJS. The URL template:

```
/admin/api/resources/{resourceId}/records/{recordId}/{actionName}
```

For resource actions:

```
/admin/api/resources/{resourceId}/actions/{actionName}
```

For bulk actions:

```
/admin/api/resources/{resourceId}/bulk/{actionName}?recordIds=1,2,3
```

Always send `Content-Type: application/json` — Elysia parses it into `request.payload` on the handler side. **Do not** use `multipart/form-data` for non-file payloads — it works, but the payload shape differs.

## `before` hooks — mutating the request

Run before the core action logic:

```typescript
function sortByOrder(request: ActionRequest) {
    if (!request.query?.sortBy) {
        request.query = { ...request.query, sortBy: "order", direction: "asc" };
    }
    return request;
}

options: {
    actions: { list: { before: [sortByOrder] } },
},
```

Signature: `(request: ActionRequest, context: ActionContext) => ActionRequest | Promise<ActionRequest>`.

Use for: forcing sort, injecting default filters, audit logging, rate limiting per user.

## `after` hooks — mutating the response

Run after the core logic, before the response is serialized:

```typescript
function articleSummaryHook(db: PostgresJsDatabase) {
    return async (response: ActionResponse, request: ActionRequest) => {
        if (request.method !== "post") return response;
        const { record } = response;
        if (record?.params?.content) {
            const plainText = stripHtml(record.params.content);
            const summary = await generateArticleSummary(plainText);
            await db.update(articlesTable)
                .set({ summary })
                .where(eq(articlesTable.id, record.params.id));
            record.params.summary = summary;
        }
        return response;
    };
}

options: {
    actions: {
        new:  { after: [articleSummaryHook(db)] },
        edit: { after: [articleSummaryHook(db)] },
    },
},
```

Signature: `(response: ActionResponse, request: ActionRequest, context: ActionContext) => ActionResponse | Promise<ActionResponse>`.

Use for: auto-computed fields (summaries, slugs, embeddings), cache invalidation, webhook fan-out, side-effects that should run after CRUD succeeds.

**Factory pattern (`articleSummaryHook(db)`)** lets you close over dependencies — much cleaner than declaring a named function in module scope.

## `guard` — confirmation dialogs

```typescript
{ guard: "This will permanently delete all related records. Continue?" }
```

Shown as a browser `confirm()` before the handler runs. For `isAccessible` + `guard` combo: `isAccessible` hides the button when not applicable, `guard` warns when it is. Don't use `guard` alone for destructive operations that are always visible — users get desensitized.

## `isAccessible` — conditional visibility

```typescript
isAccessible: ({ record, currentAdmin }) => {
    // Hide based on record state
    if (record?.params.status === "archived") return false;
    // Hide based on current user role
    if (!currentAdmin?.permissions?.includes("broadcasts:send")) return false;
    return true;
},
```

Returns boolean (or Promise<boolean>). Runs for every record on every list-page render — keep it cheap, no DB queries.

For row-level RBAC combined with coarse-grained gating, use both `isAccessible` (hide UI) and check again in `handler` (enforce on POST) — UI-only checks can be bypassed by anyone who knows the action URL.

## `icon` — Feather icons only

The icon name must exist in Feather (`Send`, `Upload`, `Download`, `Copy`, `Edit`, `Trash`, `Eye`, `Play`, `Pause`, `Archive`, `Star`, `Lock`, `Unlock`, etc.). Bad names silently render as a question mark. Consult https://feathericons.com/.

## Overriding built-in actions

```typescript
options: {
    actions: {
        delete: {
            isAccessible: ({ currentAdmin }) =>
                currentAdmin?.role === "admin",
            before: [auditHook("delete")],
        },
        new: {
            before: [stampWithCurrentUser],
        },
    },
},
```

You can add hooks to built-ins without replacing their handler.

## The `buildFeature()` helper — reusable feature factories

When a hook/action pattern recurs across resources, package it as a **feature** using `buildFeature()` from `adminjs`. This is the idiomatic way every official `@adminjs/*` feature is built (see [official-features](official-features.md)).

```typescript
import { buildFeature, type FeatureType } from "adminjs";

export function auditTrailFeature(tableName: string): FeatureType {
    return buildFeature({
        actions: {
            new: {
                before: [stampTimestamps],
                after:  [writeAuditRow(tableName, "created")],
            },
            edit: {
                before: [stampTimestamps],
                after:  [writeAuditRow(tableName, "updated")],
            },
            delete: {
                after: [writeAuditRow(tableName, "deleted")],
            },
        },
        properties: {
            createdAt: { isDisabled: true },
            updatedAt: { isDisabled: true },
        },
    });
}
```

Then attach it like any other feature:

```typescript
{
    resource: { table: articlesTable, db },
    options: { /* ... */ },
    features: [
        auditTrailFeature("articles"),
        uploadFileFeature({ /* ... */ }),
    ],
},
```

### When to reach for `buildFeature`

- **Two or more resources** need the same hook/action pattern. A feature removes the copy-paste.
- You're writing a library for others to consume — features are the package-boundary API.
- You want `properties` overrides + `actions` overrides bundled together (feature = resource-option delta).

For a one-off hook on a single resource, inline the hook in `actions.<action>.after` directly — don't over-engineer.

### What `buildFeature` accepts

```typescript
type BuildFeature = (opts: {
    properties?: Record<string, PropertyOptions>,
    actions?: Record<string, ActionOptions>,
    navigation?: NavigationOptions | null,
    listProperties?: string[],
    showProperties?: string[],
    editProperties?: string[],
    filterProperties?: string[],
}) => FeatureType;
```

AdminJS merges the feature's options into the resource's options at runtime. Features registered later in the array win when there's a conflict on the same key. **Hooks accumulate** (all `before` / `after` arrays concatenate) — they don't replace each other.

## Recipes

### Soft delete

```typescript
options: {
    actions: {
        delete: {
            handler: async (_req, _res, context) => {
                const id = Number(context.record.params.id);
                await db.update(itemsTable)
                    .set({ deletedAt: new Date() })
                    .where(eq(itemsTable.id, id));
                return {
                    record: context.record.toJSON(context.currentAdmin),
                    redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
                };
            },
        },
    },
},
```

Combine with a `before` hook on `list` that filters out `deletedAt IS NOT NULL` via `request.query.filters`.

### Export to CSV (resource action)

```typescript
exportCsv: {
    actionType: "resource",
    icon: "Download",
    handler: async (request, _response, context) => {
        const rows = await db.select().from(itemsTable);
        const csv = [
            "id,name,price",
            ...rows.map(r => `${r.id},${JSON.stringify(r.name)},${r.price}`),
        ].join("\n");
        return {
            records: [],                                    // required shape
            notice: { message: "Export ready", type: "success" as const },
            redirectUrl: `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`,
        };
    },
},
```

For larger exports, write to disk / S3 and redirect to a presigned URL.

### "Open in Telegram / external" action with a component

```typescript
test: {
    actionType: "record",
    icon: "View",
    component: Components.BroadcastTest,
    handler: async (_req, _res, context) => {
        const id = context.record.params.id;
        const username = bot.info?.username;
        context.record.params.broadcastTestUrl =
            `https://t.me/${username}?start=broadcast_${id}`;
        return { record: context.record.toJSON(context.currentAdmin) };
    },
},
```

```tsx
// broadcast-test.tsx
import { useEffect } from "react";
export default function BroadcastTest({ record }: { record: { params: { broadcastTestUrl: string } } }) {
    const url = record.params.broadcastTestUrl;
    useEffect(() => { if (url) window.open(url, "_blank"); }, [url]);
    return null;
}
```

The handler injects the URL into `record.params` (a transient/virtual field); the component opens it in a new tab on mount. No real DB state changes.

## Error messages — bubble them properly

Never `throw` inside a handler — the UI gets a spinner that never resolves. Wrap every handler body in try/catch and return `{ record: ..., notice: { type: "error", message } }`. The user's reference project does this on every custom handler — borrow the pattern.
