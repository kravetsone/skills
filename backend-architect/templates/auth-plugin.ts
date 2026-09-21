// Authentication as a scoped Elysia plugin — written once, never re-implemented
// per route. See references/api-design.md.
//
// The status codes are the part worth reading twice:
//   401 = who are you        (credentials absent, invalid, expired)
//   403 = I know, and no     (banned, wrong role, not the owner)
// Returning 401 for a banned user tells the client to drop the session, so the
// user is silently logged out instead of being told they are banned.
import { validate, parse } from "@telegram-apps/init-data-node";
import { Elysia, t } from "elysia";
import crypto from "node:crypto";
import { config } from "../config";
import { getOrCreateUser } from "../services/users";

export const authElysia = new Elysia({ name: "auth" })
	.guard({
		headers: t.Object({ "x-init-data": t.String() }),
		response: {
			401: t.Literal("UNAUTHORIZED"),
			403: t.Literal("FORBIDDEN"),
		},
	})
	.resolve(async ({ headers, status }) => {
		const initData = headers["x-init-data"];

		try {
			// HMAC validation against the bot token, with an expiry window.
			// Without `expiresIn` a captured init-data string is valid forever.
			validate(initData, config.BOT_TOKEN, { expiresIn: 3600 });
		} catch {
			return status(401, "UNAUTHORIZED");
		}

		const parsed = parse(initData);
		if (!parsed.user) return status(401, "UNAUTHORIZED");

		const user = await getOrCreateUser(parsed.user);

		// Known caller, refused — not "unauthenticated".
		if (user.bannedAt) return status(403, "FORBIDDEN");

		return { user, tgId: parsed.user.id };
	})
	.as("scoped");

/**
 * Owner-only routes. Layered on top of `authElysia`, never instead of it.
 */
export const ownerElysia = new Elysia({ name: "owner" })
	.use(authElysia)
	.guard({ response: { 403: t.Literal("FORBIDDEN") } })
	.resolve(({ tgId, status }) => {
		if (!config.OWNER_IDS.includes(tgId)) return status(403, "FORBIDDEN");
		return {};
	})
	.as("scoped");

/**
 * Webhook authentication: a header, compared in constant time, on a fixed path.
 *
 * Never `POST /:botToken` or `/webhook/:secret`. Paths are logged by nginx, the
 * ingress, the APM, every trace span and the browser history of anyone who
 * opens one — so the credential ends up in half a dozen systems with different
 * retention policies and different audiences. Rotating it would also change the
 * URL, which turns a rotation into a coordinated change with the sender.
 */
export function verifyWebhookSecret(received: string | undefined): boolean {
	if (!received) return false;
	const a = Buffer.from(received);
	const b = Buffer.from(config.WEBHOOK_SECRET);
	if (a.length !== b.length) return false;
	return crypto.timingSafeEqual(a, b);
}
