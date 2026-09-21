#!/usr/bin/env node
// Stage 3 — mechanical reconciliation of the two ledgers.
//
// This script does not think. It finds the four things a machine can find
// reliably, and hands them to a cheap model to turn into real questions:
//
//   1. screens whose implied reads no requirement describes   -> spec gap
//   2. requirements no screen surfaces                        -> headless
//   3. the same constant with two different values            -> contradiction
//   4. rows flagged Concurrency? = yes                        -> hotspot candidates
//
// Output goes into a delimited block inside ledger/questions.md so that
// anything a human wrote there survives a re-run.
import { existsSync } from "node:fs";
import {
	args,
	fail,
	ids,
	info,
	ok,
	paths,
	read,
	sections,
	style,
	tableWith,
	warn,
	write,
} from "./lib/plan.mjs";

const a = args();
if (a.help) {
	info(
		[
			"Usage: node merge-facts.mjs [--min-overlap 2] [--dry]",
			"",
			"  --min-overlap  stems two texts must share to count as related (default 2)",
			"  --dry          print findings, do not touch ledger/questions.md",
			"",
			"Reads ledger/facts.md + ledger/screens.md, writes a generated block",
			"into ledger/questions.md between machine markers.",
		].join("\n"),
	);
	process.exit(0);
}

const MIN_OVERLAP = Number(a["min-overlap"] ?? 2);
const BEGIN = "<!-- merge-facts:begin — generated, do not edit by hand -->";
const END = "<!-- merge-facts:end -->";

// ---- load ---------------------------------------------------------------

const factsMd = read(paths.facts);
const screensMd = read(paths.screens);

if (!factsMd && !screensMd)
	fail(
		"Neither ledger/facts.md nor ledger/screens.md exists.\n" +
			"Stage 2 has not run. See references/pipeline.md.",
	);

const factsTable = factsMd ? tableWith(factsMd, "ID", "Requirement") : null;
if (factsMd && !factsTable)
	fail(
		"ledger/facts.md has no table with ID + Requirement columns.\n" +
			"Expected the format from references/pipeline.md stage 2a.",
	);

const facts = (factsTable?.rows ?? [])
	.map((r) => {
		const col = (name) =>
			r[Object.keys(r).find((k) => k.toLowerCase().startsWith(name)) ?? ""] ?? "";
		return {
			id: (col("id").match(/REQ-\d+/) ?? [col("id")])[0],
			text: col("requirement"),
			source: col("source"),
			type: col("type").toLowerCase(),
			concurrency: /^(yes|да|y|true)/i.test(col("concurrency")),
		};
	})
	.filter((f) => /^REQ-\d+$/.test(f.id));

const screens = sections(screensMd, 3)
	.map((s) => {
		const id = (s.title.match(/SCR-\d+/) ?? [])[0];
		if (!id) return null;
		return {
			id,
			title: s.title,
			node: (s.title.match(/node\s+([\d:]+)/) ?? [])[1] ?? null,
			devStatus: (s.title.match(/devStatus\s+([A-Z_]+)/) ?? [])[1] ?? null,
			body: s.body,
			displays: field(s.body, "Displays"),
			actions: field(s.body, "Actions"),
			states: field(s.body, "States"),
			reads: field(s.body, "Implied reads"),
			writes: field(s.body, "Implied writes"),
			refs: ids(s.body + " " + s.title, "REQ"),
		};
	})
	.filter(Boolean);

function field(body, name) {
	const re = new RegExp("^\\s*[-*]\\s*\\*\\*" + name + "[^*]*:?\\*\\*:?\\s*(.+)$", "im");
	return (body.match(re) ?? [])[1]?.trim() ?? "";
}

// ---- stemming and overlap ----------------------------------------------

const STOP = new Set(
	(
		"the and for with from that this have has are can may must should when then than " +
		"user users list item items page screen data value values name none null true false " +
		"который которая которое которые быть может должен должна должны если после перед " +
		"этого этой этом такой такие может можно нужно только также всех всего него неё " +
		"пользователь пользователя пользователи экран экрана список данные значение"
	).split(/\s+/),
);

