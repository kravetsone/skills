# Pipeline — stage contracts

Every stage has a defined input, output, model tier, and exit condition. A stage may not start until the previous one's output file exists and is non-empty. The whole thing is resumable: state is files on disk, not conversation memory.

## Workspace layout

```
.backend-plan/
├── plan.json              # mode, name, stage cursor, model map
├── raw/
│   ├── spec.md            # stage 1 — the ТЗ, verbatim
│   ├── spec.meta.json     # source url, fetch method, byte count
│   ├── figma.raw.json     # stage 1 — trimmed API responses (may be large)
│   └── figma.digest.json  # stage 1 — the reduced graph (this is what models see)
├── ledger/
│   ├── facts.md           # stage 2 — REQ-### numbered requirements
│   ├── screens.md         # stage 2 — SCR-### screens + data needs
│   ├── questions.md       # stage 3 — open questions + contradictions
│   └── decisions.md       # gate answers, appended, never rewritten
├── design/
│   ├── domain.md          # stage 4 — entities, invariants, lifecycles
│   ├── adr/ADR-###.md     # stage 4 — one file per decision
│   └── hotspots.md        # stage 4 — H-### race register
└── out/
    ├── BACKEND-PLAN.md
    ├── openapi.yaml
    ├── schema.draft.ts
    ├── analytics.md
    └── BACKLOG.md
```

---

## Stage 0 — init

`node backend-architect/scripts/plan-init.mjs --name <slug> --mode api|bot|both`

Creates the tree above and `plan.json`. Idempotent — re-running never destroys existing content, it only fills gaps and reports what is already there.

Ask the human for `--mode` if it is not obvious from the spec. "Telegram Mini App" almost always means `both`: the Mini App needs REST, and the bot needs commands/scenes to get the user into it.

---

## Stage 1 — ingest (no model)

Two independent scripts. Run them in parallel. **Neither one's raw output is ever pasted into a model context.**

### 1a. Spec

`node backend-architect/scripts/docs-pull.mjs <url|--file path>`

Writes `raw/spec.md`. Google Docs served to an unauthenticated client returns **HTTP 200 with a login page**, so success is detected by content shape, not status code. Details and the manual fallback: [ingest-google-docs.md](ingest-google-docs.md).

### 1b. Figma

`node backend-architect/scripts/figma-digest.mjs <url> [--depth 2] [--max-nodes 4000]`

Writes `raw/figma.digest.json` — a reduction of the file to the things a backend cares about: page and frame names, the prototype flow graph, `devStatus` markers, text content per screen, component property definitions, and detected list/empty/error/loading states. A 40 MB file document becomes a 40–200 KB digest. Details: [ingest-figma.md](ingest-figma.md).

