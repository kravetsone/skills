#!/usr/bin/env node
// Stage 6 — the register gate.
//
// One rule, enforced mechanically: every H-### is closed by something the
// DATABASE enforces. A `@verrou/core` lock hands you a boolean, not a fencing
// token — a TTL expiry mid-transaction admits a second writer and no lock
// library will notice. So a row whose only defence is a lock fails here.
//
// See references/race-conditions.md (the 12 classes) and
// references/locks-verrou.md (where locks ARE the right answer).
import {
	args,
	err,
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
} from "./lib/plan.mjs";

const a = args();
if (a.help) {
	info(
		[
			"Usage: node hotspot-scan.mjs [--strict]",
			"",
			"  --strict   treat warnings as failures too",
			"",
			"Reads design/hotspots.md. Exits 1 if any hotspot lacks a",
			"database-level guard or a required field.",
		].join("\n"),
	);
	process.exit(0);
}

const md = read(paths.hotspots);
if (!md)
	fail(
		"design/hotspots.md does not exist.\n" +
			"Stage 4 has not run. See references/race-conditions.md for the register format.",
	);

// ---- field grammar ------------------------------------------------------

const FIELDS = [
	{ key: "invariant", labels: ["invariant", "инвариант"] },
	{ key: "class", labels: ["class", "класс"] },
	{ key: "interleaving", labels: ["breaking interleaving", "interleaving", "сценарий", "перепл"] },
	{ key: "guard", labels: ["guard", "гарантия", "защита"] },
	{ key: "lock", labels: ["lock", "лок", "блокировка"] },
	{ key: "failure", labels: ["failure response", "failure", "ответ при", "ошибка"] },
	{ key: "test", labels: ["test", "тест"] },
	{ key: "source", labels: ["source", "источник"] },
];

function readField(body, labels) {
	for (const label of labels) {
		const re = new RegExp(
			"^\\s*[-*]\\s*\\*\\*\\s*" + label + "[^*:]*:?\\s*\\*\\*:?\\s*(.*)$",
			"im",
		);
		const m = body.match(re);
		if (m) return m[1].trim();
	}
	return null;
}

// ---- what counts as a database-level guard ------------------------------

