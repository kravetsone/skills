#!/usr/bin/env node
// Reduce Figma to a backend-relevant digest.
//
// Two modes, chosen automatically:
//   targeted  one or more deep-links carrying node-id  ->  GET /nodes?ids=... only.
//             No whole-file inventory is fetched. This is the normal case: a
//             designer hands over "implement these 48 screens" as 48 links.
//   broad     a bare file link  ->  GET /files/{key}?depth=N, then the frames.
//
// Keeps: screens, text, states, prototype flow graph, devStatus, component props.
// Drops: geometry, fills, strokes, effects, vector paths — 95% of the bytes.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { args, fail, info, ok, paths, style, warn, write } from "./lib/plan.mjs";

const a = args();

// ---- input: one url, many urls, a file of urls, or stdin ----------------

const rawInputs = [...(a._ ?? [])];
if (typeof a.url === "string") rawInputs.push(a.url);
if (typeof a["from-file"] === "string") {
	if (!existsSync(a["from-file"])) fail("--from-file: no such file: " + a["from-file"]);
	rawInputs.push(...readFileSync(a["from-file"], "utf8").split(/\s+/));
}
if (a.stdin) rawInputs.push(...readFileSync(0, "utf8").split(/\s+/));

// Links are usually pasted out of a chat or a markdown list, so they arrive
// wearing "@" prefixes, angle brackets and trailing commas.
const urls = rawInputs
	.map((s) => String(s).trim().replace(/^[@<(`]+/, "").replace(/[>)`,.;]+$/, ""))
	.filter((s) => s.length > 0);

if (urls.length === 0 || a.help) {
	info(
		[
			"Usage: FIGMA_TOKEN=figd_... node figma-digest.mjs <figma-url...> [options]",
			"",
			"  Accepts many links at once — the normal handover shape:",
			"    node figma-digest.mjs <url1> <url2> ... <url48>",
			"    node figma-digest.mjs --from-file links.txt",
			"    pbpaste | node figma-digest.mjs --stdin",
			"",
			"  --from-file <p>   read whitespace-separated links from a file",
			"  --stdin           read links from stdin",
			"  --depth <n>       inventory depth, broad mode only (default 2)",
			"  --max-nodes <n>   safety cap on traversed nodes (default 40000)",
			"  --max-screens <n> cap on fully-fetched screens (default 120)",
			"  --render-images    render selected nodes to raw/figma-images/ (opt-in)",
			"  --render-limit <n> maximum renders (default 12)",
			"  --refresh         ignore the cached raw response",
		].join("\n"),
	);
	process.exit(urls.length || a.help ? 0 : 1);
}

const TOKEN = process.env.FIGMA_TOKEN;
if (!TOKEN)
	fail(
		"FIGMA_TOKEN is not set.\n" +
			"Create one at Figma > Settings > Security > Personal access tokens\n" +
			"Scopes: file_content:read (plus file_comments:read and file_dev_resources:read for extras).",
	);

const MAX_NODES = Number(a["max-nodes"] ?? 40000);
const MAX_SCREENS = Number(a["max-screens"] ?? 120);
const RENDER_LIMIT = Number(a["render-limit"] ?? 12);
const DEPTH = Number(a.depth ?? 2);
// Overridable for tests; production always talks to Figma.
const API_BASE = process.env.FIGMA_API_BASE ?? "https://api.figma.com";

const STATE_WORDS = new Set(
	(
		"empty|loading|error|success|default|active|inactive|disabled|skeleton|modal|popup|" +
		"hover|pressed|focus|filled|selected|expanded|collapsed|open|closed|done|failed|" +
		"пусто|пустой|пустая|пустое|загрузка|загружается|ошибка|успех|успешно|активный|активно|" +
		"неактивный|выключен|модалка|модальное|попап|выбран|выбрано|заполнен|заполнено|дефолт|" +
		"скелетон|развернут|свернут|открыт|закрыт"
	).split("|"),
);

// ---- group the links by file, collect node ids --------------------------

const parsed = urls.map(parseUrl);
const unparsed = urls.filter((_, i) => !parsed[i].fileKey);
if (unparsed.length)
	warn(unparsed.length + " input(s) were not Figma links and were ignored, e.g. " + unparsed[0].slice(0, 60));

const byKey = new Map();
for (const p of parsed) {
	if (!p.fileKey) continue;
	if (!byKey.has(p.fileKey)) byKey.set(p.fileKey, new Set());
	if (p.nodeId) byKey.get(p.fileKey).add(p.nodeId);
}
if (byKey.size === 0) fail("Could not parse a file key out of any of the " + urls.length + " input(s).");
if (byKey.size > 1)
	fail(
		"The links point at " + byKey.size + " different Figma files:\n" +
			[...byKey.keys()].map((k) => "  " + k).join("\n") +
			"\nOne plan covers one product surface. Run the pipeline once per file,\n" +
			"overriding BACKEND_PLAN_DIR, then reconcile the digests by hand.",
	);

const fileKey = [...byKey.keys()][0];
const requestedIds = [...byKey.get(fileKey)];
const TARGETED = requestedIds.length > 0;

info("");
info(style.bold("figma-digest") + "  " + style.dim(fileKey));
info(
	style.dim(
		"  " + urls.length + " link(s) -> " + requestedIds.length + " unique node id(s)   mode: " +
			(TARGETED ? "targeted" : "broad"),
	),
);
info("");

// ---- fetch ---------------------------------------------------------------

let fileMeta = {};
let canvases = [];
let selected = [];
let framesTotal = null;
const nodeMap = {};

if (TARGETED) {
	const cached = !a.refresh && existsSync(paths.figmaRaw) ? tryJson(paths.figmaRaw) : null;
	const cacheUsable =
		cached?.fileKey === fileKey &&
		Array.isArray(cached.nodeIds) &&
		requestedIds.every((id) => cached.nodeIds.includes(id));

	if (cacheUsable) {
		Object.assign(nodeMap, cached.nodes ?? {});
		fileMeta = { name: cached.name, lastModified: cached.lastModified };
		ok("using cached raw response (--refresh to re-fetch)");
	} else {
		// Full subtrees are heavy, so keep the batches small.
		const BATCH = 8;
		for (let i = 0; i < requestedIds.length; i += BATCH) {
			const batch = requestedIds.slice(i, i + BATCH);
			const res = await api("/v1/files/" + fileKey + "/nodes?ids=" + batch.join(","));
			Object.assign(nodeMap, res.nodes ?? {});
			// The nodes endpoint carries file metadata, so no extra call is needed.
			if (!fileMeta.name) fileMeta = { name: res.name, lastModified: res.lastModified };
			progress("fetching nodes", Math.min(i + BATCH, requestedIds.length), requestedIds.length);
		}
		clearProgress();
		write(
			paths.figmaRaw,
			JSON.stringify({ fileKey, nodeIds: requestedIds, ...fileMeta, nodes: nodeMap }),
		);
		ok("nodes fetched  " + fmtBytes(statSync(paths.figmaRaw).size));
	}

	// A node id that came back empty is a hard signal, never a silent skip:
	// the frame was deleted, renamed into another file, or sits behind a
	// branch the token cannot see.
	const missing = requestedIds.filter((id) => !nodeMap[id]?.document);
	if (missing.length) {
		warn(
			missing.length + " of " + requestedIds.length + " requested node(s) returned nothing:\n" +
				missing.map((id) => "       " + id + "  (" + id.replace(":", "-") + " in the URL)").join("\n") +
				"\n       Deleted, moved to another file, or on a branch the token cannot read.\n" +
				"       Ask the designer before planning around the rest.",
		);
	}

	selected = requestedIds
		.filter((id) => nodeMap[id]?.document)
		.map((id) => ({ id, name: nodeMap[id].document.name, page: null }));
} else {
	let inventory;
	if (!a.refresh && existsSync(paths.figmaRaw)) {
		const cached = tryJson(paths.figmaRaw);
		inventory = cached?.document ? cached : null;
	}
	if (inventory) ok("using cached raw response (--refresh to re-fetch)");
	else {
		inventory = await api("/v1/files/" + fileKey + "?depth=" + DEPTH);
		write(paths.figmaRaw, JSON.stringify(inventory));
		ok("inventory fetched  " + fmtBytes(statSync(paths.figmaRaw).size));
	}

	fileMeta = { name: inventory.name, lastModified: inventory.lastModified };
	canvases = (inventory.document?.children ?? []).filter((n) => n.type === "CANVAS");
	if (canvases.length === 0) fail("No pages found in the file.");

	const screenRefs = [];
	for (const canvas of canvases) {
		for (const child of canvas.children ?? []) {
			if (child.type !== "FRAME" && child.type !== "SECTION" && child.type !== "COMPONENT")
				continue;
			screenRefs.push({ id: child.id, name: child.name, page: canvas.name });
		}
	}
	if (screenRefs.length === 0) fail("No top-level frames found — is this the right file or page?");
	framesTotal = screenRefs.length;

	selected = screenRefs;
	if (selected.length > MAX_SCREENS) {
		warn(
			selected.length + " frames found; fetching the first " + MAX_SCREENS + ".\n" +
				"       Pass the specific screens as node-id links instead — that is cheaper and exact.",
		);
		selected = selected.slice(0, MAX_SCREENS);
	}

	ok("pages " + canvases.length + "   frames " + screenRefs.length + "   fetching " + selected.length);

	const BATCH = 10;
	for (let i = 0; i < selected.length; i += BATCH) {
		const batch = selected.slice(i, i + BATCH);
		const res = await api("/v1/files/" + fileKey + "/nodes?ids=" + batch.map((b) => b.id).join(","));
		Object.assign(nodeMap, res.nodes ?? {});
		progress("fetching subtrees", Math.min(i + BATCH, selected.length), selected.length);
	}
	clearProgress();
}

if (selected.length === 0) fail("Nothing readable to digest.");

// ---- reduce --------------------------------------------------------------

let visited = 0;
const screens = [];
const flows = [];

for (const ref of selected) {
	const doc = nodeMap[ref.id]?.document;
	if (!doc) continue;

	const acc = {
		texts: [],
		interactions: [],
		componentProps: new Set(),
		variantStates: new Set(),
		imageFills: 0,
		vectorLeaves: 0,
		inputs: 0,
		repeatedGroups: 0,
	};
	walk(doc, acc, 0);

	for (const it of acc.interactions) flows.push({ from: ref.id, to: it.to, trigger: it.trigger });

	screens.push({
		id: ref.id,
		url: "https://www.figma.com/design/" + fileKey + "?node-id=" + ref.id.replace(":", "-"),
		name: ref.name,
		family: familyOf(ref.name),
		page: ref.page,
		devStatus: doc.devStatus?.type ?? "NONE",
		texts: dedupe(acc.texts).slice(0, 80),
		states: [...acc.variantStates].sort(),
		componentProps: [...acc.componentProps].sort(),
		signals: {
			hasList: acc.repeatedGroups > 0,
			repeatedGroups: acc.repeatedGroups,
			imageFills: acc.imageFills,
			vectorLeaves: acc.vectorLeaves,
			likelyInputs: acc.inputs,
			outgoing: acc.interactions.length,
		},
	});
}

// Rendering is deliberately opt-in. It costs another Figma API call and the
// architect should normally reason from text/states, not pixels. When visual
// layout is semantically important, keep small local PNGs for view_image.
const imageRenders = a["render-images"] ? await renderSelectedImages(fileKey, selected, RENDER_LIMIT) : [];

// N designs are never N screens. Collapsing "Cart / empty", "Cart / loading"
// and "Cart / error" back into one family is what keeps the endpoint count
// honest: a state is a response shape, not another route.
const families = new Map();
for (const s of screens) {
	if (!families.has(s.family)) families.set(s.family, []);
	families.get(s.family).push(s);
}
const screenFamilies = [...families.entries()]
	.map(([name, members]) => ({
		family: name,
		count: members.length,
		variants: members.map((m) => m.name),
		nodeIds: members.map((m) => m.id),
		devStatus: members.some((m) => m.devStatus === "READY_FOR_DEV") ? "READY_FOR_DEV" : members[0].devStatus,
		hasList: members.some((m) => m.signals.hasList),
		likelyInputs: Math.max(...members.map((m) => m.signals.likelyInputs)),
	}))
	.sort((x, y) => y.count - x.count || x.family.localeCompare(y.family));

// prototype entry points declared by the designer (broad mode only)
const entryPoints = [];
for (const canvas of canvases) {
	for (const fsp of canvas.flowStartingPoints ?? [])
		entryPoints.push({ nodeId: fsp.nodeId, name: fsp.name, page: canvas.name });
	if (canvas.prototypeStartNodeID)
		entryPoints.push({ nodeId: canvas.prototypeStartNodeID, name: "(legacy start)", page: canvas.name });
}

// ---- optional extras (never fatal) --------------------------------------

const selectedIds = new Set(selected.map((s) => s.id));

const comments = await optional("/v1/files/" + fileKey + "/comments", (r) =>
	(r.comments ?? [])
		.filter((c) => c.message && c.message.trim().length > 2)
		.slice(0, 200)
		.map((c) => ({
			nodeId: c.client_meta?.node_id ?? null,
			onSelectedScreen: selectedIds.has(c.client_meta?.node_id),
			message: c.message.trim().slice(0, 500),
			author: c.user?.handle ?? null,
		})),
);

const devResources = await optional("/v1/files/" + fileKey + "/dev_resources", (r) =>
	(r.dev_resources ?? []).map((d) => ({ nodeId: d.node_id, name: d.name, url: d.url })),
);

// Variables are Enterprise-only; a Dev seat gets 403. Swallow silently.
const variables = await optional("/v1/files/" + fileKey + "/variables/local", (r) =>
	Object.values(r.meta?.variableCollections ?? {}).map((c) => c.name),
);

// ---- write ---------------------------------------------------------------

const digest = {
	fileKey,
	name: fileMeta.name,
	lastModified: fileMeta.lastModified,
	fetchedAt: new Date().toISOString(),
	mode: TARGETED ? "targeted" : "broad",
	requestedLinks: urls.length,
	requestedNodeIds: requestedIds,
	stats: {
		pages: canvases.length || null,
		framesTotal,
		screensDigested: screens.length,
		screenFamilies: screenFamilies.length,
		flowEdges: flows.length,
		nodesVisited: visited,
	},
	entryPoints,
	screenFamilies,
	screens,
	flows,
	imageRenders,
	comments: comments ?? [],
	devResources: devResources ?? [],
	variableCollections: variables ?? null,
};

write(paths.figmaDigest, JSON.stringify(digest, null, 2) + "\n");

const rawSize = statSync(paths.figmaRaw).size;
const digestSize = statSync(paths.figmaDigest).size;

info("");
ok("screens        " + screens.length);
ok("families       " + screenFamilies.length + style.dim("  (states collapsed)"));
ok("flow edges     " + flows.length);
if (entryPoints.length) ok("entry points   " + entryPoints.length);
ok("comments       " + (comments?.length ?? 0));
if (variables === null) info(style.dim("  --    variables      unavailable (Enterprise-only)"));
info("");

const top = screenFamilies.filter((f) => f.count > 1).slice(0, 8);
if (top.length) {
	info(style.bold("  families with several states"));
	for (const f of top) info("    " + String(f.count).padStart(2) + "x  " + f.family);
	info("");
}

ok("wrote " + paths.figmaDigest);
ok(
	"raw " + fmtBytes(rawSize) + " -> digest " + fmtBytes(digestSize) +
		(rawSize > digestSize
			? "  (" + (rawSize / Math.max(digestSize, 1)).toFixed(1) + "x smaller)"
			: ""),
);

const ready = screens.filter((s) => s.devStatus === "READY_FOR_DEV").length;
if (ready) ok(ready + " screen(s) marked READY_FOR_DEV — use this to order the backlog");
info("");
info(style.dim("  This digest is what models read. Never paste figma.raw.json into a context."));
info("");

// -------------------------------------------------------------------------

function walk(node, acc, depth) {
	if (visited++ > MAX_NODES) return;
	if (node.visible === false) return;

	if (node.type === "TEXT" && node.characters) {
		const t = node.characters.trim();
		if (t) acc.texts.push(t.length > 200 ? t.slice(0, 200) + "..." : t);
		if (/^(введите|enter|type|поиск|search|e-?mail|телефон)/i.test(t)) acc.inputs++;
	}

	if (node.type === "VECTOR" || node.type === "BOOLEAN_OPERATION") acc.vectorLeaves++;
	for (const f of node.fills ?? []) if (f.type === "IMAGE") acc.imageFills++;

	if (node.componentPropertyDefinitions) {
		for (const [key, def] of Object.entries(node.componentPropertyDefinitions)) {
			acc.componentProps.add(key.split("#")[0]);
			for (const v of def.variantOptions ?? []) acc.variantStates.add(v);
		}
	}
	// variant names like "state=empty" live on the node name
	if (typeof node.name === "string" && node.name.includes("=")) {
		for (const part of node.name.split(",")) {
			const [k, v] = part.split("=").map((s) => s?.trim());
			if (k && v && /state|status|variant|тип|состояние/i.test(k)) acc.variantStates.add(v);
		}
	}

	for (const inter of node.interactions ?? []) {
		for (const action of inter.actions ?? []) {
			if (action.destinationId)
				acc.interactions.push({ to: action.destinationId, trigger: inter.trigger?.type ?? "UNKNOWN" });
		}
	}
	if (node.transitionNodeID) acc.interactions.push({ to: node.transitionNodeID, trigger: "LEGACY" });

	const children = node.children ?? [];
	// A run of same-shaped siblings is a list, therefore pagination.
	if (children.length >= 3) {
		const shapes = children.map((c) => c.type + ":" + (c.children?.length ?? 0));
		const counts = new Map();
		for (const s of shapes) counts.set(s, (counts.get(s) ?? 0) + 1);
		if ([...counts.values()].some((n) => n >= 3)) acc.repeatedGroups++;
	}
	for (const child of children) walk(child, acc, depth + 1);
}

/** "Cart / empty" and "Cart / loading" are one screen with two states. */
function familyOf(rawName) {
	const name = String(rawName ?? "").trim();
	if (!name) return "(unnamed)";
	// drop Figma variant syntax: "Cart, state=empty, size=lg"
	const noVariant =
		name
			.split(",")
			.filter((p) => !/^\s*[^=]+=/.test(p))
			.join(",")
			.trim() || name;
	const parts = noVariant.split(/\s*[\/|·—–]\s*/).filter(Boolean);
	while (parts.length > 1 && isStateSegment(parts[parts.length - 1])) parts.pop();
	return parts.join(" / ") || name;
}

function isStateSegment(segment) {
	const s = segment
		.trim()
		.toLowerCase()
		.replace(/\b(state|состояние|стейт|вид)\b/g, "")
		.replace(/[()\[\]]/g, "")
		.trim();
	if (!s) return false;
	if (STATE_WORDS.has(s)) return true;
	const words = s.split(/\s+/);
	return words.length <= 2 && words.some((w) => STATE_WORDS.has(w));
}

function dedupe(arr) {
	return [...new Set(arr)];
}

function parseUrl(u) {
	const key = u.match(/\/(?:file|design|proto|board)\/([a-zA-Z0-9]+)/);
	// URLs write node ids as 6301-6506 (or url-encoded 6301%3A6506); the API
	// wants 6301:6506. The separator must be an alternation, never a character
	// class: [-:%3A] also matches the literal digit 3, which silently turns
	// 6823-3364 into 6823:64 for exactly those ids whose second half starts
	// with a 3 — a ~10% corruption rate that looks like "missing frames".
	const node = u.match(/node[-_]?id=([0-9]+)(?:-|:|%3A)([0-9]+)/i);
	return {
		fileKey: key ? key[1] : /^[a-zA-Z0-9]{10,}$/.test(u) ? u : null,
		nodeId: node ? node[1] + ":" + node[2] : null,
	};
}

function tryJson(file) {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return null;
	}
}

