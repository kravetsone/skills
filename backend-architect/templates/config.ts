// The only module that reads process.env.
//
// Everything else imports `config`. That is not a style preference: it makes
// the process fail at startup on a missing variable, instead of failing at
// 2 a.m. on the one code path that needed it.
//
// Names come from the platform contract — see references/platform-contract.md.
// Inventing DB_URL when the pipeline sets DATABASE_URL produces a service that
// reads beautifully and cannot deploy.
import env from "env-var";

export const config = {
	// ---- platform ---------------------------------------------------------
	NODE_ENV: env
		.get("NODE_ENV")
		.default("development")
		.asEnum(["production", "test", "development"]),
	PORT: env.get("PORT").default(8080).asPortNumber(),
	DATABASE_URL: env.get("DATABASE_URL").required().asString(),
	REDIS_HOST: env.get("REDIS_HOST").default("localhost").asString(),
	REDIS_PORT: env.get("REDIS_PORT").default(6379).asPortNumber(),
	PUBLIC_DOMAIN: env.get("PUBLIC_DOMAIN").asString(),
	API_URL: env.get("API_URL").asUrlString(),

	// ---- storage ----------------------------------------------------------
	// S3_INTERNAL_ENDPOINT is for uploads (no egress); S3_ENDPOINT builds public URLs.
	S3_ENDPOINT: env.get("S3_ENDPOINT").asString(),
	S3_INTERNAL_ENDPOINT: env.get("S3_INTERNAL_ENDPOINT").asString(),
	S3_ACCESS: env.get("S3_ACCESS").asString(),
	S3_SECRET: env.get("S3_SECRET").asString(),
	S3_BUCKET: env.get("S3_BUCKET").default("static").asString(),
	S3_REGION: env.get("S3_REGION").default("us-east-1").asString(),
	STATIC_URL: env.get("STATIC_URL").asString(),

	// ---- secrets ----------------------------------------------------------
	// Required, never defaulted. A defaulted secret cannot fail: the service
	// boots with a junk credential and the misconfiguration surfaces a week
	// later, as missing data, to someone who does not know it can be wrong.
	BOT_TOKEN: env.get("BOT_TOKEN").required().asString(),
	WEBHOOK_SECRET: env.get("WEBHOOK_SECRET").required().asString(),
	SENTRY_DSN: env.get("SENTRY_DSN").asString(),

	// Genuinely optional: undefined switches the feature off, it never runs wrong.
	POSTHOG_API_KEY: env.get("POSTHOG_API_KEY").asString(),
	POSTHOG_HOST: env.get("POSTHOG_HOST").default("https://eu.i.posthog.com").asUrlString(),

	// ---- application ------------------------------------------------------
	FRONTEND_URL: env.get("FRONTEND_URL").required().asString(),
	LOCK_STORE: env.get("LOCK_STORE").default("memory").asEnum(["memory", "redis"]),
	OPENAPI_PATH: env.get("OPENAPI_PATH").default("").asString(),
	OWNER_IDS: env.get("OWNER_IDS").default("").asArray().map(Number),
	TIMEZONE: env.get("TIMEZONE").default("Europe/Moscow").example("Europe/Moscow").asString(),

	// ---- telemetry --------------------------------------------------------
	OTEL_SERVICE_NAME: env.get("OTEL_SERVICE_NAME").default("<service>-be").asString(),
	OTEL_EXPORTER_OTLP_ENDPOINT: env.get("OTEL_EXPORTER_OTLP_ENDPOINT").asString(),

	// ---- business constants ----------------------------------------------
	// Every verbatim number from the spec lands here, prefixed by domain.
	// Then tuning the economy is a variable change rather than a code review,
	// and the plan can state which knobs exist without anyone reading source.
	GAME_XP_PER_ARTICLE: env.get("GAME_XP_PER_ARTICLE").default(2).asIntPositive(),
	GAME_BOX_PRICE_XP: env.get("GAME_BOX_PRICE_XP").default(100).asIntPositive(),

	// ---- derived ----------------------------------------------------------
	get STATIC_BASE_URL(): string {
		if (this.STATIC_URL) return this.STATIC_URL;
		if (!this.S3_ENDPOINT) return "";
		const base = this.S3_ENDPOINT.startsWith("http")
			? this.S3_ENDPOINT
			: "https://" + this.S3_ENDPOINT;
		return base + "/" + this.S3_BUCKET;
	},

	get isProduction(): boolean {
		// Never `PUBLIC_DOMAIN.includes("staging")`. That makes the hostname a
		// control plane: renaming a host changes behaviour with no deploy note.
		return this.NODE_ENV === "production";
	},
};

// env-var cannot express "optional in dev, mandatory in prod", so assert it here.
if (config.isProduction) {
	// The important one. An in-memory lock across replicas always succeeds —
	// the most dangerous failure mode there is, because everything looks fine
	// while the invariant it protects quietly rots.
	if (config.LOCK_STORE !== "redis")
		throw new Error("LOCK_STORE must be 'redis' in production (memory is single-process)");
	if (!config.SENTRY_DSN) throw new Error("SENTRY_DSN is required in production");
	if (!config.OTEL_EXPORTER_OTLP_ENDPOINT)
		throw new Error("OTEL_EXPORTER_OTLP_ENDPOINT is required in production");
}

export const analyticsEnabled = Boolean(config.POSTHOG_API_KEY);