/** Crude stem: lowercase, strip inflection by truncating. Survives ru case endings. */
function stems(text) {
	if (!text) return new Set();
	const out = new Set();
	for (const w of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
		if (w.length < 4 || STOP.has(w) || /^\d+$/.test(w)) continue;
		out.add(w.length > 5 ? w.slice(0, 5) : w);
	}
	return out;
}

function overlap(a1, b1) {
	let n = 0;
	for (const s of a1) if (b1.has(s)) n++;
	return n;
}

const factStems = facts.map((f) => ({ ...f, stems: stems(f.text + " " + f.source) }));
const screenStems = screens.map((s) => ({
	...s,
	stems: stems(s.title + " " + s.displays + " " + s.actions + " " + s.reads + " " + s.writes),
}));

// ---- 1. spec gaps: a screen reads/writes something no requirement covers

const gaps = [];
for (const s of screenStems) {
	const payload = [s.reads, s.writes]
		.filter((p) => p && !/^(none|нет|-|—|n\/a)\.?$/i.test(p.trim()))
		.join("; ");
	if (!payload) continue;
	const need = stems(payload);
	if (need.size === 0) continue;
	if (s.refs.length) continue; // explicitly cited a requirement
	const best = factStems
		.map((f) => ({ id: f.id, score: overlap(need, f.stems) }))
		.sort((x, y) => y.score - x.score)[0];
	if (!best || best.score < MIN_OVERLAP)
		gaps.push({
			screen: s.id,
			title: s.title
				.split("(")[0]
				.replace(/^SCR-\d+\s*[—-]\s*/, "")
				.trim(),
			payload: payload.slice(0, 140),
			nearest: best && best.score > 0 ? best.id + " (weak)" : "—",
		});
}

// ---- 2. headless requirements: no screen surfaces them

const headless = [];
if (screenStems.length) {
	const cited = new Set(screens.flatMap((s) => s.refs));
	for (const f of factStems) {
		if (cited.has(f.id)) continue;
		if (["nfr", "analytics", "integration"].includes(f.type)) continue; // legitimately headless
		const best = screenStems
			.map((s) => ({ id: s.id, score: overlap(f.stems, s.stems) }))
			.sort((x, y) => y.score - x.score)[0];
		if (!best || best.score < MIN_OVERLAP)
			headless.push({
				req: f.id,
				type: f.type || "—",
				text: f.text.slice(0, 120),
			});
	}
}

// ---- 3. contradictions: the same thing, two numbers

function numbersWithContext(text, origin) {
	const out = [];
	if (!text) return out;
	for (const line of text.split("\n")) {
		if (!line.trim() || line.trim().startsWith("|---")) continue;
		const ctx = stems(line);
		if (ctx.size === 0) continue;
		for (const m of line.matchAll(/(?<![\w-])(\d+(?:[.,]\d+)?)(?![\w-])/g)) {
			const value = m[1].replace(",", ".");
			if (value.length > 6) continue; // ids, node numbers, years-in-ms
			out.push({ value, ctx, line: trimRow(line), origin });
		}
	}
	return out;
}

/** Strip markdown table pipes and bullet syntax so quoted lines read as prose. */
function trimRow(line) {
	return line
		.trim()
		.replace(/^\|\s*/, "")
		.replace(/\s*\|$/, "")
		.replace(/^[-*]\s*/, "")
		.replace(/\*\*/g, "")
		.slice(0, 160);
}

const specNums = numbersWithContext(factsMd, "spec");
const figmaNums = numbersWithContext(screensMd, "figma");

const contradictions = [];
const seenPair = new Set();
for (const s of specNums) {
	for (const f of figmaNums) {
		if (s.value === f.value) continue;
		const shared = overlap(s.ctx, f.ctx);
		if (shared < 2) continue;
		const key = s.line + "|" + f.line;
		if (seenPair.has(key)) continue;
		seenPair.add(key);
		contradictions.push({
			spec: s.line,
			figma: f.line,
			values: s.value + " vs " + f.value,
			shared,
		});
	}
}
contradictions.sort((x, y) => y.shared - x.shared);
const topContradictions = contradictions.slice(0, 20);

// ---- 4. hotspot candidates

const hotspotCandidates = facts.filter((f) => f.concurrency);

