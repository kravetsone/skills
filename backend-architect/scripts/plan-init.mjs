#!/usr/bin/env node
// Scaffold .backend-plan/. Idempotent: never overwrites existing content.
import { existsSync } from "node:fs";
import {
	args,
	ensureDir,
	fail,
	info,
	ok,
	paths,
	read,
	savePlan,
	style,
	warn,
	write,
} from "./lib/plan.mjs";

const a = args();

if (a.help) {
	info(
		[
			"Usage: node plan-init.mjs --name <slug> [--mode api|bot|both]",
			"",
			"  --name   project slug (required on first run)",
			"  --mode   api | bot | both   (default: both)",
			"",
			"Creates .backend-plan/ in the current directory.",
			"Override the location with BACKEND_PLAN_DIR.",
		].join("\n"),
	);
	process.exit(0);
}

const MODES = ["api", "bot", "both"];
const existing = existsSync(paths.plan) ? JSON.parse(read(paths.plan)) : null;

const name = a.name ?? existing?.name;
if (!name) fail("--name is required on first run.");

const mode = a.mode ?? existing?.mode ?? "both";
if (!MODES.includes(mode)) fail("--mode must be one of: " + MODES.join(", "));

for (const dir of [paths.raw, paths.ledger, paths.design, paths.adr, paths.out]) {
	ensureDir(dir);
}

const plan = {
	name,
	mode,
	createdAt: existing?.createdAt ?? new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	stage: existing?.stage ?? 0,
	models: existing?.models ?? {
		extract: "gpt-5.6-terra",
		reconcile: "gpt-5.6-luna",
		design: "gpt-5.6-sol",
	},
	gates: existing?.gates ?? { facts: null, architecture: null },
};
savePlan(plan);

const seeds = [
	[
		paths.decisions,
		"# Decisions log\n\nAppend-only. Every answer given at a gate, verbatim, with a timestamp.\nNever edit a past entry; supersede it with a new one.\n\n<!-- D-001 | 2026-01-01T00:00:00Z | Q-003 | answer -->\n",
	],
	[
		paths.questions,
		"# Open questions\n\n## Contradictions (must resolve)\n\n| # | Spec says | Figma says | Impact |\n| --- | --- | --- | --- |\n\n## Gaps (must answer)\n\n| # | Question | Why it matters | Default if unanswered |\n| --- | --- | --- | --- |\n\n## Assumptions (confirm or correct)\n\n| # | Assumption | Basis |\n| --- | --- | --- |\n",
	],
	[
		paths.hotspots,
		"# Race-condition register\n\nEvery entry MUST be closed by a database-level mechanism.\nA lock alone does not count - see references/race-conditions.md\n\n<!-- copy the H-### block format from references/race-conditions.md -->\n",
	],
];

let created = 0;
let kept = 0;
for (const [file, content] of seeds) {
	if (existsSync(file)) kept++;
	else {
		write(file, content);
		created++;
	}
}

info("");
info(style.bold("backend-architect") + "  " + style.dim("plan workspace"));
info("");
ok("project   " + name);
ok("mode      " + mode);
ok("location  " + paths.root);
if (created) ok("seeded    " + created + " file(s)");
if (kept) info(style.dim("  kept    " + kept + " existing file(s) untouched"));

const state = [
	["raw/spec.md", paths.spec],
	["raw/figma.digest.json", paths.figmaDigest],
	["ledger/facts.md", paths.facts],
	["ledger/screens.md", paths.screens],
];
info("");
info(style.bold("inputs"));
for (const [label, file] of state) {
	if (existsSync(file)) ok(label);
	else info(style.dim("  --    " + label + "  (missing)"));
}

info("");
info(style.bold("next"));
if (!existsSync(paths.spec))
	info("  1. node backend-architect/scripts/docs-pull.mjs <url|--file path>");
if (!existsSync(paths.figmaDigest))
	info("  2. FIGMA_TOKEN=... node backend-architect/scripts/figma-digest.mjs <figma-url>");
if (existsSync(paths.spec) && existsSync(paths.figmaDigest))
	info("  Stage 2: spawn the extractors (see references/model-tiering.md)");
info("");

if (!process.env.FIGMA_TOKEN && !existsSync(paths.figmaDigest)) {
	warn("FIGMA_TOKEN is not set - figma-digest.mjs will not run without it.");
}

// Remind about .gitignore in the target repo.
const gi = read("./.gitignore");
if (gi !== null && !gi.includes(".backend-plan")) {
	warn("Add '.backend-plan/' to .gitignore (working state, not an artefact).");
}
