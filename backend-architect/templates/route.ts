// An Elysia route module. Thin by design: parse, call a service, map errors.
//
// Two things this file is trying to demonstrate:
//   1. every failure mode is in the typed response union, because that union
//      generates the OpenAPI the frontend's client is built from — an
//      undeclared error is an error the frontend cannot handle;
//   2. the guard boundary is visible. Public routes sit above `.use(authElysia)`,
//      protected ones below. It reads as a boundary and it is one.
import { Elysia, t } from "elysia";
import { authElysia } from "../lib/auth-plugin";
import { listBoxes, purchaseBox } from "../services/boxes";

const BoxSummary = t.Object({
	id: t.Number(),
	name: t.String(),
	priceXp: t.Number(),
	// Derived from the pool, never stored: a stored counter is a second source
	// of truth that drifts under concurrency.
	available: t.Number(),
});

export const boxesRoutes = new Elysia({ prefix: "/boxes", tags: ["boxes"] })
	// ---- public ------------------------------------------------------------
	.get("/", ({ query }) => listBoxes(query), {
		query: t.Object({
			// Bounded in the schema, not in the handler. An unbounded limit is
			// a denial-of-service endpoint with good intentions.
			limit: t.Number({ minimum: 1, maximum: 100, default: 20 }),
			offset: t.Number({ minimum: 0, default: 0 }),
		}),
		response: {
			200: t.Object({ items: t.Array(BoxSummary), total: t.Number() }),
		},
		detail: { description: "Implements REQ-###. Screen SCR-###." },
	})

	// ---- everything below requires authentication ---------------------------
	.use(authElysia)

	.post(
		"/:id/purchase",
		async ({ params, user, status }) => {
			const result = await purchaseBox(user.id, params.id);

			// The service returns a discriminated result rather than throwing.
			// Control flow a caller must handle is not exceptional.
			switch (result.kind) {
				case "ok":
					return { code: result.code, balance: result.balance };
				case "not-found":
					return status(404, "BOX_NOT_FOUND");
				case "insufficient":
					return status(400, "INSUFFICIENT_BALANCE");
				case "out-of-stock":
					// 409, not 400: you were right when you asked and wrong by
					// the time we answered. A 400 is indistinguishable from a
					// client bug, so the frontend cannot offer a useful retry.
					return status(409, "OUT_OF_STOCK");
			}
		},
		{
			params: t.Object({ id: t.Number() }),
			response: {
				// The promo code comes back in THIS response, not from a
				// follow-up fetch. Separating the claim from the read reopens
				// the race the guard closed (H-###).
				200: t.Object({ code: t.String(), balance: t.Number() }),
				400: t.Literal("INSUFFICIENT_BALANCE"),
				404: t.Literal("BOX_NOT_FOUND"),
				409: t.Literal("OUT_OF_STOCK"),
			},
			detail: { description: "Implements REQ-###. Concurrency: H-###." },
		},
	);
