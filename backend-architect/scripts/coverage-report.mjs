#!/usr/bin/env node
// Stage 6 — traceability.
//
// A plan is complete when every requirement, every screen and every race
// hotspot has somewhere to land. This walks the ledgers, finds the surface
// each id maps to, and writes the traceability table the plan's last section
// is supposed to contain.
//
// A failure here is not untidiness: a requirement with no implementation
// surface is a feature nobody will build.
import {
	args,
	err,
	fail,
	ids,
	info,
	ok,
	paths,
	read,
	style,
	warn,
	write,
} from "./lib/plan.mjs";
import { resolve } from "node:path";

const a = args();
if (a.help) {
	info(
		[
			"Usage: node coverage-report.mjs [--strict] [--no-write]",
			"",
			"  --strict     treat warnings as failures",
			"  --no-write   do not write out/traceability.md",
			"",
			"Checks that every REQ-###, SCR-### and H-### reaches an artefact.",
		].join("\n"),
	);
	process.exit(0);
}

const factsMd = read(paths.facts) ?? "";
const screensMd = read(paths.screens) ?? "";
const hotspotsMd = read(paths.hotspots) ?? "";
const planDoc = read(paths.planDoc);
const openapi = read(paths.openapi) ?? "";
const schema = read(paths.schema) ?? "";
const analytics = read(paths.analytics) ?? "";
const backlog = read(paths.backlog) ?? "";

if (!planDoc) fail("out/BACKEND-PLAN.md does not exist — stage 5 has not run.");

const reqIds = ids(factsMd, "REQ");
const scrIds = ids(screensMd, "SCR");
const hotIds = ids(hotspotsMd, "H");

if (!reqIds.length) fail("ledger/facts.md yields no REQ-### ids — nothing to trace.");

// ---- where the plan talks about each id ---------------------------------

const planLines = planDoc.split("\n");
const traceSection = findTraceabilitySection(planDoc);

function findTraceabilitySection(md) {
	const lines = md.split("\n");
	let start = -1;
	let end = lines.length;
	lines.forEach((line, i) => {
		if (start >= 0 && i > start && /^#{1,3}\s+\S/.test(line) && end === lines.length) end = i;
		if (
			start < 0 &&
			(/<!--\s*section:\s*traceability\s*-->/i.test(line) ||
				/^#{1,3}\s+.*(traceab|трассир|покрыти|матрица)/i.test(line))
		)
			start = i;
	});
	return start < 0 ? null : { start, end };
}

function inTraceability(lineNo) {
	return traceSection && lineNo >= traceSection.start && lineNo < traceSection.end;
}

const ENDPOINT = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z0-9_\-{}:./]*)/g;
const TABLE_HINT = /\b(table|таблиц|drizzle|pgTable|schema)\b/i;
const JOB_HINT = /\b(task|job|schedule|cron|taskora|джоб|задач|рассылк|worker)\b/i;
const EVENT_HINT = /\b(event|событи|posthog|capture|analytics|аналитик)\b/i;

function surfacesFor(id) {
	const found = new Set();
	planLines.forEach((line, i) => {
		if (!line.includes(id) || inTraceability(i)) return;
		if (line.match(ENDPOINT)) found.add("endpoint");
		if (TABLE_HINT.test(line)) found.add("table");
		if (JOB_HINT.test(line)) found.add("job");
		if (EVENT_HINT.test(line)) found.add("event");
		found.add("plan");
	});
	if (openapi.includes(id)) found.add("openapi");
	if (schema.includes(id)) found.add("schema");
	if (analytics.includes(id)) found.add("analytics");
	if (backlog.includes(id)) found.add("backlog");
	return found;
}

const REAL = ["endpoint", "table", "job", "event", "openapi", "schema", "analytics", "backlog"];

info("");
info(style.bold("coverage-report") + "  " + style.dim(paths.root));
info("");

let failures = 0;
let warnings = 0;
const rows = [];

