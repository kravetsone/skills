// Class 1 — balance / counter mutation.
//
// The lost update, and the most common concurrency bug in this kind of product.
//
// WRONG:
//   const user = await db.select()...          // read  balance = 100
//   if (user.balance < price) return 400;      // decide
//   await db.update(users)
//     .set({ balanceXp: user.balance - price });  // write 0
//
// Two requests interleave: both read 100, both pass the check, both write 0.
// The user spent 200 and was charged 100. A lock in front of this does not fix
// it — verrou has no fencing token, so a TTL expiry mid-transaction lets a
// second writer in and the unconditional UPDATE has no way to notice.
//
// The fix is to move the decision INTO the write statement.
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { users } from "../db/schema";

/**
 * Debit a balance. Returns the new balance, or null if there was not enough.
 *
 * `UPDATE ... WHERE balance >= :amount RETURNING` — Postgres evaluates the
 * predicate and performs the write as one atomic operation against the current
 * row version. A concurrent debit either happened before ours (and our
 * predicate sees the reduced balance) or after (and sees ours). There is no
 * interleaving in between.
 *
 * Zero rows returned means "the predicate was false at write time", which is
 * the only trustworthy way to learn that.
 */
export async function debitBalance(userId: number, amount: number, tx = db) {
	const [row] = await tx
		.update(users)
		.set({ balanceXp: sql`${users.balanceXp} - ${amount}` })
		.where(and(eq(users.id, userId), gte(users.balanceXp, amount)))
		.returning({ balanceXp: users.balanceXp });

	return row?.balanceXp ?? null;
}

/**
 * Credit is unconditional — there is no upper bound to violate — but it still
 * has to be expressed as `col + n` rather than read-then-write, or two
 * concurrent credits lose one of them just as surely.
 */
export async function creditBalance(userId: number, amount: number, tx = db) {
	const [row] = await tx
		.update(users)
		.set({ balanceXp: sql`${users.balanceXp} + ${amount}` })
		.where(eq(users.id, userId))
		.returning({ balanceXp: users.balanceXp });

	return row?.balanceXp ?? null;
}

// The CHECK constraint in schema.ts is the backstop. It does not replace the
// WHERE clause — it catches the code path that forgets one, turning silent
// corruption into a failed transaction and a stack trace.
//
// Test (H-###):
//   const results = await Promise.all([debit(u, 100), debit(u, 100)]);
//   expect(results.filter(Boolean)).toHaveLength(1);   // exactly one succeeds
