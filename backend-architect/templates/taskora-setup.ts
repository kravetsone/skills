// Background work — taskora.
//
// This file is deliberately thin. taskora ships its own skill with the full
// API reference (https://github.com/kravetsone/taskora/tree/main/documentation/skills);
// install it and read that when implementing. What lives here is only the
// shape of the four decisions every task has to make, from
// references/jobs-taskora.md:
//
//   1. idempotency  — delivery is at-least-once, so "it will not run twice"
//                     is not an answer. Name the barrier.
//   2. retries      — and what happens after the last attempt.
//   3. flow control — debounce / throttle / deduplicate / singleton /
//                     concurrencyKey / collect / ttl. Pick deliberately.
//   4. schedules    — IANA timezone, and an onMissed policy.
import { createTaskora } from "taskora";
import { redisAdapter } from "taskora/adapters/redis";
import { config } from "../config";
import { redis } from "../lib/redis";

export const taskora = createTaskora({
	adapter: redisAdapter({ connection: redis }),
});

/**
 * A task with per-entity serialisation.
 *
 * `concurrencyKey` is the primitive most often missed, and frequently a better
 * answer than a Verrou lock: it serialises per user while staying parallel
 * across users, and it is enforced by the queue rather than by a TTL that can
 * expire underneath you.
 */
export const recalculateUserStats = taskora.task("recalculate-user-stats", {
	concurrencyKey: (data: { userId: number }) => String(data.userId),
	retry: { attempts: 5, backoff: { type: "exponential", delay: 1000 } },
	async handler({ data }) {
		// Idempotency barrier: this recomputes from source rows rather than
		// incrementing, so running it twice lands on the same value.
		// A handler that increments needs a Class-3 or Class-7 barrier instead.
		await recompute(data.userId);
	},
});

/**
 * Burst collapsing: many edits, one reindex.
 *
 * Reach for these before writing your own timer. A hand-rolled debounce is an
 * in-process timer, which means one per replica and none after a restart.
 */
export const reindexSearch = taskora.task("reindex-search", {
	debounce: { key: (d: { entityId: number }) => String(d.entityId), delay: "10s" },
	async handler({ data }) {
		await reindex(data.entityId);
	},
});

/**
 * Recurring work.
 *
 * taskora performs leader election (SET NX PX) so exactly one replica fires a
 * tick. That is the entire reason `setInterval` is banned: N replicas means N
 * fires, and the `lastRunAt` guard people add to compensate is itself a
 * read-modify-write race.
 */
export function registerSchedules() {
	taskora.schedule("daily-digest", {
		task: sendDigest,
		cron: "0 9 * * *",
		// An IANA zone, never a hand-computed offset. "UTC+3" for Moscow is
		// wrong across any future rule change, and quietly wrong forever.
		timezone: config.TIMEZONE,
		// If every replica was down at 09:00, should it fire late? A digest:
		// skip. Invoice generation: catch-up. This is a product decision.
		onMissed: "skip",
		data: {},
	});
}

export const sendDigest = taskora.task("send-digest", {
	singleton: true,
	async handler() {
		// Even with leader election, write through a UNIQUE (job_name,
		// scheduled_for) row so a double fire still produces one effect.
		// Belt and braces, because the effect here leaves the database.
	},
});

declare function recompute(userId: number): Promise<void>;
declare function reindex(entityId: number): Promise<void>;