for (const id of reqIds) {
	const s = surfacesFor(id);
	const real = REAL.filter((k) => s.has(k));
	rows.push({ id, surfaces: real });
	if (real.length === 0) {
		failures++;
		err(
			id +
				(s.has("plan")
					? " — mentioned in the plan but maps to no endpoint, table, job or event"
					: " — appears in no artefact at all"),
		);
	}
}

for (const id of scrIds) {
	const s = surfacesFor(id);
	const real = REAL.filter((k) => s.has(k));
	rows.push({ id, surfaces: real });
	if (!s.has("plan") && real.length === 0) {
		warnings++;
		warn(id + " — no artefact references this screen; is it out of scope, or missed?");
	}
}

for (const id of hotIds) {
	const s = surfacesFor(id);
	rows.push({ id, surfaces: REAL.filter((k) => s.has(k)) });
	if (!backlog.includes(id)) {
		failures++;
		err(
			id +
				" — no backlog item. Every hotspot ships with its concurrency test, or " +
				"the guard gets refactored away by someone who does not know why it is there.",
		);
	}
	if (!planDoc.includes(id)) {
		failures++;
		err(id + " — present in design/hotspots.md but absent from BACKEND-PLAN.md.");
	}
}

// ---- endpoint table vs openapi -----------------------------------------

function normalise(p) {
	return p
		.replace(/:([A-Za-z0-9_]+)/g, "{$1}")
		.replace(/\/+$/, "")
		.trim();
}

const planEndpoints = new Map();
for (const line of planLines)
	for (const m of line.matchAll(ENDPOINT)) {
		const path = normalise(m[2]);
		if (path === "/health" || path === "/ready") continue;
		planEndpoints.set(m[1] + " " + path, line.trim().slice(0, 80));
	}

const openapiPaths = new Set(
	[...openapi.matchAll(/^\s{2,4}(\/[^\s:]*):\s*$/gm)].map((m) => normalise(m[1])),
);

if (openapi) {
	for (const [key] of planEndpoints) {
		const path = key.split(" ")[1];
		if (!openapiPaths.has(path)) {
			failures++;
			err(key + " — in the plan's endpoint table but not in openapi.yaml");
		}
	}
	const planPaths = new Set([...planEndpoints.keys()].map((k) => k.split(" ")[1]));
	for (const p of openapiPaths)
		if (!planPaths.has(p)) {
			warnings++;
			warn(p + " — in openapi.yaml but not in the plan's endpoint table");
		}
} else if (planEndpoints.size) {
	warnings++;
	warn("out/openapi.yaml is missing — the frontend has nothing to build against yet.");
}

// ---- report -------------------------------------------------------------

const covered = rows.filter((r) => r.surfaces.length).length;
info("");
ok("requirements  " + reqIds.length);
ok("screens       " + scrIds.length);
ok("hotspots      " + hotIds.length);
ok("endpoints     " + planEndpoints.size + (openapi ? " (openapi: " + openapiPaths.size + ")" : ""));
info("  traced        " + covered + "/" + rows.length);

if (!a["no-write"]) {
	const table = [
		"<!-- section: traceability -->",
		"",
		"## Traceability",
		"",
		"Generated by `coverage-report.mjs` on " + new Date().toISOString().slice(0, 10) + ".",
		"",
		"| ID | Surfaces |",
		"| --- | --- |",
		...rows.map((r) => "| " + r.id + " | " + (r.surfaces.join(", ") || "—") + " |"),
		"",
	].join("\n");
	write(resolve(paths.out, "traceability.md"), table);
	info("");
	ok("wrote  out/traceability.md  " + style.dim("(paste into the plan's last section)"));
}

info("");
info("  " + failures + " failing, " + warnings + " warning(s)");
info("");

if (failures) {
	err("Coverage is incomplete — this is a hole in the plan, not a formatting issue.");
	info("");
	process.exit(1);
}
if (warnings && a.strict) {
	err("--strict: warnings are failures.");
	info("");
	process.exit(1);
}
ok("Every requirement, screen and hotspot reaches an artefact.");
info("");
