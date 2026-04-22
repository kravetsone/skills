#!/usr/bin/env node
/**
 * Generate an AdminJS resource block from a Drizzle table name.
 *
 * Run from project root (node_modules/ must have drizzle-orm AND your schema):
 *   node scripts/scaffold-resource.mjs <exportedTableName> [--navigation <GroupName>] [--schema <pathToSchema>]
 *
 * Examples:
 *   node scripts/scaffold-resource.mjs articlesTable --navigation Content
 *   node scripts/scaffold-resource.mjs feedProductsTable --navigation Feed --schema src/db/schema.ts
 *
 * What it does:
 *   - Reads `<schema>.ts` and locates the named pgTable/mysqlTable/sqliteTable export
 *   - Extracts columns, foreign keys, and notable flags (primary, notNull, enum, json)
 *   - Emits a paste-ready resource entry with:
 *       • listProperties (sensible default: 6–8 columns)
 *       • READONLY on id/created_at/updated_at
 *       • HIDDEN on columns ending in _path / _mime_type (upload-feature machinery)
 *       • type: "mixed" on json/jsonb columns
 *       • type: "textarea" on text columns longer than a threshold
 *       • navigation group from --navigation flag
 *
 * Output goes to stdout — redirect / pipe as needed.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
if (!args.length || args[0].startsWith("-")) {
    console.error("Usage: node scripts/scaffold-resource.mjs <exportedTableName> [--navigation <Name>] [--schema <path>]");
    process.exit(1);
}

const tableName = args[0];
const getFlag = (f) => {
    const i = args.indexOf(f);
    return i >= 0 ? args[i + 1] : undefined;
};

const navigation = getFlag("--navigation");
const schemaPath = getFlag("--schema") ?? "src/db/schema.ts";

const schemaFile = resolve(process.cwd(), schemaPath);
if (!existsSync(schemaFile)) {
    console.error(`✖ schema not found: ${schemaPath}`);
    console.error(`  Pass --schema <path> if it's elsewhere.`);
    process.exit(1);
}

const source = readFileSync(schemaFile, "utf8");

// ─── Locate table declaration ──────────────────────────────────────────────
// Match: export const <tableName> = pgTable("<sqlName>", { ... });
const tableRe = new RegExp(
    `export\\s+const\\s+${tableName}\\s*=\\s*(pgTable|mysqlTable|sqliteTable)\\s*\\(\\s*["']([^"']+)["']\\s*,\\s*\\{`,
);
const mHead = source.match(tableRe);
if (!mHead) {
    console.error(`✖ Could not find export const ${tableName} = ... in ${schemaPath}`);
    process.exit(1);
}

const sqlTable = mHead[2];

// Capture the column block — slice from after `{` of the second arg to matching `}`
const headIdx = mHead.index + mHead[0].length;
let depth = 1;
let i = headIdx;
while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (depth === 0) break;
    i++;
}
const columnsBlock = source.slice(headIdx, i);

// ─── Parse columns ─────────────────────────────────────────────────────────
// Each column is of shape: <jsName>: <colType>("<sqlName>"[, opts])<chain>,
const columnRe = /(\w+)\s*:\s*(\w+)\s*\(\s*["']([^"']+)["'](?:\s*,\s*(\{[^}]*\}|\[[^\]]*\]))?\s*\)([^,}]*)/g;

const columns = [];
let cm;
while ((cm = columnRe.exec(columnsBlock))) {
    const [, jsName, colType, sqlName, opts, chain] = cm;
    columns.push({
        jsName,
        colType,
        sqlName,
        opts: opts ?? "",
        chain: chain ?? "",
        isPrimary: /\.primaryKey\(\)/.test(chain),
        isNotNull: /\.notNull\(\)/.test(chain),
        hasDefault: /\.default(Now)?\(/.test(chain),
        isReference: /\.references\(/.test(chain),
        isJson: /^json(b)?$/i.test(colType),
        isText: colType === "text" || (colType === "varchar" && !/length:\s*\d+/.test(opts)),
        isTimestamp: /^(timestamp|date)$/i.test(colType),
        isBoolean: colType === "boolean",
        isEnum: /enum:\s*\[/.test(opts),
    });
}

if (!columns.length) {
    console.error(`✖ Could not parse any columns from ${tableName}. Schema structure may be non-standard.`);
    process.exit(1);
}

// ─── Compute listProperties (pick 6–8 sensible defaults) ───────────────────
const listProps = [];
const id = columns.find((c) => c.isPrimary) ?? columns[0];
listProps.push(id.jsName);

// Prefer: string fields that look like titles, references, booleans, timestamps, order
const titleLike = columns.find((c) => /^(name|title|email|username|code|slug)$/.test(c.jsName));
if (titleLike) listProps.push(titleLike.jsName);

const refs = columns.filter((c) => c.isReference && !listProps.includes(c.jsName)).slice(0, 2);
for (const r of refs) listProps.push(r.jsName);

const order = columns.find((c) => c.jsName === "order");
if (order && !listProps.includes(order.jsName)) listProps.push(order.jsName);

const boolCol = columns.find((c) => c.isBoolean && !listProps.includes(c.jsName));
if (boolCol) listProps.push(boolCol.jsName);

const createdAt = columns.find((c) => c.jsName === "createdAt" || c.sqlName === "created_at");
if (createdAt && !listProps.includes(createdAt.jsName)) listProps.push(createdAt.jsName);

// cap at 8
while (listProps.length > 8) listProps.pop();

// ─── Compute per-property overrides ────────────────────────────────────────
const propOverrides = [];
for (const c of columns) {
    if (c.isPrimary) propOverrides.push(`            ${c.jsName}: READONLY,`);
    else if (c.jsName === "createdAt" || c.jsName === "updatedAt" || c.sqlName.endsWith("_at") && c.hasDefault)
        propOverrides.push(`            ${c.jsName}: READONLY,`);
    else if (c.sqlName.endsWith("_path") || c.sqlName.endsWith("_mime_type"))
        propOverrides.push(`            ${c.jsName}: HIDDEN, // upload feature handles this`);
    else if (c.isJson)
        propOverrides.push(`            ${c.jsName}: { type: "mixed" },`);
    else if (c.isText && /(description|body|content|bio|notes?)$/i.test(c.jsName))
        propOverrides.push(`            ${c.jsName}: { type: "textarea" },`);
}

// ─── Emit ──────────────────────────────────────────────────────────────────
const navLine = navigation
    ? `\n            navigation: { name: "${navigation}" },`
    : "";

const output = `// Scaffolded from ${schemaPath} → ${tableName} (SQL: ${sqlTable})
{
    resource: { table: ${tableName}, db },
    options: {${navLine}
        listProperties: [${listProps.map((p) => `"${p}"`).join(", ")}],
        properties: {
${propOverrides.join("\n")}
        },
    },
},`;

console.log(output);
