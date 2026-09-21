#!/usr/bin/env node
// Pull the spec into .backend-plan/raw/spec.md with provenance.
// Detects Google's login-page-with-200 failure by content shape, not status code.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { args, fail, info, ok, paths, style, warn, write } from "./lib/plan.mjs";

const a = args();
const target = a.file ?? a._[0];

if (!target || a.help) {
	info(
		[
			"Usage:",
			"  node docs-pull.mjs <google-docs-url>",
			"  node docs-pull.mjs --file <path.md|.txt|.docx|.pdf>",
			"",
			"Options:",
			"  --slug <name>   write to raw/spec.<slug>.md instead of raw/spec.md",
			"                  (use for a separate analytics or content document)",
		].join("\n"),
	);
	process.exit(target || a.help ? 0 : 1);
}

const outFile = a.slug
	? paths.spec.replace(/spec\.md$/, "spec." + a.slug + ".md")
	: paths.spec;

const result = a.file ? await fromFile(resolve(String(target))) : await fromUrl(String(target));

	const compact = compactEmbeddedImages(result.text);
	write(outFile, compact.text);
	write(
		a.slug ? outFile.replace(/\.md$/, ".meta.json") : paths.specMeta,
		JSON.stringify(
			{
			source: result.source,
			method: result.method,
			fetchedAt: new Date().toISOString(),
				bytes: Buffer.byteLength(compact.text, "utf8"),
				originalBytes: Buffer.byteLength(result.text, "utf8"),
				sha256: createHash("sha256").update(compact.text).digest("hex"),
				embeddedImages: compact.images,
				warnings: [...(result.warnings ?? []), ...compact.warnings],
		},
		null,
		2,
	) + "\n",
);

info("");
ok("wrote    " + outFile);
ok("method   " + result.method);
	ok("size     " + Buffer.byteLength(compact.text, "utf8").toLocaleString() + " bytes");
	for (const w of [...(result.warnings ?? []), ...compact.warnings]) warn(w);
info("");
info(style.dim("  Next: stage 2 — spawn the facts extractor (references/model-tiering.md)"));
info("");

// -------------------------------------------------------------------------

function docIdFrom(url) {
	const m = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
	return m ? m[1] : null;
}

/**
 * A private Google Doc answers 200 with a sign-in page. Validate by shape.
 * Returns a reason string when the body is not a real document.
 */
function rejectReason(text, wantedMarkdown) {
	const head = text.slice(0, 4000);
	if (/accounts\.google\.com|ServiceLogin|identifier[A-Za-z]*Id|"signin"/i.test(head))
		return "Google returned a sign-in page (the document is not link-shared).";
	if (wantedMarkdown && /^\s*<(!doctype|html)/i.test(head))
		return "Got HTML where Markdown was requested (almost always a login or error page).";
	if (text.trim().length < 512)
		return "Response is implausibly short (" + text.trim().length + " bytes) for a specification.";
	return null;
}

/**
 * Google Docs' Markdown exporter inlines pasted images as data URLs. They can
 * be megabytes of base64 with no backend signal at all, and they make a cheap
 * extraction model spend context on pixels it cannot inspect. Keep the fact
 * that an image was present (its ordinal and media type), remove the payload.
 */
