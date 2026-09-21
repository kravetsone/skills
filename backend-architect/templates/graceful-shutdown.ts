// Graceful shutdown — the reverse of startup, and the order matters.
//
// The failure this prevents: killing Redis while a job handler is mid-flight
// turns a clean stop into a stalled job and an alert at 3 a.m. Deploys happen
// several times a day, so this path runs far more often than any error path
// you have tested.
import { config } from "../config";

type Closable = {
	server: { stop: (closeActiveConnections?: boolean) => Promise<void> | void };
	bot?: { stop: () => Promise<void> };
	taskora?: { close: () => Promise<void> };
	posthog?: { shutdown: () => Promise<void> };
	redis: { quit: () => Promise<unknown> };
	sql: { end: () => Promise<void> };
};

export function installShutdown(deps: Closable) {
	let shuttingDown = false;

	async function shutdown(signal: string) {
		// A second SIGTERM during shutdown must not start a second sequence.
		if (shuttingDown) return;
		shuttingDown = true;
		console.log("shutdown: received " + signal);

		const step = async (name: string, fn: () => Promise<unknown> | unknown) => {
			try {
				await fn();
				console.log("shutdown: " + name + " ok");
			} catch (error) {
				// One failing step must not strand the rest — an unflushed
				// analytics batch is not a reason to leave Postgres connected.
				console.error("shutdown: " + name + " failed", error);
			}
		};

		// 1. Stop accepting new work, oldest-first in the dependency chain.
		await step("http", () => deps.server.stop(true));
		await step("bot", () => deps.bot?.stop());
		// 2. Let in-flight jobs finish; do not accept new ones.
		await step("taskora", () => deps.taskora?.close());
		// 3. Flush buffered telemetry before its transport disappears.
		//    PostHog batches — skip this and every deploy drops the last batch.
		await step("analytics", () => deps.posthog?.shutdown());
		// 4. Only now close the stores everything above was using.
		await step("redis", () => deps.redis.quit());
		await step("postgres", () => deps.sql.end());

		process.exit(0);
	}

	process.on("SIGTERM", () => void shutdown("SIGTERM"));
	process.on("SIGINT", () => void shutdown("SIGINT"));

	// Report, flush, exit. Logging and continuing leaves the process in an
	// undefined state — it keeps serving traffic with corrupted invariants,
	// which is strictly worse than being restarted by Kubernetes.
	process.on("uncaughtException", (error) => {
		console.error("uncaughtException", error);
		if (config.isProduction) setTimeout(() => process.exit(1), 1000);
		else process.exit(1);
	});
	process.on("unhandledRejection", (reason) => {
		console.error("unhandledRejection", reason);
		process.exit(1);
	});
}