function progress(label, done, total) {
	if (!process.stdout.isTTY) return;
	process.stdout.write(style.dim("\r  " + label + " " + done + "/" + total));
}

function clearProgress() {
	if (!process.stdout.isTTY) return;
	process.stdout.write("\r" + " ".repeat(48) + "\r");
}

async function api(path, { retries = 3 } = {}) {
	for (let attempt = 0; ; attempt++) {
		let res;
		try {
			res = await fetch(API_BASE + path, { headers: { "X-Figma-Token": TOKEN } });
		} catch (e) {
			if (attempt < retries) {
				await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
				continue;
			}
			fail("Cannot reach " + API_BASE + " — " + (e?.cause?.code ?? e?.message ?? "network error"));
		}
		if (res.status === 429 && attempt < retries) {
			const wait = Number(res.headers.get("retry-after") ?? 2 ** attempt) * 1000;
			warn("rate limited, retrying in " + wait / 1000 + "s");
			await new Promise((r) => setTimeout(r, wait));
			continue;
		}
		if (res.status === 403)
			fail(
				"403 from Figma for " + path + "\n" +
					"The token lacks a scope, or the file belongs to another organisation.",
			);
		if (res.status === 404) fail("404 from Figma — wrong file key, or no access.");
		if (!res.ok) fail("Figma API " + res.status + " for " + path + ": " + (await res.text()).slice(0, 300));
		return res.json();
	}
}

