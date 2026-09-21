// Class 2 — claiming one item from a limited pool.
//
// Promo codes, seats, slots, vouchers. The naive shape is:
//
//   const code = await db.select().from(promoCodes)
//     .where(isNull(promoCodes.userId)).limit(1);   // both requests see code #7
//   await db.update(promoCodes).set({ userId })
//     .where(eq(promoCodes.id, code.id));           // both assign #7
//
// Two users walk away with the same code, and the second write silently
// overwrites the first owner.
//
// The fix has two halves: `FOR UPDATE SKIP LOCKED` so concurrent claimers pick
// DIFFERENT rows instead of queueing on the same one, and the assignment
// predicate `user_id IS NULL` so a stale pick cannot win.
import { sql } from "drizzle-orm";
import { db } from "../db/client";

export type ClaimResult = { id: number; code: string } | null;

/**
 * Claim one unclaimed code for a box. Returns null when the pool is empty.
 *
 * SKIP LOCKED is what makes this scale: without it, fifty concurrent claimers
 * all block on the same first row and the endpoint serialises. With it, each
 * claimer walks past rows another transaction is holding and takes the next
 * free one, so throughput is bounded by the pool rather than by contention.
 *
 * `AND user_id IS NULL` in the outer UPDATE is not redundant with the row lock:
 * it is what makes the statement safe to run outside this exact sequence, and
 * it costs nothing.
 */
export async function claimCode(
	boxId: number,
	userId: number,
	tx = db,
): Promise<ClaimResult> {
	const result = await tx.execute(sql`
		update promo_codes
		set user_id = ${userId}, claimed_at = now()
		where id = (
			select id from promo_codes
			where box_id = ${boxId} and user_id is null
			order by id
			for update skip locked
			limit 1
		)
		and user_id is null
		returning id, code
	`);

	const row = result.rows?.[0] as { id: number; code: string } | undefined;
	return row ?? null;
}

/**
 * Availability is DERIVED, never stored.
 *
 * A stored `available` counter is a second source of truth, and keeping it in
 * step with the pool is itself a Class-1 race. Counting is cheap with the
 * partial index from schema.ts; being wrong is not.
 */
export async function availableCount(boxId: number, tx = db): Promise<number> {
	const result = await tx.execute(sql`
		select count(*)::int as n from promo_codes
		where box_id = ${boxId} and user_id is null
	`);
	return (result.rows?.[0] as { n: number } | undefined)?.n ?? 0;
}

// The composed operation — claim a code AND debit the balance — belongs in one
// transaction, in this order:
//
//   await db.transaction(async (tx) => {
//     const code = await claimCode(boxId, userId, tx);
//     if (!code) return { kind: "out-of-stock" };
//     const balance = await debitBalance(userId, price, tx);
//     if (balance === null) { tx.rollback(); return { kind: "insufficient" }; }
//     return { kind: "ok", code: code.code, balance };
//   });
//
// Claim first, then debit: a rollback returns the code to the pool, whereas a
// code handed out against a failed debit is gone for good.
//
// Test (H-###): N concurrent purchases against a pool of M < N —
// expect exactly M successes and no duplicate codes.
