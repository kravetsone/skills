// Class 5 — the client retries a non-idempotent request.
//
// A flaky mobile connection, a double tap, an automatic retry in the HTTP
// client: the request arrives twice and the second one has no way to know it
// is a repeat. For anything that creates or charges, that has to be solved at
// the protocol level, because no amount of server-side cleverness can tell a
// deliberate second purchase from a retried first one.
//
// The client sends `Idempotency-Key: <uuid>`, generated once per user INTENT
// and reused across retries. The server stores the key with the response, and
// replays it.
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { idempotencyKeys } from "../db/schema";

export type Replayed<T> = { replayed: boolean; result: T };

/**
 * Run `fn` at most once per (userId, key).
 *
 * The insert-first design is the important part. Reserving the key BEFORE
 * doing the work means a second request arriving mid-flight hits the unique
 * constraint and can be told "in progress" — whereas storing the key after the
 * work leaves exactly the window the mechanism exists to close.
 */
export async function withIdempotency<T>(
	userId: number,
	key: string,
	scope: string,
	fn: () => Promise<T>,
): Promise<Replayed<T> | { inProgress: true }> {
	const reserved = await db
		.insert(idempotencyKeys)
		.values({ userId, key, scope, status: "in_progress" })
		.onConflictDoNothing()
		.returning({ id: idempotencyKeys.id });

	if (reserved.length === 0) {
		const [existing] = await db
			.select()
			.from(idempotencyKeys)
			.where(eq(idempotencyKeys.key, key));

		// Completed: replay the stored response byte for byte. The client must
		// see the same result it would have seen, including the same ids.
		if (existing?.status === "done")
			return { replayed: true, result: JSON.parse(existing.response ?? "null") as T };

		// Still running: 409. Not an error the user caused, but the only honest
		// answer — we cannot return a result that does not exist yet, and we
		// must not start a second execution.
		return { inProgress: true };
	}

	try {
		const result = await fn();
		await db
			.update(idempotencyKeys)
			.set({ status: "done", response: JSON.stringify(result), completedAt: new Date() })
			.where(eq(idempotencyKeys.key, key));
		return { replayed: false, result };
	} catch (error) {
		// Release the key so a genuine retry can succeed. Leaving it reserved
		// would turn one transient failure into a permanently blocked intent.
		await db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, key));
		throw error;
	}
}

// Retention: these rows are only useful for as long as a client might retry.
// A taskora schedule deletes anything older than 24h — without it the table
// grows forever and eventually the unique index stops fitting in memory.
//
//   delete from idempotency_keys where created_at < now() - interval '24 hours'
//
// Scope: include it in the key's uniqueness if the same client key could
// legitimately be reused across different operations. Most clients generate a
// fresh uuid per intent, in which case scope is diagnostic only.
export const cleanupSql = sql`
	delete from idempotency_keys where created_at < now() - interval '24 hours'
`;
