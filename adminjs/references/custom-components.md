# Custom React components

Anywhere AdminJS renders UI — dashboard, action modals, property edit/show/list slots, login page — you can swap in a custom React component. This file covers `ComponentLoader` mechanics, path resolution, the `@adminjs/design-system` primitives, and the three patterns you'll use 95% of the time.

## Registration via `ComponentLoader`

```typescript
import { ComponentLoader } from "adminjs";

const componentLoader = new ComponentLoader();

export const Components = {
    Dashboard:     componentLoader.add("Dashboard", "dashboard"),
    PromoUpload:   componentLoader.add("PromoUpload", "promo-upload"),
    BroadcastTest: componentLoader.add("BroadcastTest", "broadcast-test"),
};
```

`componentLoader.add(name, path)` returns a **component id string** (not the component itself). You reference the id everywhere AdminJS expects a component: `dashboard: { component: Components.Dashboard }`, `action.component: Components.PromoUpload`, `property.components: { edit: Components.MyEditor }`, etc.

### Path resolution — the silent foot-gun

The second argument to `componentLoader.add()` is resolved **relative to process CWD**, not relative to the caller file. If you run `bun src/index.ts` from the project root, a path like `"./admin/dashboard"` works. From anywhere else, it doesn't.

**Recommended pattern** — always absolute, never CWD-dependent:

```typescript
import path from "node:path";

componentLoader.add("Dashboard", path.join(import.meta.dir, "dashboard"));
//                                        ^^^^^^^^^^^^^^^ — Bun/ESM
//                                        __dirname         — CommonJS
```

With `import.meta.dir` (Bun) or `import.meta.dirname` (Node 20.11+), you resolve against the file that **called** `componentLoader.add`, so the path works regardless of CWD.

If you stick with bare string paths (`"dashboard"`), keep all component TSX files in the same dir as `index.ts` where you set up the loader, and always launch from the project root.

### The `.tsx` file layout

```typescript
// src/admin/dashboard.tsx
const Dashboard = () => {
    return <div>Hi</div>;
};

export default Dashboard;
```

Rules:

- **Always `export default`** — AdminJS's bundler expects a default export.
- **No named exports** — they're discarded.
- The file extension is `.tsx`.
- AdminJS bundles through its own Rollup/esbuild pipeline; **don't import from outside the component tree** (no imports of server-side modules like `drizzle-orm`). Anything you import is bundled into the browser bundle. Keep server code out.

## `.adminjs/` folder — the compiled bundle

`admin.initialize()` compiles all registered custom components into `.adminjs/bundle.js`. `admin.watch()` re-bundles on change (dev). The folder structure:

```
.adminjs/
├── entry.js      // generated import manifest
└── bundle.js     // compiled browser bundle
```

- **Add `.adminjs/` to `.gitignore` in dev** — it regenerates.
- **In production**, either commit the compiled bundle (fast cold-start) or run the app once during image build to pre-compile (see [setup-and-bundling](setup-and-bundling.md)).

## React 18 only

AdminJS is pinned to React 18. React 19 causes silent runtime crashes in the admin bundle ("Invalid hook call"). Pin in `package.json`:

```json
{
    "dependencies": {
        "react": "18",
        "react-dom": "18"
    },
    "devDependencies": {
        "@types/react": "18"
    }
}
```

And avoid React 19 APIs (`use()`, new hooks, server components) in admin components.

## `@adminjs/design-system` — the primitives

Import from `@adminjs/design-system`:

```typescript
import {
    // layout
    Box, Section, Card,
    // typography
    H1, H2, H3, H4, H5, H6, Text, Label, Paragraph,
    // form
    Input, TextArea, Select, Checkbox, DatePicker, Button, Icon,
    // feedback
    MessageBox, Badge, Loader, Placeholder,
    // data
    Table, TableHead, TableBody, TableRow, TableCell,
    // navigation
    Link, Navigation,
} from "@adminjs/design-system";
```

