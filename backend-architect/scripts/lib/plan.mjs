// Shared helpers for backend-architect scripts. Zero dependencies, Node 20+.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const ROOT = process.env.BACKEND_PLAN_DIR
	? resolve(process.env.BACKEND_PLAN_DIR)
	: resolve(process.cwd(), ".backend-plan");

export const paths = {
	root: ROOT,
	plan: resolve(ROOT, "plan.json"),
	raw: resolve(ROOT, "raw"),
	spec: resolve(ROOT, "raw/spec.md"),
	specMeta: resolve(ROOT, "raw/spec.meta.json"),
	figmaRaw: resolve(ROOT, "raw/figma.raw.json"),
	figmaDigest: resolve(ROOT, "raw/figma.digest.json"),
	ledger: resolve(ROOT, "ledger"),
	facts: resolve(ROOT, "ledger/facts.md"),
	screens: resolve(ROOT, "ledger/screens.md"),
	questions: resolve(ROOT, "ledger/questions.md"),
	decisions: resolve(ROOT, "ledger/decisions.md"),
	design: resolve(ROOT, "design"),
	domain: resolve(ROOT, "design/domain.md"),
	adr: resolve(ROOT, "design/adr"),
	hotspots: resolve(ROOT, "design/hotspots.md"),
	out: resolve(ROOT, "out"),
	planDoc: resolve(ROOT, "out/BACKEND-PLAN.md"),
	openapi: resolve(ROOT, "out/openapi.yaml"),
	schema: resolve(ROOT, "out/schema.draft.ts"),
	analytics: resolve(ROOT, "out/analytics.md"),
	backlog: resolve(ROOT, "out/BACKLOG.md"),
};

export function ensureDir(p) {
	mkdirSync(p, { recursive: true });
}

export function write(file, content) {
	ensureDir(dirname(file));
	writeFileSync(file, content, "utf8");
	return file;
}

export function read(file) {
	return existsSync(file) ? readFileSync(file, "utf8") : null;
}

export function readPlan() {
	const txt = read(paths.plan);
	if (!txt) {
		fail(
			"No .backend-plan/plan.json found.\n" +
				"Run: node backend-architect/scripts/plan-init.mjs --name <slug> --mode api|bot|both",
		);
	}
	return JSON.parse(txt);
}

export function savePlan(plan) {
	write(paths.plan, JSON.stringify(plan, null, 2) + "\n");
}

export function args(argv = process.argv.slice(2)) {
	const out = { _: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith("--")) {
			const key = a.slice(2);
			const next = argv[i + 1];
			if (next === undefined || next.startsWith("--")) out[key] = true;
			else {
				out[key] = next;
				i++;
			}
		} else out._.push(a);
	}
	return out;
}

// ---- output -------------------------------------------------------------

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (useColor ? "\u001b[" + code + "m" + s + "\u001b[0m" : s);
export const style = {
	bold: (s) => c("1", s),
	dim: (s) => c("2", s),
	red: (s) => c("31", s),
	green: (s) => c("32", s),
	yellow: (s) => c("33", s),
	cyan: (s) => c("36", s),
};

export function info(msg) {
	console.log(msg);
}
export function ok(msg) {
	console.log(style.green("  ok  ") + msg);
}
export function warn(msg) {
	console.log(style.yellow(" warn ") + msg);
}
export function err(msg) {
	console.log(style.red(" FAIL ") + msg);
}
export function fail(msg) {
	console.error("\n" + style.red("error: ") + msg + "\n");
	process.exit(1);
}

// ---- markdown helpers ---------------------------------------------------

/** Extract ids like REQ-001 / H-003 / SCR-012 from text. */
export function ids(text, prefix) {
	if (!text) return [];
	const re = new RegExp("\\b" + prefix + "-(\\d{1,4})\\b", "g");
	return [...new Set([...text.matchAll(re)].map((m) => prefix + "-" + m[1]))].sort();
}

/**
 * Parse GitHub-flavoured markdown tables into arrays of row objects.
 * Returns every table found in the document.
 */
export function tables(md) {
	if (!md) return [];
	const lines = md.split("\n");
	const found = [];
	for (let i = 0; i < lines.length; i++) {
		const header = lines[i];
		const sep = lines[i + 1];
		if (!header || !sep) continue;
		if (!header.trim().startsWith("|")) continue;
		if (!/^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(sep)) continue;

		const cols = splitRow(header);
		const rows = [];
		let j = i + 2;
		for (; j < lines.length; j++) {
			const line = lines[j];
			if (!line || !line.trim().startsWith("|")) break;
			const cells = splitRow(line);
			const row = {};
			cols.forEach((col, k) => {
				row[col] = (cells[k] ?? "").trim();
			});
			row._raw = line;
			rows.push(row);
		}
		found.push({ columns: cols, rows });
		i = j - 1;
	}
	return found;
}

function splitRow(line) {
	return line
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map((s) => s.trim());
}

/** Find the first table that has all of the given column names. */
export function tableWith(md, ...required) {
	return (
		tables(md).find((t) =>
			required.every((r) =>
				t.columns.some((c2) => c2.toLowerCase().includes(r.toLowerCase())),
			),
		) ?? null
	);
}

/** Split a markdown doc into sections keyed by heading text. */
export function sections(md, level = 3) {
	if (!md) return [];
	const marker = "#".repeat(level) + " ";
	const out = [];
	let current = null;
	for (const line of md.split("\n")) {
		if (line.startsWith(marker)) {
			if (current) out.push(current);
			current = { title: line.slice(marker.length).trim(), body: "" };
		} else if (current) current.body += line + "\n";
	}
	if (current) out.push(current);
	return out;
}
