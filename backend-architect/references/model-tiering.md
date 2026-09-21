# Model tiering — who reads what

The economics of this pipeline are simple: Figma JSON and a 40-page ТЗ are enormous and mostly boring, while the architecture work is small and hard. Paying frontier-model rates to read 300 KB of node geometry is waste; doing the domain design with a cheap model is malpractice. So the pipeline splits them.

## The rule

> **Raw inputs never enter the architect's context.** The architect reads ledgers.

Stage 1 scripts reduce. Stage 2 cheap models summarise into ledgers. Stages 4–5 the expensive model reads only `.backend-plan/ledger/**`. If the architect needs a detail that exists only in the raw layer, it asks the extraction agent — which still has it — rather than loading the file.

## Spawn mechanics (important, easy to get wrong)

A model override is honoured **only when the subagent does not inherit the parent's history**:

| fork_turns | model / reasoning_effort override | Context the child sees |
| --- | --- | --- |
| omitted or all | **ignored** — inherits parent's model | everything |
| none | **applied** | only your message |
| "3" (positive integer string) | **applied** | the last N turns |

So every tiering spawn uses `fork_turns: "none"` and a **self-contained** message: absolute file paths in, absolute file path out, the format spec inline, and the reference paths to read. Skills do not auto-load in subagent sessions — if the child must follow [requirements-extraction.md](requirements-extraction.md), give it the path explicitly.

## The map

| Stage | Work | Tier | Codex model | Claude Code equivalent |
| --- | --- | --- | --- | --- |
| 1 | ingest | — | none (scripts) | none |
| 2a | ТЗ → facts ledger | cheap | `gpt-5.6-terra` | Sonnet |
| 2b | Figma digest → screen ledger | cheap | `gpt-5.6-terra` | Sonnet |
| 3 | gaps and contradictions prose | cheapest | `gpt-5.6-luna` | Haiku |
| 4 | domain model, hotspots, ADRs | expensive | `gpt-5.6-sol` | Opus |
| 5 | plan, OpenAPI, schema, backlog | expensive | `gpt-5.6-sol` | Opus |
| 6 | lint | — | none (scripts) | none |

Concurrency is bounded (4 slots in Codex, parent included). Stages 2a and 2b run in parallel; that is the only parallelism worth having here.

## Spawn templates

### Stage 2a — facts extractor

```yaml
task_name: extract_facts
model: gpt-5.6-terra
fork_turns: "none"
message: |
  Read <ABS>/.backend-plan/raw/spec.md — a product specification.
  Read <ABS>/backend-architect/references/requirements-extraction.md and follow it exactly.
  If <ABS>/.backend-plan/raw/spec-images/ exists, inspect only images whose surrounding
  text suggests a flow, table, state or rule. Use `view_image` on those files; skip decorative
  brand images. Cite the image path for visual facts and put uncertain readings in questions.

  Produce <ABS>/.backend-plan/ledger/facts.md: a markdown table with columns
  ID | Requirement | Source | Type | Concurrency?

  - One atomic requirement per row, numbered REQ-001 upward.
  - Source = the section/heading/page you took it from. A row without a source is forbidden.
  - Type is one of: rule, constant, entity, flow, integration, nfr, analytics.
  - Concurrency? = yes when it involves a limited resource, a counter, a one-shot
    action, an external side effect, or a schedule.
  - Never resolve an ambiguity: record both readings as separate rows and mark them.
  - Below the table add "## Verbatim numbers" listing every number, price, limit,
    timeout and TTL you saw, each with its source.

  Do not design anything. Do not propose endpoints. Extraction only.
  Reply with counts only: how many rows, how many ambiguities.
```

### Stage 2b — screen extractor

```yaml
task_name: extract_screens
model: gpt-5.6-terra
fork_turns: "none"
message: |
  Read <ABS>/.backend-plan/raw/figma.digest.json — an already-reduced Figma digest.
  Read <ABS>/backend-architect/references/ingest-figma.md and follow it exactly.
  If <ABS>/.backend-plan/raw/figma-images/ exists because image rendering was explicitly
  requested, inspect only the listed renders with `view_image`; never load `figma.raw.json`.

  Produce <ABS>/.backend-plan/ledger/screens.md.

  - Iterate over `screenFamilies`, NOT over `screens`. One SCR-### per family.
    The individual frames of a family are its drawn states, and states are
    response shapes, not separate screens.
  - Heading: `### SCR-### — <family> (N frames: <node ids> — devStatus <…>)`
  - Then: Displays / Actions / States seen in file / Implied reads / Implied writes.
  - Harvest every empty-state and error string verbatim — that is the error contract.
  - `hasList: true` means a pagination question. `likelyInputs > 0` means a write.
  - Never invent a screen that is not in the digest, and never merge two families
    that merely share a prefix — note the suspicion instead.

  Do not design endpoints. Extraction only.
  Reply with counts only: families in, SCR rows out, and any family whose
  purpose you could not determine.
```

Tell it explicitly: **the digest is already reduced — do not ask for the raw file.** If the
digest reported unreadable node ids, those do not belong to this subagent; they go straight to
`ledger/questions.md` as questions for the designer.

### Stage 4 — architect

Usually *you*, the orchestrator, rather than a subagent — the gates are conversational and the human is talking to you. If you do delegate it, the message must carry the full ledger paths plus `race-conditions.md`, `api-design.md`, `data-model.md` and `platform-contract.md`, and the child must be told to stop at Gate 2 rather than emitting.

## Budget sanity

A typical Mini-App project: Figma file 15–60 MB raw, 60–200 KB digest, ~8 KB screen ledger. ТЗ 20–60 KB, ~6 KB facts ledger. The architect therefore works from roughly **15 KB of dense, sourced input** instead of 40 MB of noise. That ratio is the whole point of the pipeline; if you find yourself pasting raw Figma into the architect's context, the pipeline has failed and the output will not be better for it — it will be worse, because the signal is buried.

## When to collapse the pipeline

Tiering is overhead. Skip it and do everything in one context when:

- there is no Figma, and the ТЗ is under ~10 KB;
- you are reviewing an existing codebase rather than planning a new one;
- the user wants an answer in minutes, not a durable artefact.

Say that you are collapsing it and why. The gates still apply — those are about correctness, not cost.
