// Class 10 — a local write plus an external side effect.
//
// "Create the order and send the confirmation." There is no transaction that
// spans your database and someone else's HTTP API, so one of these is always
// true at the moment of failure:
//
//   send inside the transaction  -> rollback leaves a message already sent
//   send after the transaction   -> a crash in between loses the message
//
// The outbox pattern removes the choice: write the INTENT in the same
// transaction as the state change, and let a worker perform the call. The
// intent and the state change commit or roll back together; the delivery is
// at-least-once and therefore idempotent by construction.
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import { outbox } from "../db/schema";

/**
 * Record an intent. Called INSIDE the caller's transaction — that is the whole
 * mechanism, so the `tx` parameter is not optional by accident.
 */
export async function enqueueOutbox(
	tx: typeof db,
	kind: string,
	payload: unknown,
	dedupeKey?: string,
) {
	await tx
		.insert(outbox)
		.values({ kind, payload: JSON.stringify(payload), dedupeKey })
		// A dedupe key makes re-recording the same intent harmless, which
		// matters when the caller itself is a retried job.
		.onConflictDoNothing();
}

/**
 * Deliver one pending intent.
 *
 * The row is claimed with FOR UPDATE SKIP LOCKED so several workers can drain
 * the outbox in parallel; the claim and the mark-as-sent bracket the external
 * call, so a crash mid-call leaves the row claimable again.
 *
 * The external call is therefore AT-LEAST-ONCE. Whatever it does must tolerate
 * being done twice — pass an idempotency key to the provider, or use its
 * own deduplication. "It probably won't happen twice" is not a design.
 */
export async function deliverNextOutboxItem() {
	return db.transaction(async (tx) => {
		const result = await tx.execute(sql`
			select id, kind, payload, attempts from outbox
			where sent_at is null and (next_attempt_at is null or next_attempt_at <= now())
			order by id
			for update skip locked
			limit 1
		`);
		const row = result.rows?.[0] as
			| { id: number; kind: string; payload: string; attempts: number }
			| undefined;
		if (!row) return null;

		try {
			await performSideEffect(row.kind, JSON.parse(row.payload));
			await tx
				.update(outbox)
				.set({ sentAt: new Date() })
				.where(and(eq(outbox.id, row.id), isNull(outbox.sentAt)));
			return { id: row.id, ok: true };
		} catch (error) {
			// Terminal errors must not be retried: a 400 from a partner will
			// still be a 400 in ten minutes, and retrying it burns quota while
			// hiding the bug. Classify, then decide.
			const terminal = isTerminal(error);
			const attempts = row.attempts + 1;
			await tx
				.update(outbox)
				.set({
					attempts,
					lastError: String(error).slice(0, 500),
					// Exponential backoff with a cap.
					nextAttemptAt: terminal
						? null
						: new Date(Date.now() + Math.min(2 ** attempts, 3600) * 1000),
					deadLetteredAt: terminal || attempts >= 10 ? new Date() : null,
				})
				.where(eq(outbox.id, row.id));
			return { id: row.id, ok: false, terminal };
		}
	});
}

// What happens after the last attempt is a question the plan must answer per
// intent kind: dead-letter and alert, drop, or compensate. An unanswered DLQ
// policy means failures accumulate somewhere nobody looks.

declare function performSideEffect(kind: string, payload: unknown): Promise<void>;
declare function isTerminal(error: unknown): boolean;