function compactEmbeddedImages(text) {
	let count = 0;
	const warnings = [];
	const images = [];
	const imageDir = resolve(paths.raw, "spec-images");
	const compact = text.replace(
		/data:image\/([a-z0-9.+-]+);base64,[A-Za-z0-9+/=\s]+/gi,
		(_, type) => {
			count++;
			const extension = type.toLowerCase().replace("jpeg", "jpg").replace(/[^a-z0-9]/g, "") || "bin";
			const relative = "spec-images/image-" + count + "." + extension;
			images.push({ id: count, type: type.toLowerCase(), path: relative });
			// Return only the relative path. This works both for inline
			// `![](data:...)` images and for Google export definitions:
			// `[image1]: <data:...>`.
			return relative;
		},
	);
	if (count) {
		mkdirSync(imageDir, { recursive: true });
		let imageIndex = 0;
		text.replace(
			/data:image\/([a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)/gi,
			(_, type, payload) => {
				imageIndex++;
				const extension = type.toLowerCase().replace("jpeg", "jpg").replace(/[^a-z0-9]/g, "") || "bin";
				const bytes = Buffer.from(payload.replace(/\s/g, ""), "base64");
				writeFileSync(resolve(imageDir, "image-" + imageIndex + "." + extension), bytes);
				return _;
			},
		);
		const saved = Buffer.byteLength(text, "utf8") - Buffer.byteLength(compact, "utf8");
		warnings.push(
			"Extracted " + count + " embedded image payload(s) to .backend-plan/raw/spec-images/ (" +
				formatBytes(saved) + " removed from the text context). The cheap model should inspect " +
				"them with view_image only when layout or visual content changes the backend plan.",
		);
	}
	return { text: compact, images, warnings };
}

function formatBytes(n) {
	if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
	if (n > 1024) return (n / 1024).toFixed(0) + " KB";
	return n + " B";
}

async function fromUrl(url) {
	const id = docIdFrom(url);
	if (!id) {
		// Not a Google Doc — fetch it plainly and let the shape check decide.
		const res = await fetch(url, { redirect: "follow" });
		const text = await res.text();
		const reason = rejectReason(text, false);
		if (reason) fail(reason + "\n\n" + manualInstructions(url));
		return { text, source: url, method: "fetch", warnings: [] };
	}

	const attempts = [
		["export-md", "https://docs.google.com/document/d/" + id + "/export?format=md", true],
		["export-txt", "https://docs.google.com/document/d/" + id + "/export?format=txt", false],
	];

	const problems = [];
	for (const [method, exportUrl, wantsMd] of attempts) {
		let text;
		try {
			const res = await fetch(exportUrl, { redirect: "follow" });
			text = await res.text();
		} catch (e) {
			problems.push(method + ": " + e.message);
			continue;
		}
		const reason = rejectReason(text, wantsMd);
		if (reason) {
			problems.push(method + ": " + reason);
			continue;
		}
		const warnings = [];
		if (method === "export-txt")
			warnings.push(
				"Plain-text export: table structure is lost. Economy constants and reward tiers " +
					"often live in tables — expect more Gate-1 questions, and prefer a Markdown download.",
			);
		return { text, source: url, method, warnings };
	}

	fail(
		"Could not export the document.\n  " + problems.join("\n  ") + "\n\n" + manualInstructions(url),
	);
}

function manualInstructions(url) {
	return [
		style.bold("The document is private. Ask for one of these:"),
		"",
		"  1. " + style.green("File > Download > Markdown (.md)") + "   <- recommended",
		"     then:  node backend-architect/scripts/docs-pull.mjs --file <path>",
		"",
		"  2. Share > Anyone with the link > Viewer, then re-run:",
		"     node backend-architect/scripts/docs-pull.mjs " + JSON.stringify(url),
		"",
		"  3. Paste the text and write it to " + paths.spec + " directly.",
	].join("\n");
}

async function fromFile(path) {
	if (!existsSync(path)) fail("File not found: " + path);
	const ext = extname(path).toLowerCase();
	const warnings = [];

	if (ext === ".md" || ext === ".txt" || ext === ".markdown") {
		return { text: readFileSync(path, "utf8"), source: path, method: "file", warnings };
	}

	if (ext === ".pdf") {
		const text = tryCommand("pdftotext", ["-layout", path, "-"]);
		if (text === null)
			fail(
				"pdftotext is not available.\n" +
					"Convert the PDF first, e.g.:  pdftotext -layout " +
					JSON.stringify(path) +
					" spec.txt\n" +
					"then:  node backend-architect/scripts/docs-pull.mjs --file spec.txt",
			);
		warnings.push("PDF extraction: verify tables survived; they usually do not.");
		return { text, source: path, method: "pdftotext", warnings };
	}

	if (ext === ".docx") {
		const viaPandoc = tryCommand("pandoc", ["-t", "gfm", path]);
		if (viaPandoc !== null)
			return { text: viaPandoc, source: path, method: "pandoc", warnings };
		const stripped = docxFallback(path);
		warnings.push(
			"pandoc not found; used a raw XML text extraction. Formatting and tables are lost. " +
				"Install pandoc, or ask for a Markdown download.",
		);
		return { text: stripped, source: path, method: "docx-fallback", warnings };
	}

	// Unknown extension: treat as text if it decodes cleanly.
	const buf = readFileSync(path);
	if (buf.includes(0)) fail("Unsupported binary file: " + basename(path));
	return { text: buf.toString("utf8"), source: path, method: "file", warnings };
}

function tryCommand(cmd, cmdArgs) {
	try {
		return execFileSync(cmd, cmdArgs, {
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
			stdio: ["ignore", "pipe", "ignore"],
		});
	} catch {
		return null;
	}
}

/** Last-resort .docx text extraction: unzip word/document.xml and strip tags. */
function docxFallback(path) {
	const xml = tryCommand("unzip", ["-p", path, "word/document.xml"]);
	if (xml === null)
		fail("Could not read the .docx (no pandoc and no unzip). Ask for a Markdown export.");
	return xml
		.replace(/<w:p[ >]/g, "\n<w:p ")
		.replace(/<[^>]+>/g, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