Props follow `styled-system`: `p`, `m`, `mt`, `mb`, `px`, `py`, `padding`, `flex`, `width`, `bg`, `color`, `fontSize`, etc., with theme-scale values (`"xs"`, `"sm"`, `"default"`, `"lg"`, `"xl"`).

```tsx
<Box padding="xl" flex flexDirection="column">
    <H5>Title</H5>
    <Button variant="primary" size="lg">Action</Button>
</Box>
```

Variants on `Button`: `primary`, `secondary`, `danger`, `success`, `info`, `light`, `text`.
Variants on `MessageBox`: `success`, `danger`, `info`.

## Pattern 1 — Dashboard redirect

Skip the empty-state dashboard, jump straight to a chosen resource:

```tsx
// src/admin/dashboard.tsx
import { useEffect } from "react";
import { useNavigate } from "react-router";

const Dashboard = () => {
    const navigate = useNavigate();
    useEffect(() => {
        navigate("/admin/resources/users");
    }, [navigate]);
    return null;
};

export default Dashboard;
```

Register:

```typescript
const admin = new AdminJS({
    // ...
    dashboard: { component: componentLoader.add("Dashboard", "dashboard") },
});
```

## Pattern 2 — Action modal (POST-to-action endpoint)

A record action with `component` opens a modal page. The component is responsible for UI **and** for POSTing to the action endpoint when the user submits. AdminJS only renders the component — it doesn't auto-submit a form.

```tsx
// src/admin/promo-upload.tsx
import { Box, Button, H5, MessageBox, Text } from "@adminjs/design-system";
import { useState } from "react";

type Notice = { type: "success" | "danger"; message: string };

export default function PromoUpload({ record, resource }: {
    record: { id: string | number; params: Record<string, unknown> };
    resource: { id: string };
}) {
    const [rawText, setRawText] = useState("");
    const [fileName, setFileName] = useState("");
    const [loading, setLoading] = useState(false);
    const [notice, setNotice] = useState<Notice | null>(null);

    const codes = rawText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

    function onFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        setFileName(file.name);
        const reader = new FileReader();
        reader.onload = ev => setRawText((ev.target?.result as string) ?? "");
        reader.readAsText(file);
    }

    async function submit() {
        if (!codes.length) return;
        setLoading(true);
        setNotice(null);
        try {
            const res = await fetch(
                `/admin/api/resources/${resource.id}/records/${record.id}/uploadCodes`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ csvText: rawText }),
                },
            );
            const data = await res.json();
            setNotice({
                type: res.ok ? "success" : "danger",
                message: data.notice?.message ?? (res.ok ? "Done" : "Failed"),
            });
            if (res.ok) { setRawText(""); setFileName(""); }
        } catch (err) {
            setNotice({ type: "danger", message: String(err) });
        } finally {
            setLoading(false);
        }
    }

    return (
        <Box padding="xl">
            <H5>Upload promo codes</H5>
            <Text mt="lg">One code per line, UTF-8, no separators.</Text>
            <Box mt="xl">
                <input type="file" accept=".txt,text/plain" onChange={onFile} />
            </Box>
            {codes.length > 0 && (
                <Box mt="lg" p="lg">
                    <Text>✅ {fileName}: {codes.length} codes ready</Text>
                </Box>
            )}
            <Box mt="xl">
                <Button
                    onClick={submit}
                    disabled={codes.length === 0 || loading}
                    variant="primary"
                    size="lg"
                >
                    {loading ? "Uploading…" : `Upload ${codes.length} codes`}
                </Button>
            </Box>
            {notice && (
                <MessageBox
                    mt="xl"
                    variant={notice.type}
                    message={notice.message}
                    onCloseClick={() => setNotice(null)}
                />
            )}
        </Box>
    );
}
```

See [templates/custom-record-action.tsx](../templates/custom-record-action.tsx).

## Pattern 3 — Side-effect action (open new tab, copy to clipboard)

