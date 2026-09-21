// Class 3 — one-shot claim.
//
// "A user may claim this reward exactly once." The naive shape:
//
//   const existing = await db.select()...           // both find nothing
//   if (existing) return "ALREADY_CLAIMED";
//   await db.insert(articleClaims).values(...)      // both insert
//   await creditBalance(userId, reward);            // reward paid twice
//
// The window between the check and the insert is the bug. A double tap on a
// phone is enough to hit it, which is why this one reaches production so often.
//
// The fix: let the database decide, with a unique constraint and an insert
// that tolerates conflict. The insert's row count becomes the answer to "was
// this the first claim?" — a question no separate SELECT can answer honestly.
import { db } from "../db/client";
import { articleClaims } from "../db/schema";
import { creditBalance } from "./atomic-balance";

export type ClaimOutcome =
	| { kind: "claimed"; balance: number }
	| { kind: "already-claimed" };

export async function claimArticleReward(
	userId: number,
	articleId: number,
	rewardXp: number,
): Promise<ClaimOutcome> {
	return db.transaction(async (tx) => {
		const inserted = await tx
			.insert(articleClaims)
			.values({ userId, articleId })
			// The composite primary key (user_id, article_id) from schema.ts is
			// what makes this safe. onConflictDoNothing against a column set
			// with no unique constraint silently degrades to a plain insert.
			.onConflictDoNothing()
			.returning({ userId: articleClaims.userId });

		// Zero rows means someone else got there first — including our own
		// second request, milliseconds ago.
		if (inserted.length === 0) return { kind: "already-claimed" };

		const balance = await creditBalance(userId, rewardXp, tx);
		return { kind: "claimed", balance: balance ?? 0 };
	});
}

// Why the credit is inside the same transaction: if the insert commits and the
// credit fails, the user is permanently marked as having claimed a reward they
// never received, and there is no retry that can fix it — the barrier now works
// against them.
//
// Response mapping: "already-claimed" is 409, not 400. It is a state conflict,
// and the frontend wants to distinguish it from a malformed request.
//
// Test (H-###):
//   const [a, b] = await Promise.all([claim(u, 1, 2), claim(u, 1, 2)]);
//   expect([a.kind, b.kind].sort()).toEqual(["already-claimed", "claimed"]);
//   expect(await balanceOf(u)).toBe(2);   // paid once, not twice
