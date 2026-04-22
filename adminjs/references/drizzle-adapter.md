# Drizzle adapter (`adminjs-drizzle`)

`adminjs-drizzle` ships three dialect-specific subpaths: `adminjs-drizzle/pg`, `/mysql`, and `/sqlite`. Each exports `{ Database, Resource }`. You register **one** adapter per project — the one matching your database dialect.

## Registration

```typescript
import AdminJS from "adminjs";
import * as PgAdapter from "adminjs-drizzle/pg";
// import * as MysqlAdapter from "adminjs-drizzle/mysql";
// import * as SqliteAdapter from "adminjs-drizzle/sqlite";

AdminJS.registerAdapter(PgAdapter); // { Database, Resource }
```

Wildcard-import the adapter module and pass it whole. Passing `{ Database: PgAdapter.Database, Resource: PgAdapter.Resource }` also works but adds no value.

## Two ways to declare resources

### Explicit per-resource (recommended)

```typescript
new AdminJS({
    resources: [
        { resource: { table: usersTable, db }, options: {/* per-resource config */} },
        { resource: { table: postsTable, db }, options: {} },
    ],
});
```

Pros: each resource gets its own `options`, `features`, `navigation`, etc.

### Bulk via `databases`

```typescript
new AdminJS({
    databases: [{ db, schema: { users: usersTable, posts: postsTable } }],
});
```

Pros: terse for prototypes. Cons: every table auto-becomes a resource with no per-table config, no navigation grouping, no upload features, no actions. **Do not mix** `databases` and `resources` in the same AdminJS instance — pick one.

Use `resources` for any real project.

## Type mapping (`/pg`)

From `node_modules/adminjs-drizzle/dist/pg/property.js` (verified in v0.1.2):

| Drizzle column | AdminJS `type()` | Notes |
|---|---|---|
| `serial`, `integer`, `smallint`, `bigserial` (53/64), `bigint` (53) | `number` | |
| `real`, `double precision`, `numeric`, `numericNumber` | `float` | |
| `bigint` (64-bit), `numericBigInt`, `char`, `varchar`, `text`, `interval`, `inet`, `cidr`, `macaddr`, `macaddr8`, `line`, `point`, `time`, `enum` | `string` | **64-bit bigints are serialized as strings** — the adapter uses `.toString()` on read and `BigInt(value)` on write. |
| `boolean` | `boolean` | |
| `json`, `jsonb` | `textarea` ⚠️ | See "JSON columns" below. |
| `date`, `dateString` | `date` | |
| `timestamp` | `datetime` | |
| `uuid` | `uuid` | |
| Column with a foreign key | `reference` | Auto-detected from `getTableConfig(table).foreignKeys`. |
| `text` / `varchar` / `char` with `enum: [...]` | Enum — `availableValues()` returns the enum values. | |
| `pgEnum()` | Enum. | |

**Unhandled types** (vectors, geometry, binaryVector, sparseVector) log `Unhandled type: <sqlType>` to stdout and fall through to `undefined`. If your schema uses these, override via `properties.<col>.type` in the resource options.

## Property defaults

From `property.js`:

- `isEditable()` returns `false` for the primary key — `id` is always read-only in forms. You cannot override this.
- `isRequired()` reflects `column.notNull`.
- `isSortable()` returns `false` for reference-typed columns (foreign keys). List sort falls back to `id`.

## `params` shape — the critical trap

The adapter's `prepareResult` (runs on read, `node_modules/adminjs-drizzle/dist/pg/resource.js`) builds `record.params` from the Drizzle row — keyed by **column path** (the JS property name on the table, not the SQL column name).

So if your schema is:

```typescript
export const usersTable = pgTable("users", {
    id: serial("id").primaryKey(),
    isBanned: boolean("is_banned").default(false),
    createdAt: timestamp("created_at").defaultNow(),
});
```

Inside a form / list context, `record.params.isBanned` and `record.params.createdAt` are camelCase (JS property names). **Inside a custom action handler**, AdminJS sometimes delivers the **SQL column name** (snake_case) because the action controller reads the raw row through a different code path. The user's reference project hit this in every custom action:

```typescript
// Inside action handler — check BOTH keys and BOTH shapes
const isStarted =
    record.params.is_started === true ||
    record.params.is_started === "true" ||
    record.params.isStarted === true ||
    record.params.isStarted === "true";
```

The "boolean as string" half is because adminjs-drizzle's `prepareResult` doesn't coerce booleans, but AdminJS's record serialization (`record.toJSON()`) runs values through `flat.flatten` + JSON — round-tripping a boolean through the UI's query-string filter machinery can yield the string form.

**Rule of thumb:** when reading a typed field from `record.params` in an action handler or `isAccessible` callback, normalize:

```typescript
// Booleans
const flag = record.params.is_flag === true || record.params.is_flag === "true";

// Numbers
const id = Number(record.params.id);

// Dates
const ts = record.params.created_at ? new Date(record.params.created_at) : null;
```

