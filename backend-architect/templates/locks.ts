// @verrou/core — coordination, not correctness.
//
// Verrou issues no fencing token. If the TTL expires while your transaction is
// still running (GC pause, slow query, FOR UPDATE queueing), a second worker
// acquires the same lock legitimately and neither Redis nor Postgres will
// reject either write. So a lock never holds an invariant on its own — it sits
// in front of a guard that the database enforces.
//
// See references/locks-verrou.md and references/race-conditions.md.
import { Verrou } from "@verrou/core";
import { memoryStore } from "@verrou/core/drivers/memory";
import { redisStore } from "@verrou/core/drivers/redis";
import { config } from "../config";
import { redis } from "./redis";

export const verrou = new Verrou({
	default: config.LOCK_STORE,
	stores: {
		// memory is single-process. Tests run lock-aware with no Redis and no
		// conditional code; config.ts refuses to let it reach production.
		memory: { driver: memoryStore() },
		redis: { driver: redisStore({ connection: redis }) },
	},
});

/**
 * Key shape: `<domain>:<entity>:<id>:<operation>`.
 *
 * Lock the narrowest thing that preserves correctness. A global `purchase` lock
 * serialises every user in the system; `purchase:user:123` serialises one. Keys
 * without an entity id are usually a bottleneck waiting to be found under load.
 */
export function lockKey(domain: string, entity: string, id: string | number, op: string) {
	return [domain, entity, id, op].join(":");
}

/**
 * Queueing variant: wait for the lock, but never forever.
 *
 * Both defaults in verrou will bite you — TTL is 30s (often shorter than the
 * real critical section) and the retry timeout is Infinity (under contention
 * that converts a slow path into an exhausted connection pool and a service
 * that looks hung rather than slow). Both are explicit here.
 *
 * Acquire BEFORE opening a transaction, never inside one: two lock orders
 * across two code paths is a distributed deadlock with no detector, because
 * Postgres cannot see Redis.
 */
export async function withLock<T>(
	key: string,
	fn: () => Promise<T>,
	opts: { ttl?: string; timeout?: string; attempts?: number } = {},
): Promise<T> {
	const lock = verrou.createLock(key, opts.ttl ?? "60s");
	await lock.acquire({
		retry: { attempts: opts.attempts ?? 10, delay: 100, timeout: opts.timeout ?? "5s" },
	});
	try {
		return await fn();
	} finally {
		await lock.release();
	}
}

/**
 * Non-queueing variant: if someone else holds it, say so immediately.
 *
 * This is the right shape for non-transactional side effects — "only one
 * broadcast runs at a time", "only one token refresh in flight" — where there
 * is no row to constrain and a second run is waste rather than corruption.
 *
 * Returns `undefined` when the lock was held, so the caller can answer 409.
 */
export async function tryWithLock<T>(
	key: string,
	fn: () => Promise<T>,
	ttl = "60s",
): Promise<T | undefined> {
	const lock = verrou.createLock(key, ttl);
	const [acquired, result] = await lock.runImmediately(fn);
	return acquired ? result : undefined;
}
