// Class 7 — external event delivered more than once.
//
// Every payment provider, every messaging platform, retries. They retry on a
// timeout even when you succeeded, because from their side a slow 200 and a
// lost 200 look identical. So "the provider will only call us once" is never
// true, and a webhook handler that credits an account directly will eventually
// credit it twice.
//
// The inbox pattern separates RECEIVING from PROCESSING:
//
//   1. store the raw payload, keyed by the provider's own event id
//   2. acknowledge immediately
//   3. process by id, exactly once, with the unique constraint as the barrier
//
// It also gives you the payload of any event you mishandled, which is the
// difference between fixing a bug and asking the provider to resend a week
// of history.
import { and, eq, isNull, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../db/client";
import { webhookInbox } from "../db/schema";
import { verifyWebhookSecret } from "../lib/auth-plugin";

export const webhookRoutes = new Elysia({ prefix: "/webhooks" }).post(
	// A fixed path. Never `/webhooks/:secret` — paths are logged everywhere,
	// and a credential in one ends up in nginx, the ingress, the APM and the
	// trace, each with its own retention policy.
	"/payments",
	async ({ body, headers, status }) => {
		if (!verifyWebhookSecret(headers["x-webhook-secret"])) return status(403, "FORBIDDEN");

		const inserted = await db
			.insert(webhookInbox)
			.values({
				source: "payments",
				externalId: body.id,
				payload: JSON.stringify(body),
			})
			.onConflictDoNothing()
			.returning({ id: webhookInbox.id });

		// A duplicate delivery is a success, not an error. Returning 409 here
		// makes the provider retry harder and eventually disable the webhook.
		if (inserted.length === 0) return { status: "duplicate" };

		// Hand off to a job. Do the work outside the request so a slow
		// processing step cannot cause the provider to time out and retry —
		// which would be the very duplicate we are guarding against.
		await enqueueProcessInboxItem(inserted[0].id);
		return { status: "accepted" };
	},
	{
		body: t.Object({ id: t.String(), type: t.String() }, { additionalProperties: true }),
		headers: t.Object({ "x-webhook-secret": t.String() }),
		response: {
			200: t.Object({ status: t.Union([t.Literal("accepted"), t.Literal("duplicate")]) }),
			403: t.Literal("FORBIDDEN"),
		},
	},
);

// Note on `additionalProperties: true` above: it is correct HERE and almost
// nowhere else. We are storing a third party's payload verbatim and must not
// drop fields we do not yet know about. The rule it looks like it violates is
// about accepting unvalidated fields from OUR clients into OUR writes — and
// nothing here is written anywhere except as an opaque blob.

/**
 * The processing side. Claims a row, processes it, marks it done — in one
 * transaction, so a crash mid-processing rolls back to unprocessed rather than
 * leaving a row that is neither done nor retryable.
 *
 * FOR UPDATE SKIP LOCKED lets several workers drain the inbox in parallel
 * without ever handing the same row to two of them.
 */
export async function processNextInboxItem() {
	return db.transaction(async (tx) => {
		const result = await tx.execute(sql`
			select id, payload from webhook_inbox
			where source = 'payments' and processed_at is null
			order by received_at
			for update skip locked
			limit 1
		`);
		const row = result.rows?.[0] as { id: number; payload: string } | undefined;
		if (!row) return null;

		await applyPaymentEvent(JSON.parse(row.payload), tx);

		await tx
			.update(webhookInbox)
			.set({ processedAt: new Date() })
			.where(and(eq(webhookInbox.id, row.id), isNull(webhookInbox.processedAt)));

		return row.id;
	});
}

declare function enqueueProcessInboxItem(id: number): Promise<void>;
declare function applyPaymentEvent(payload: unknown, tx: unknown): Promise<void>;