Inside `.tsx` custom components, `record.params.<camelCase>` normally works — the component receives the same `record.toJSON()` shape that the form rendered from.

## JSON / JSONB columns

Default type is `textarea` — the adapter JSON-stringifies on read and `JSON.parse`s on write. Problems:

1. The textarea shows `{"a":1}` and expects the user to hand-edit valid JSON; any typo (`{a:1}`) throws on save and the update is lost.
2. Deeply nested objects are unreadable.
3. `undefined` / `null` distinction is lost.

**Always override JSON columns to `type: "mixed"`**:

```typescript
properties: {
    healthFeatures: { type: "mixed" },
    metadata: { type: "mixed" },
},
```

`"mixed"` renders each top-level key as its own subfield. For complex nested structures, build a custom edit component instead:

```typescript
properties: {
    config: {
        type: "mixed",
        components: {
            edit: Components.ConfigEditor, // a custom Monaco-wrapped editor, for example
        },
    },
},
```

## bigint columns (64-bit)

Both `bigInt("col", { mode: "bigint" })` and `numeric` columns with large values come out as **strings**. In forms: no action needed — the field displays and edits fine. In programmatic `findOne` / `find` results: use `BigInt(row.col)` to parse back.

Writes accept either `"123"` or `123n`; the adapter coerces via `BigInt(value)`.

## Foreign-key auto-references

The adapter walks `getTableConfig(table).foreignKeys` and sets `reference` to the referenced table's name (SQL name via `getTableConfig(foreignTable).name`) for any FK column. This means:

```typescript
export const petsTable = pgTable("pets", {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => usersTable.id),
});
```

`userId` renders as a dropdown of users. No extra config. The reference target is the **SQL table name** — in AdminJS that's also the resource `id`, so everything lines up as long as both tables are registered as resources.

### Caveats

- Only the first FK on a column is picked up — if a column references two tables (very unusual), the second is ignored.
- Composite foreign keys are not supported by this version.
- If the FK target isn't registered as an AdminJS resource, the dropdown is empty and the field becomes an editable text input.

## Pagination, sort, filter

The adapter's `find(filter, { limit, offset, sort })`:

- `sort.sortBy` is the **JS property name**; the adapter looks it up on `this.table[sortBy]` — meaning you sort by camelCase, not by SQL column. If you pass a snake_case key, you'll get `undefined` and `orderBy(undefined)` blows up.
- `limit` defaults to 10, `offset` to 0.
- Filter conversion lives in `node_modules/adminjs-drizzle/dist/utils/convert-filter.js` — supports equality, ranges (`from`/`to` pattern used by AdminJS), and wildcards on text columns via `ilike`.

## Forcing default sort

AdminJS doesn't expose a per-resource default sort. Use a `before` hook on the `list` action:

```typescript
function sortByOrder(request: ActionRequest) {
    if (!request.query?.sortBy) {
        request.query = { ...request.query, sortBy: "order", direction: "asc" };
    }
    return request;
}

// ...
options: {
    actions: { list: { before: [sortByOrder] } },
},
```

Fallback: if you hit the "undefined sortBy" crash on first page load, the hook hasn't run yet — make sure it's registered before first access.

## `/mysql` and `/sqlite` differences

- `/mysql` uses `MysqlDatabase` + `MysqlTable`; type set is smaller (no JSON-distinct, no uuid native — store uuid as `char(36)`).
- `/sqlite` uses `BaseSQLiteDatabase` + `SQLiteTable`; booleans map from `integer` (0/1) — the adapter coerces. Timestamps are `integer` (`unix` or `millis`); the adapter returns `Date` for `timestamp` columns.

Everything else (registration, resource config, references) is identical across dialects.

## Known quirks / limits

- **No live drizzle `relations()` support.** The adapter ignores `relations(posts, ({ one }) => ({ author: one(authors, ...) }))`. Use FK declarations (`references(() => authorsTable.id)`) — that's what gets auto-detected.
- **No polymorphic associations.** Model them as two separate FK columns + a discriminator, then toggle visibility via `isVisible: ({ record }) => record.params.kind === "X"`.
- **No computed columns.** A Drizzle `$default()` value shows up as required in the form unless you also set `default(...)` at the column level.
- **No soft delete.** Write a `before` hook on the `delete` action that redirects to `update({ deletedAt: new Date() })`.

## Verifying the adapter on upgrade

After `drizzle-orm` or `adminjs-drizzle` version bumps, re-check:

```bash
cat node_modules/adminjs-drizzle/dist/pg/property.js | grep -E 'column instanceof|return '
cat node_modules/adminjs-drizzle/dist/pg/resource.js | grep -A 5 prepareResult
```

If the list of `column instanceof` branches changed, the type-mapping table above is stale.