```tsx
// src/admin/broadcast-test.tsx
import { Box, Button, H5, Text } from "@adminjs/design-system";
import { useEffect } from "react";

export default function BroadcastTest({ record }: {
    record: { params: { broadcastTestUrl: string } };
}) {
    const url = record.params.broadcastTestUrl;

    useEffect(() => {
        if (url) window.open(url, "_blank");
    }, [url]);

    return (
        <Box>
            <H5>Test broadcast</H5>
            <Text mt="default" mb="xl">
                If the tab didn't open, click the button below.
            </Text>
            <Button as="a" href={url} target="_blank">Open in Telegram</Button>
        </Box>
    );
}
```

The handler sets `record.params.broadcastTestUrl` on a virtual property before returning — the component reads it out and opens the URL. No DB state changes.

## Pattern 4 — Property component

Replace the list/show/edit renderer for a single field:

```tsx
// src/admin/components/currency-cell.tsx
import { Text } from "@adminjs/design-system";

export default function CurrencyCell({ record, property }: {
    record: { params: Record<string, unknown> };
    property: { name: string };
}) {
    const cents = Number(record.params[property.name] ?? 0);
    return <Text fontWeight="bold">€{(cents / 100).toFixed(2)}</Text>;
}
```

```typescript
// resources.ts
import { Components } from "./index";

properties: {
    price: {
        components: {
            list: Components.CurrencyCell,
            show: Components.CurrencyCell,
        },
    },
},
```

Edit components receive `onChange(propertyName, value)`:

```tsx
export default function CurrencyEdit({ record, property, onChange }: {
    record: { params: Record<string, unknown> };
    property: { name: string };
    onChange: (name: string, value: unknown) => void;
}) {
    const euros = Number(record.params[property.name] ?? 0) / 100;
    return (
        <input
            type="number"
            step="0.01"
            defaultValue={euros}
            onBlur={e => onChange(property.name, Math.round(parseFloat(e.target.value) * 100))}
        />
    );
}
```

## Routing inside custom components

`react-router`'s `useNavigate`, `useLocation`, `useParams` all work — AdminJS wraps the admin UI in a React Router provider. Useful for breadcrumbs, back buttons, redirects.

## Accessing the current admin user

```tsx
import { useCurrentAdmin } from "adminjs";

function MyComponent() {
    const [currentAdmin] = useCurrentAdmin();
    return <div>Hello, {currentAdmin?.email}</div>;
}
```

## Accessing resource metadata

```tsx
import { useResource } from "adminjs";

function MyResourceView() {
    const { resource, records } = useResource("users");
    // ...
}
```

## Translations inside components

```tsx
import { useTranslation } from "adminjs";

function MyComponent() {
    const { translateLabel } = useTranslation();
    return <h1>{translateLabel("users")}</h1>;
}
```

## Debugging the bundle

1. Open the admin panel, check the browser Network tab for `bundle.js` — is it 404ing? CWD/path issue.
2. If `bundle.js` loads but the custom component renders as blank, check the Console — usually a React 18/19 mismatch or a missing `export default`.
3. Force a rebuild: delete `.adminjs/` and restart.
4. Under `NODE_ENV=production`, AdminJS serves a minified bundle and suppresses source maps. If a component throws, re-run in dev to get the stack.

## Don't do this

- **Don't import server-only modules** (`drizzle-orm`, `postgres`, `bun`, Node builtins) in a component — they'll be bundled into the browser and crash at load time. If you need server data, call a fetch endpoint.
- **Don't use `window` / `document` at render time unguarded** — AdminJS doesn't SSR, but some component lifecycle shenanigans still warrant `useEffect` guards.
- **Don't ship Tailwind or Emotion globals** — they conflict with design-system theming. Style with the `styled-system` props.
- **Don't call the action endpoint with `credentials: "omit"`** — the auth cookie is same-origin, so `credentials: "include"` (default for same-origin fetches) is what you want.
