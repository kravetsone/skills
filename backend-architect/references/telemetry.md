# Telemetry — OpenTelemetry

Traces, metrics and logs go to an OTLP collector. This is mandatory infrastructure in this stack, not an optional nicety: the monolith is one process doing HTTP, bot updates and background jobs at once, and without traces you cannot tell which of the three is responsible for a latency spike.

## Setup

```ts
import { opentelemetry } from "@elysiajs/opentelemetry";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";

export const app = new Elysia()
  .use(
    opentelemetry({
      serviceName: config.OTEL_SERVICE_NAME,
      checkIfShouldTrace: (req) =>
        !new URL(req.url).pathname.startsWith("/health"),
      spanProcessors: [
        new BatchSpanProcessor(new OTLPTraceExporter({ url: otelCollectorUrl })),
      ],
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: otelCollectorUrl }),
        exportIntervalMillis: 30000,
      }),
      logRecordProcessors: [
        new BatchLogRecordProcessor(new OTLPLogExporter({ url: otelCollectorUrl })),
      ],
    }),
  );
```

Three details that matter:

- **`checkIfShouldTrace` excludes `/health`.** Kubernetes probes it every few seconds; tracing it floods the collector with spans that carry no information and costs real money at any volume.
- **Batch processors, not simple ones.** A simple processor exports per span, synchronously, adding collector latency to every request.
- **`exportIntervalMillis: 30000`** for metrics. Metrics are aggregates; exporting them more often buys noise.

Configuration comes from `OTEL_SERVICE_NAME` and `OTEL_EXPORTER_OTLP_ENDPOINT` — see [platform-contract.md](platform-contract.md).

## What to instrument beyond the automatic spans

The HTTP layer is instrumented for free. Everything interesting in this architecture is not:

| Surface | Span / metric | Why |
| --- | --- | --- |
| Background jobs | span per execution; attributes: task name, attempt, outcome | otherwise a retry storm is invisible |
| Lock acquisition | span; attributes: key, acquired, wait duration | lock waits are the first symptom of a contention problem |
| Transactions on hotspot paths | span; attribute: the hotspot id `H-###` | ties a latency spike to a known concurrency design |
| Outbound third-party calls | span; attributes: provider, status | partner slowness is the most common cause of "our API got slow" |
| Bot update handling | span per update type | bot traffic and HTTP traffic share a process and compete |

## Metrics worth having from day one

Deliberately few — an unread dashboard is worse than none.

- request rate, error rate, p95/p99 latency per route
- job queue depth, job failure rate, job duration p95
- lock contention: acquisition failures and wait time per key prefix
- database pool: in-use connections, wait time
- the two or three **business counters** the product actually lives on (purchases, claims, signups)

Those last ones matter more than they look. Technical metrics tell you the service is up; a business counter falling to zero while the service is up is the outage nobody pages for.

## Errors

Sentry, or the collector's error pipeline, captures exceptions. Two rules:

1. **Never attach full `headers` or `body` to an error report.** Headers carry the auth token and the Telegram init-data; bodies carry personal data. Send a redacted allow-list — route, user id, request id, error code — and nothing else. This is the difference between an error tracker and an unplanned credential archive.
2. Attach the trace id, so an error links to its trace.

## Logging

Structured, one JSON object per line, exported through the log pipeline. Every log line on a request path carries the trace id. Never log secrets, tokens, promo codes, or phone numbers.

Logging an entire request object or a parsed CSV — common in the reference projects — is both a privacy problem and a cost problem at production volume. Log identifiers and counts, not payloads.

## Process-level handlers

```ts
process.on("uncaughtException", (error) => {
  captureException(error);
  logger.fatal(error, "uncaught exception");
  process.exit(1);            // ← exit. Do not swallow.
});
```

Catching an uncaught exception and continuing leaves the process in an undefined state — half-committed transactions, locks believed held, a connection pool with dangling handles. Report it, then die and let Kubernetes restart cleanly. Swallowing it converts a visible crash into a service that is up and wrong.

## In the plan

An observability section naming: the service name, which spans are custom, the metric list, the error-redaction allow-list, and — the part most plans omit — **the three alerts that should page someone**, with their thresholds. Alerts without thresholds are a wish.
