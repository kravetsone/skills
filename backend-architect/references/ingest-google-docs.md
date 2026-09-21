# Ingesting the spec

Goal: get the ТЗ onto disk as `.backend-plan/raw/spec.md`, verbatim, with recorded provenance. No interpretation at this stage.

```bash
node backend-architect/scripts/docs-pull.mjs "https://docs.google.com/document/d/<id>/edit"
node backend-architect/scripts/docs-pull.mjs --file ./tz.docx      # manual drop
node backend-architect/scripts/docs-pull.mjs --file ./spec.pdf
```

## The Google Docs trap

A Google Doc that is not link-shared returns **HTTP 200 with an HTML sign-in page**. Status-code checks pass, `curl -f` succeeds, and you end up extracting requirements from Google's login form. The script therefore validates by *content shape*:

- the body contains `accounts.google.com`, `ServiceLogin`, or sign-in form markers, or
- the body is HTML when Markdown was requested, or
- the result is implausibly short (under 512 bytes) for a specification.

Any of those is treated as a failure, with a message telling the human exactly what to do.

## Export formats, in order

For a document id `D`, the script tries:

1. `/export?format=md` — best; preserves headings, tables and lists.
2. `/export?format=txt` — loses table structure; acceptable fallback.
3. `/export?format=docx` — saved as a binary for local conversion.

Tables matter more than you expect: economy constants, reward tiers and limits live in tables, and losing their structure turns "+2 XP for articles, +5 for tasks" into an unresolvable blur. If only `txt` succeeds, flag it in `spec.meta.json` and expect more Gate-1 questions.

Google's Markdown export may inline pasted images as `data:image/...;base64` payloads.
`docs-pull.mjs` extracts those to `raw/spec-images/` and replaces the payload with a relative
path. This keeps model context small while preserving visual evidence. The cheap extractor may
use `view_image` on an image when the surrounding text indicates a flow, table, state mockup
or annotated rule; it should skip brand decoration and record uncertain visual readings as
questions.

## When it is private (the common case)

Do not attempt to authenticate. Ask the human for one of:

1. **File → Download → Markdown (.md)**, then `docs-pull.mjs --file <path>` — preferred, highest fidelity.
2. **Share → Anyone with the link → Viewer**, then re-run with the URL.
3. Paste the text directly; you write it to `raw/spec.md` and set `source: "pasted"`.

Recommend option 1. It takes the human fifteen seconds and removes an entire class of silent failure.

## Other sources

| Source | Approach |
| --- | --- |
| Notion | Export to Markdown and CSV, unzip, `--file` the `.md`. Keep the CSVs — they are usually the economy tables. |
| Confluence | Export to Word, or copy-paste. |
| PDF | `--file spec.pdf`; the script extracts text if `pdftotext` exists, otherwise it tells you to convert. |
| docx | `--file`; converted via `pandoc` when available, otherwise a raw XML text-extraction fallback. |
| Plain md / txt | copied through untouched. |

## Provenance record

`spec.meta.json` captures `source`, `method` (export-md, file, or pasted), `fetchedAt`, `bytes`, `sha256`. The hash is how you detect that the spec changed under you between Gate 1 and Gate 2 — re-run the pipeline from stage 2 when it does, and say so.

## Multi-document specs

Common: a main ТЗ, a separate analytics document, and a separate content or copy sheet. Pull each into `raw/spec.<slug>.md` and concatenate into `raw/spec.md` with `# === SOURCE: <name> ===` separators, so citations can name a document as well as a section. Pull the analytics document separately in particular — it feeds [analytics.md](analytics.md) directly.