**Exit condition:** both files exist, or the human has explicitly said one input does not exist (some projects have no Figma; some have no written spec — then say so in the plan's Sources section and expect more open questions).

---

## Stage 2 — extract (cheap model)

Two subagents, spawned with `fork_turns: "none"` and an explicit cheap model. See [model-tiering.md](model-tiering.md) for the exact spawn contract.

### 2a. Facts ledger — `ledger/facts.md`

Input: `raw/spec.md`. Output: numbered requirements, one atomic statement each.

```markdown
| ID | Requirement | Source | Type | Concurrency? |
| --- | --- | --- | --- | --- |
| REQ-001 | A user may claim an article reward exactly once. | §3.2 "Статьи" | rule | yes |
| REQ-002 | Reward is +2 experience. | §3.2 table | constant | no |
| REQ-003 | Promo codes come from a finite pre-loaded pool. | §5.1 | rule | yes |
```

Rules for the extractor:

- One requirement per row. "Users can buy a box and receive a promo code" is two rows.
- `Type` ∈ `rule | constant | entity | flow | integration | nfr | analytics`.
- `Concurrency?` = yes when the requirement involves a limited resource, a counter, a one-shot action, an external side effect, or a schedule. This column seeds stage 4's hotspot register.
- Anything stated vaguely ("быстро", "много пользователей", "надёжно") becomes a row with `Type: nfr` **and** a question in stage 3.
- Never resolve an ambiguity. Record both readings.

### 2b. Screen ledger — `ledger/screens.md`

Input: `raw/figma.digest.json`. Output: per screen — what data it displays, what actions it offers, what states it has.

**One `SCR-###` per `family`, not per frame.** The digest already collapsed
`Коробки / empty` and `Коробки / loading` into the family `Коробки`; the ledger keeps that
shape, and the variants become the States line. Emitting one SCR per link is how a 48-frame
handover turns into a 48-endpoint plan that nobody can build.

```markdown
### SCR-012 — Коробки (3 frames: 431:2210, 431:2280, 433:1104 — devStatus READY_FOR_DEV)
- **Displays:** list of boxes: image, name, description, price (XP), stock badge
- **Actions:** tap box → SCR-013 (confirm purchase)
- **States seen in file:** default, empty ("Пока нет коробок"), out-of-stock badge, error toast
- **Implied reads:** list of boxes with derived available-count
- **Implied writes:** none on this screen
```

The value here is the **states**. Designers draw the empty state, the error toast, and the disabled button — those are the API's error contract, and they are usually missing from the written spec. Harvest them aggressively.

**Exit condition:** both ledgers non-empty. Report counts to the human, including the
reduction, because it is the number a reviewer checks first:
`47 requirements, 48 links → 34 frames → 23 screens, 61 flow edges`.
Report unreadable node ids separately — they are questions, not noise.

---

## Stage 3 — reconcile

`node backend-architect/scripts/merge-facts.mjs`

Mechanical pass first: the script cross-references the two ledgers and flags

- screens with implied reads that no `REQ` describes → **spec gap**
- requirements with no screen → **headless requirement** (fine for bots/webhooks, suspicious for a Mini App)
- numeric constants that appear in both with different values → **contradiction**
- `Concurrency? = yes` rows → pre-seeded hotspot candidates

Then a cheap model turns those into `ledger/questions.md`, grouped:

```markdown
## Contradictions (must resolve)
| # | Spec says | Figma says | Impact |
| C1 | reward +2 XP (§3.2) | badge shows "+5" (node 12:88) | wrong economy constant |

## Gaps (must answer)
| # | Question | Why it matters | Default if unanswered |
| G1 | Can a promo code be re-issued if the user deletes the account? | changes uniqueness key on promo_codes | assume no |

## Assumptions I want to make (confirm or correct)
| # | Assumption | Basis |
| A1 | One pet of each type per user | Figma shows exactly two slots (node 88:12) |
```

Every gap gets a **"default if unanswered"** — so the human can bulk-approve the boring ones and argue only with the interesting ones.

---

## ══ GATE 1 — facts ══

**Hard stop.** Present to the human:

1. the counts (requirements, screens, flows),
2. the contradictions table — every row needs an answer,
3. the gaps table — each with its proposed default,
4. the assumptions table.

Use `request_user_input` when available, with 2–4 mutually exclusive options and a recommendation, for the decisions that fork the design. Use plain questions for the rest. Append answers verbatim to `ledger/decisions.md` with a timestamp — this file is the audit trail that makes the plan defensible later.

Do not proceed while a contradiction is unresolved. A contradiction silently resolved becomes a bug with a two-month latency.

---

## Stage 4 — design (expensive model)

Input: `ledger/*.md` only. **Never** `raw/`. If the architect needs a detail that is only in the raw layer, it asks the cheap tier to fetch it — that is what stage 2's agents are still alive for.

Order matters. Do not shortcut to endpoints.

1. **Domain model** → `design/domain.md`. Entities, their identity (what makes two rows the same thing in the real world), lifecycle states, and **invariants written as sentences that must be true at every commit boundary**. "A user's balance is never negative." "A promo code belongs to at most one user." These sentences become CHECK constraints, unique indexes, and tests. [data-model.md](data-model.md)
2. **Race hotspot register** → `design/hotspots.md`. Walk every invariant and ask: what two concurrent requests break this? Classify against the 12-class taxonomy and assign the database-level mechanism. This happens *before* API design because it changes endpoint shapes (it is what forces `POST /boxes/:id/purchase` to return the code in the same response rather than a separate fetch). [race-conditions.md](race-conditions.md)
3. **ADRs** → `design/adr/ADR-###.md`. One per decision that a competent engineer could reasonably disagree with. Template: `templates/adr.md`. Minimum set for any project: identity/auth model, idempotency strategy, job/schedule strategy, media storage, analytics transport, and any stack deviation.
4. **API surface** → held in memory until stage 5. [api-design.md](api-design.md) / [bot-mode.md](bot-mode.md)

---

## ══ GATE 2 — architecture ══

**Hard stop.** Present the ADR list as one-line summaries with the chosen option and the main tradeoff, plus the hotspot register as a table. Ask specifically:

- "Is this domain model how you think about the product?" — a mismatch here is the expensive one.
- Each ADR: accept / change / discuss.
- Each hotspot: is the failure mode I described actually possible in your product?

---

## Stage 5 — emit (expensive model)

Produce the five artefacts. Exact required sections and formats: [deliverables.md](deliverables.md). Write in the language of the source spec — if the ТЗ is Russian, the plan is Russian; identifiers, table names, and endpoint paths stay English.

---

## Stage 6 — verify (no model)

```bash
node backend-architect/scripts/hotspot-scan.mjs    # every H-### has a DB-level mechanism
node backend-architect/scripts/plan-lint.mjs       # 12 anti-pattern groups, env names, citations
node backend-architect/scripts/coverage-report.mjs # every REQ and SCR maps to an endpoint/job/table
```

All three must exit 0. A non-zero exit is not a formality — `coverage-report` failing means a requirement has no implementation surface, which means the plan is incomplete, not merely untidy.

---

## Stage 7 — land

Copy into the target repo:

- `out/BACKEND-PLAN.md` → `docs/backend-plan.md`
- `out/analytics.md` → `docs/analytics.md` (the single source of truth; see [analytics.md](analytics.md))
- `out/openapi.yaml` → `docs/openapi.yaml` (as a target contract; the runtime one is generated by Elysia)
- endpoint table + patterns → `AGENTS.md` / `CLAUDE.md` using `templates/AGENTS.md`
- `out/BACKLOG.md` → issue tracker, one item per row

The `AGENTS.md` endpoint table carries a standing instruction — *"keep this updated"* — because the table is what every future agent session reads first.
