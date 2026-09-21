// OpenTelemetry for Elysia: traces, metrics and logs over OTLP.
//
// The one configuration decision worth arguing about is what NOT to trace.
// `/health` is called constantly by the ingress; tracing it floods the
// collector with spans nobody will ever read and makes the useful ones harder
// to find. See references/telemetry.md.
import { opentelemetry } from "@elysiajs/opentelemetry";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { config } from "../config";

const otelCollectorUrl = config.OTEL_EXPORTER_OTLP_ENDPOINT;

export const telemetry = opentelemetry({
	serviceName: config.OTEL_SERVICE_NAME,
	checkIfShouldTrace: (req) => !new URL(req.url).pathname.startsWith("/health"),
	spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: otelCollectorUrl }))],
	metricReader: new PeriodicExportingMetricReader({
		exporter: new OTLPMetricExporter({ url: otelCollectorUrl }),
		exportIntervalMillis: 30000,
	}),
	logRecordProcessors: [
		// @ts-expect-error - type mismatch between the sdk-logs and api-logs versions
		new BatchLogRecordProcessor(new OTLPLogExporter({ url: otelCollectorUrl })),
	],
});

/**
 * Attributes that are safe to attach to a span.
 *
 * Traces are widely readable and exported to third-party tools. Headers carry
 * the auth token and Telegram init-data; bodies carry phone numbers and message
 * content. Send ids and categories — an allow-list, never a redaction list,
 * because a redaction list only protects the fields you remembered.
 */
export function safeSpanAttributes(input: {
	route: string;
	userId?: number | string;
	requestId?: string;
	errorCode?: string;
}) {
	return {
		"app.route": input.route,
		"app.user_id": input.userId != null ? String(input.userId) : undefined,
		"app.request_id": input.requestId,
		"app.error_code": input.errorCode,
	};
}
