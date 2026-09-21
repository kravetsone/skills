// Drizzle schema. Every constraint carries a comment naming the invariant it
// enforces, and every index a comment naming the query it serves.
//
// That convention is not decoration. Six months later the only way to know
// whether an index is still needed is to find the query it was created for,
// and the only way to know whether a constraint is safe to drop is to know
// which rule it encodes.
import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable(
	"users",
	{
		id: integer().primaryKey().generatedAlwaysAsIdentity(),
		tgId: integer("tg_id").notNull(),
		balanceXp: integer("balance_xp").notNull().default(0),
		bannedAt: timestamp("banned_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		// Invariant: one row per Telegram user.
		uniqueIndex("users_tg_id_key").on(table.tgId),
		// Invariant: a user's balance is never negative. The backstop behind
		// the conditional UPDATE — if a code path ever forgets its WHERE
		// clause, this turns silent corruption into a loud failure.
		check("users_balance_non_negative", sql`${table.balanceXp} >= 0`),
	],
);

export const articleClaims = pgTable(
	"article_claims",
	{
		userId: integer("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		articleId: integer("article_id").notNull(),
		claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		// Invariant: a reward is claimed at most once per user per article.
		// The composite primary key IS the dedupe barrier — the insert either
		// succeeds or conflicts, with no window between checking and writing.
		primaryKey({ columns: [table.userId, table.articleId] }),
	],
);

export const promoCodes = pgTable(
	"promo_codes",
	{
		id: integer().primaryKey().generatedAlwaysAsIdentity(),
		boxId: integer("box_id").notNull(),
		code: text().notNull(),
		// NULL means unclaimed. Claiming sets both columns in one UPDATE, so
		// there is no state in which a code is half-assigned.
		userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
		claimedAt: timestamp("claimed_at", { withTimezone: true }),
	},
	(table) => [
		// Invariant: a code string is unique within a box.
		uniqueIndex("promo_codes_box_code_key").on(table.boxId, table.code),
		// Serves: the claim query — pick one unclaimed code for a box with
		// FOR UPDATE SKIP LOCKED. Partial, because claimed rows are never read
		// by it and would otherwise bloat the index for the life of the table.
		index("promo_codes_unclaimed_idx")
			.on(table.boxId)
			.where(sql`user_id is null`),
		// Serves: "which codes does this user have?" on the profile screen.
		index("promo_codes_user_idx").on(table.userId),
	],
);

export const webhookInbox = pgTable(
	"webhook_inbox",
	{
		id: integer().primaryKey().generatedAlwaysAsIdentity(),
		source: text().notNull(),
		externalId: text("external_id").notNull(),
		payload: text().notNull(),
		receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
		processedAt: timestamp("processed_at", { withTimezone: true }),
	},
	(table) => [
		// Invariant: a provider event is processed at most once, however many
		// times the provider retries it.
		uniqueIndex("webhook_inbox_source_external_key").on(table.source, table.externalId),
		// Serves: the worker picking up unprocessed rows.
		index("webhook_inbox_pending_idx")
			.on(table.receivedAt)
			.where(sql`processed_at is null`),
	],
);

export const scheduledRuns = pgTable(
	"scheduled_runs",
	{
		jobName: text("job_name").notNull(),
		scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
		startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		// Invariant: a scheduled tick produces at most one run, even if leader
		// election is defeated by a network partition. The scheduler makes a
		// double fire unlikely; this makes it harmless.
		primaryKey({ columns: [table.jobName, table.scheduledFor] }),
	],
);

export const idempotencyKeys = pgTable(
	"idempotency_keys",
	{
		id: integer().primaryKey().generatedAlwaysAsIdentity(),
		userId: integer("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		key: text().notNull(),
		scope: text().notNull(),
		status: text().notNull().default("in_progress"),
		// The stored response, replayed verbatim on a retry so the client sees
		// the same ids it would have seen the first time.
		response: text(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
	},
	(table) => [
		// Invariant: a client intent executes at most once. Reserving the key
		// before doing the work is what closes the retry window.
		uniqueIndex("idempotency_keys_key_uniq").on(table.key),
		// Serves: the retention sweep that deletes rows older than 24h.
		index("idempotency_keys_created_idx").on(table.createdAt),
	],
);

export const outbox = pgTable(
	"outbox",
	{
		id: integer().primaryKey().generatedAlwaysAsIdentity(),
		kind: text().notNull(),
		payload: text().notNull(),
		dedupeKey: text("dedupe_key"),
		attempts: integer().notNull().default(0),
		lastError: text("last_error"),
		nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
		sentAt: timestamp("sent_at", { withTimezone: true }),
		deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		// Invariant: the same intent is recorded once, even when the producer
		// is itself a retried job.
		uniqueIndex("outbox_dedupe_key_uniq").on(table.dedupeKey),
		// Serves: the delivery worker's claim query.
		index("outbox_pending_idx")
			.on(table.nextAttemptAt)
			.where(sql`sent_at is null`),
	],
);