// ---- report -------------------------------------------------------------

info("");
info(style.bold("merge-facts") + "  " + style.dim(paths.root));
info("");
ok("requirements       " + facts.length);
ok("screens            " + screens.length);
ok("hotspot candidates " + hotspotCandidates.length);
if (topContradictions.length) warn("contradictions     " + topContradictions.length + " numeric pair(s)");
else ok("contradictions     0");
if (gaps.length) warn("spec gaps          " + gaps.length + " screen(s) read data no REQ describes");
else ok("spec gaps          0");
if (headless.length) warn("headless reqs      " + headless.length);
else ok("headless reqs      0");

if (!facts.length) warn("facts.md parsed to zero rows — check the table format.");
if (screensMd && !screens.length)
	warn("screens.md parsed to zero sections — headings must be '### SCR-### — ...'.");

// ---- write --------------------------------------------------------------

const block = [
	BEGIN,
	"",
	"## Mechanical findings (" + new Date().toISOString().slice(0, 10) + ")",
	"",
	"Produced by `merge-facts.mjs`. These are candidates, not conclusions — a model",
	"turns them into the curated tables above, then this block can be ignored.",
	"",
	"### MF-C — contradictions: same subject, different number",
	"",
	topContradictions.length
		? table(
				["#", "Values", "Spec line", "Screen line"],
				topContradictions.map((c, i) => [
					"MF-C" + (i + 1),
					c.values,
					esc(c.spec),
					esc(c.figma),
				]),
			)
		: "_none found_",
	"",
	"### MF-G — spec gaps: screen needs data no requirement describes",
	"",
	gaps.length
		? table(
				["#", "Screen", "Needs", "Nearest REQ"],
				gaps.map((g, i) => [
					"MF-G" + (i + 1),
					g.screen + " " + esc(g.title),
					esc(g.payload),
					g.nearest,
				]),
			)
		: "_none found_",
	"",
	"### MF-H — headless requirements: no screen surfaces them",
	"",
	"Fine for bots, webhooks and background rules. Suspicious for a Mini App —",
	"it usually means a screen was missed, not that the feature is invisible.",
	"",
	headless.length
		? table(
				["#", "REQ", "Type", "Requirement"],
				headless.map((h, i) => ["MF-H" + (i + 1), h.req, h.type, esc(h.text)]),
			)
		: "_none found_",
	"",
	"### MF-R — race hotspot candidates (Concurrency? = yes)",
	"",
	"Seeds for `design/hotspots.md`. Each one needs a concrete two-request story",
	"or it gets deleted — see references/race-conditions.md.",
	"",
	hotspotCandidates.length
		? table(
				["REQ", "Requirement", "Source"],
				hotspotCandidates.map((f) => [f.id, esc(f.text), esc(f.source)]),
			)
		: "_none flagged — verify that stage 2 filled the Concurrency? column_",
	"",
	END,
	"",
].join("\n");

function esc(s) {
	return (s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function table(cols, rows) {
	return [
		"| " + cols.join(" | ") + " |",
		"| " + cols.map(() => "---").join(" | ") + " |",
		...rows.map((r) => "| " + r.join(" | ") + " |"),
	].join("\n");
}

if (a.dry) {
	info("");
	info(block);
	process.exit(0);
}

const existing = read(paths.questions) ?? "# Open questions\n";
let next;
if (existing.includes(BEGIN) && existing.includes(END)) {
	const start = existing.indexOf(BEGIN);
	const stop = existing.indexOf(END) + END.length;
	next = existing.slice(0, start) + block.trim() + existing.slice(stop);
} else {
	next = existing.trimEnd() + "\n\n---\n\n" + block;
}
write(paths.questions, next);

info("");
ok("wrote  ledger/questions.md");
info("");
info(style.bold("next"));
info("  1. A cheap model rewrites the curated tables at the top of questions.md");
info("     from the MF-* findings (references/model-tiering.md).");
info("  2. GATE 1 — present contradictions, gaps and assumptions to the human.");
info("  3. Append the answers to ledger/decisions.md, verbatim, with a timestamp.");
info("");

if (!existsSync(paths.decisions))
	warn("ledger/decisions.md is missing — run plan-init.mjs to seed it.");
