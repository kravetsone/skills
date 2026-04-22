// examples/minimal.ts
// Absolute simplest working AdminJS + Elysia + Drizzle setup.
// No auth, no S3 — just a single users table.
//
// Run: bun examples/minimal.ts
// Visit: http://localhost:3000/admin

import AdminJS, { ComponentLoader } from "adminjs";
import * as PgAdapter from "adminjs-drizzle/pg";
import { buildRouter } from "adminjs-elysia";
import { drizzle } from "drizzle-orm/pglite";
import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import Elysia from "elysia";

// Schema
const usersTable = pgTable("users", {
    id: serial("id").primaryKey(),
    email: text("email").notNull().unique(),
    name: text("name"),
    createdAt: timestamp("created_at").defaultNow(),
});

// In-memory PGLite for the example
const db = drizzle({ schema: { users: usersTable } });

AdminJS.registerAdapter(PgAdapter);

const componentLoader = new ComponentLoader();

const admin = new AdminJS({
    rootPath: "/admin",
    componentLoader,
    resources: [
        {
            resource: { table: usersTable, db },
            options: {
                properties: {
                    id: { isDisabled: true },
                    createdAt: { isDisabled: true },
                },
            },
        },
    ],
});

const adminRouter = new Elysia({ detail: { hide: true } }).use(
    await buildRouter(admin, {}),
);

new Elysia()
    .use(adminRouter)
    .get("/", () => "Visit /admin")
    .listen(3000, () => console.log("→ http://localhost:3000/admin"));