const DB_GUARDS = [
	[/\bfor\s+update\b/i, "SELECT ... FOR UPDATE"],
	[/\bskip\s+locked\b/i, "SKIP LOCKED"],
	[/\bon\s*conflict\b|onconflictdonothing|onconflictdoupdate/i, "ON CONFLICT"],
	[/\bunique\b|уникальн/i, "UNIQUE constraint"],
	[/\bcheck\s*\(|\bcheck\s+constraint\b|check-констрейнт/i, "CHECK constraint"],
	[/\bexclude\s+using\b/i, "EXCLUDE constraint"],
	[/pg_advisory|advisory\s+lock/i, "advisory lock"],
	[/\bserializable\b/i, "SERIALIZABLE isolation"],
	[/\boutbox\b|\binbox\b/i, "outbox/inbox table"],
	[/idempotency[_\s-]?key/i, "idempotency key table"],
	[/partial\s+(unique\s+)?index|частичн\w*\s+(уникальн\w*\s+)?индекс/i, "partial index"],
	[/composite\s+primary\s+key|составн\w+\s+первичн\w+\s+ключ/i, "composite PK"],
	// A conditional write: the predicate lives inside the statement.
	[/\bwhere\b[^\n]{0,80}(>=|<=|<>|!=|>|<)/i, "conditional UPDATE ... WHERE"],
	[/\breturning\b/i, "RETURNING row count as the decision"],
];

const LOCK_ONLY = /verrou|createlock|\block\b|локе?\b|блокиров|mutex|мьютекс|semaphore/i;
const CHECK_THEN_ACT =
	/check\s+if\s+exists|exists\s+then\s+insert|select[^\n]{0,40}then[^\n]{0,20}(insert|update)|проверя\w+[^\n]{0,40}(затем|потом)[^\n]{0,30}(вставля|обновля)|сначала\s+проверя/i;
const VAGUE_STORY =
	/^(if\s+)?(two|multiple)\s+(requests?|users?)\s+(happen|arrive|come)\s+at\s+(the\s+)?same\s+time\.?$|^при\s+одновременн\w+\s+запрос\w+\.?$/i;
const CONCRETE_ACTORS =
	/\b(two|both|second|first|twice|t1|t2|req\s?a|request\s?a)\b|\b(два|две|оба|обе|второй|вторая|первый|первая|дважды|одновременно|параллельн)\w*/i;
const RACE_TEST = /promise\.all|concurrent|parallel|одновременн|параллельн|гонк|\bn\s*=\s*\d+\s*(parallel|concurrent)/i;

// ---- parse --------------------------------------------------------------

const entries = sections(md, 3)
	.map((s) => {
		const id = (s.title.match(/H-\d+/) ?? [])[0];
		if (!id) return null;
		const out = { id, title: s.title.trim(), body: s.body };
		for (const f of FIELDS) out[f.key] = readField(s.body, f.labels);
		return out;
	})
	.filter(Boolean);

info("");
info(style.bold("hotspot-scan") + "  " + style.dim(paths.hotspots));
info("");

if (!entries.length) {
	if (/<!--\s*no-hotspots:\s*\S/i.test(md)) {
		warn("Register is empty, but carries an explicit no-hotspots justification.");
		info(style.dim("  " + (md.match(/<!--\s*no-hotspots:([^>]*)-->/i) ?? [])[1]?.trim()));
		info("");
		process.exit(0);
	}
	fail(
		"design/hotspots.md contains no H-### entries.\n\n" +
			"Almost every product with a balance, a counter, a limited pool, a one-shot\n" +
			"action, an external side effect or a schedule has at least one. If this one\n" +
			"genuinely does not, say so explicitly and re-run:\n\n" +
			"  <!-- no-hotspots: single-user read-only catalogue, no writes from clients -->",
	);
}

// ---- check --------------------------------------------------------------

let failures = 0;
let warnings = 0;
const covered = new Set();

for (const h of entries) {
	const problems = [];
	const notes = [];
	const soft = [];

	for (const f of FIELDS) {
		if (!h[f.key] || h[f.key].length === 0)
			problems.push("missing field **" + f.labels[0] + "**");
	}

	const guard = h.guard ?? "";
	if (guard) {
		const matched = DB_GUARDS.filter(([re]) => re.test(guard)).map(([, name]) => name);
		if (matched.length === 0) {
			if (LOCK_ONLY.test(guard))
				problems.push(
					"guard is a LOCK ONLY — verrou has no fencing token, so TTL expiry " +
						"mid-transaction admits a second writer (A1). Add a conditional " +
						"UPDATE ... WHERE ... RETURNING, a UNIQUE constraint, or FOR UPDATE SKIP LOCKED.",
				);
			else
				problems.push(
					"guard names no database-level mechanism. Expected one of: conditional " +
						"UPDATE ... WHERE ... RETURNING, UNIQUE / ON CONFLICT, CHECK, " +
						"FOR UPDATE [SKIP LOCKED], advisory lock, outbox/inbox, idempotency key.",
				);
		} else notes.push(matched.slice(0, 3).join(" + "));

		if (CHECK_THEN_ACT.test(guard))
			problems.push(
				"guard describes check-then-act (read, decide, write). That IS the race — " +
					"the predicate has to live inside the write statement.",
			);
	}

	const story = h.interleaving ?? "";
	if (story) {
		if (VAGUE_STORY.test(story.trim()) || story.trim().length < 70)
			problems.push(
				"breaking interleaving is not a concrete two-request story. Write what " +
					"request A reads, what request B reads, and the value the column ends " +
					"up holding. If you cannot, delete the row instead of padding it.",
			);
		else if (!CONCRETE_ACTORS.test(story))
			soft.push("story never names two actors — is it really an interleaving?");
		else if (!/\d/.test(story))
			soft.push("story has no concrete values; add the numbers that end up wrong.");
	}

	if (h.test && !RACE_TEST.test(h.test))
		soft.push("test does not look concurrent (no Promise.all / parallel / одновременно).");

	if (h.source) for (const r of ids(h.source, "REQ")) covered.add(r);
	if (h.source && !/REQ-\d|SCR-\d|\d+:\d+/.test(h.source))
		problems.push("source cites no REQ-###, SCR-### or Figma node id.");

	if (h.lock && !/^(none|нет|-|—|n\/a)/i.test(h.lock) && !h.guard)
		problems.push("a lock is specified but there is no guard at all.");

	const label = style.bold(h.id) + " " + h.title.replace(/^H-\d+\s*[—-]\s*/, "");
	if (problems.length) {
		failures++;
		err(label);
		for (const p of problems) info("       " + style.red("x") + " " + p);
	} else {
		ok(label);
		if (notes.length) info(style.dim("       via " + notes.join("; ")));
	}
	warnings += soft.length;
	for (const s of soft) info("       " + style.yellow("?") + " " + s);
}

// ---- cross-check against the facts ledger -------------------------------

const factsMd = read(paths.facts);
const factsTable = factsMd ? tableWith(factsMd, "ID", "Requirement") : null;
const uncovered = [];
for (const row of factsTable?.rows ?? []) {
	const key = Object.keys(row);
	const get = (n) => row[key.find((k) => k.toLowerCase().startsWith(n)) ?? ""] ?? "";
	if (!/^(yes|да|y|true)/i.test(get("concurrency"))) continue;
	const id = (get("id").match(/REQ-\d+/) ?? [])[0];
	if (id && !covered.has(id)) uncovered.push(id + " — " + get("requirement").slice(0, 80));
}

info("");
if (uncovered.length) {
	warn(
		uncovered.length +
			" requirement(s) flagged Concurrency? = yes are not cited by any hotspot:",
	);
	for (const u of uncovered) info(style.dim("       " + u));
	warnings += uncovered.length;
	info(
		style.dim(
			"       Either add the hotspot, or clear the flag in facts.md with a reason.",
		),
	);
}

info("");
info(
	"  " +
		entries.length +
		" hotspot(s), " +
		failures +
		" failing, " +
		warnings +
		" warning(s)",
);
info("");

if (failures) {
	err("Register is not sound. Read references/race-conditions.md — the class");
	info("       taxonomy tells you which mechanism each shape of race needs.");
	info("");
	process.exit(1);
}
if (warnings && a.strict) {
	err("--strict: warnings are failures.");
	info("");
	process.exit(1);
}
ok("Every hotspot is closed at the database level.");
info("");