/** Best-effort call: returns null instead of throwing (403 on Enterprise-only routes). */
async function optional(path, map) {
	try {
		const res = await fetch(API_BASE + path, { headers: { "X-Figma-Token": TOKEN } });
		if (!res.ok) return null;
		return map(await res.json());
	} catch {
		return null;
	}
}

async function renderSelectedImages(key, refs, limit) {
	const chosen = refs.slice(0, Math.max(0, limit));
	if (!chosen.length) return [];
	const ids = chosen.map((r) => r.id).join(",");
	try {
		const res = await fetch(API_BASE + "/v1/images/" + key + "?ids=" + ids + "&format=png&scale=1", {
			headers: { "X-Figma-Token": TOKEN },
		});
		if (!res.ok) {
			warn("could not render Figma nodes (" + res.status + "); continuing without images");
			return [];
		}
		const body = await res.json();
		const dir = resolve(paths.raw, "figma-images");
		mkdirSync(dir, { recursive: true });
		const saved = [];
		for (const ref of chosen) {
			const imageUrl = body.images?.[ref.id];
			if (!imageUrl) continue;
			const image = await fetch(imageUrl);
			if (!image.ok) continue;
			const bytes = Buffer.from(await image.arrayBuffer());
			const safe = ref.id.replace(":", "-");
			const path = "figma-images/" + safe + ".png";
			writeFileSync(resolve(paths.raw, path), bytes);
			saved.push({ nodeId: ref.id, path });
		}
		if (saved.length) ok("rendered images  " + saved.length + " -> raw/figma-images/");
		return saved;
	} catch (e) {
		warn("could not render Figma nodes (" + (e?.message ?? "network error") + "); continuing without images");
		return [];
	}
}

function fmtBytes(n) {
	if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
	if (n > 1024) return (n / 1024).toFixed(0) + " KB";
	return n + " B";
}
