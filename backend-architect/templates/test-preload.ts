// bun test preload. Referenced from bunfig.toml:
//
//   [test]
//   preload = ["./src/test/preload.ts"]
//
// Two jobs, both about ordering.
//
// 1. `config.ts` reads process.env at import time, so the environment has to
//    exist before anything imports it. Get this wrong and the symptom is a
//    confusing "required variable missing" in an unrelated test file.
//
// 2. Tests run against a real Postgres (PGlite, in-process) with the real
//    migrations. Mocking the database means testing the mock — and the entire
//    point of a concurrency test is that it exercises actual SQL semantics,
//    which a mock does not have.
import { PGlite } from "@electric-sql/pglite";
import { mock } from "bun:test";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../db/schema";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgres://test/test";
process.env.BOT_TOKEN = "test-bot-token";
process.env.WEBHOOK_SECRET = "test-webhook-secret";
process.env.FRONTEND_URL = "http://localhost:5173";
// memory is correct here and only here: one process, no replicas. Production
// is prevented from using it by the assertion in config.ts.
process.env.LOCK_STORE = "memory";

const client = new PGlite();
export const db = drizzle(client, { schema });

await migrate(db, { migrationsFolder: "./src/db/migrations" });

// Hand every importer of `db/client` the PGlite instance.
mock.module("../db/client", () => ({ db, client }));

/**
 * Truncate between tests. Faster than re-migrating, and restarting identity
 * sequences keeps ids predictable in assertions.
 */
export async function resetDb() {
	const names = Object.values(schema)
		.map((value) => (value as { _?: { name?: string } })?._?.name)
		.filter((name): name is string => typeof name === "string")
		.map((name) => '"' + name + '"');
	if (names.length)
		await client.exec("TRUNCATE " + names.join(", ") + " RESTART IDENTITY CASCADE;");
}
