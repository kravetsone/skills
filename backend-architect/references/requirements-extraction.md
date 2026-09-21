# Requirements extraction and traceability

The output of this stage is not a summary. It is a **ledger**: numbered, atomic, sourced statements that later artefacts cite. Traceability is what makes the plan auditable — and what makes `coverage-report.mjs` able to prove nothing was dropped.

## The identifier scheme

| Prefix | Meaning | Lives in |
| --- | --- | --- |
| `REQ-###` | a requirement from the written spec | `ledger/facts.md` |
| `SCR-###` | a screen from Figma | `ledger/screens.md` |
| `Q-###` | an open question | `ledger/questions.md` |
| `D-###` | a decision the human made at a gate | `ledger/decisions.md` |
| `ADR-###` | an architectural decision record | `design/adr/` |
| `H-###` | a race-condition hotspot | `design/hotspots.md` |
| `EV-###` | an analytics event | `out/analytics.md` |
| `T-###` | a backlog task | `out/BACKLOG.md` |

Ids are permanent. If a requirement is dropped, mark it `~~REQ-014~~ withdrawn (D-007)` rather than renumbering — renumbering invalidates every citation written so far.

## Atomicity

One testable statement per row. The test: can you write a single assertion that proves it?

- Bad: "Users can browse articles, read them, and get rewards."
- Good: three rows — a list exists; a detail view exists; reading grants a one-time reward.

Atomicity is what lets a single requirement map to a single endpoint, a single hotspot, or a single backlog item.

## Sourcing

Every row cites where it came from: a section number, a heading, a page, or a Figma node id. This is the rule that makes the whole pipeline trustworthy, and it is the one most likely to erode under pressure.

**A statement you cannot source is not a requirement — it is a question.** Move it to `questions.md` as an assumption needing confirmation. The failure mode this prevents is the one that actually hurts: a model fills a gap with something plausible, nobody notices, and it becomes load-bearing three weeks later.

## The numbers section

Below the table, `## Verbatim numbers` lists every number in the spec with its source: prices, rewards, limits, TTLs, page sizes, timeouts, retry counts, thresholds.

Two reasons. First, these are the values that contradict Figma most often, and having them in one place makes `merge-facts.mjs` able to diff them mechanically. Second, every one of them belongs in config rather than in code — this list becomes the `GAME_*`-style env var group in [config-env-var.md](config-env-var.md).

## Classifying for concurrency

The `Concurrency?` column seeds the hotspot register. Mark `yes` when the requirement involves any of:

- a **limited resource** — codes, seats, stock, slots, quota
- a **counter or balance** — points, XP, money, attempts
- a **one-shot action** — claim, redeem, activate, complete, first-time bonus
- an **external side effect** — payment, message send, third-party call, file upload
- a **schedule** — daily reset, recurring send, expiry
- **uniqueness** — "one per user", "only one active"

That list is deliberately broad. A false positive costs one line in the register; a false negative costs a production incident.

## Reading between the lines

Specs are written by people describing the happy path. These are the recurring silences, each of which should become a `Q-###` when unaddressed:

| Silence | The question it hides |
| --- | --- |
| "The user receives a promo code" | From a finite pool? What happens when it is empty? Can they get a second one? |
| "Points are awarded for X" | Can X happen twice? Is there a daily cap? Can points go negative? |
| "Admin can send a broadcast" | To how many users? Synchronously? What if it fails halfway? Resumable? |
| "Data syncs from partner system" | Push or pull? How often? Idempotent? What identifies a record across systems? |
| "The user logs in" | Identity source, session lifetime, what happens on a second device |
| "Content is managed in an admin panel" | Who authorises? Is content versioned? Does editing a live entity break in-flight flows? |
| "The game awards prizes" | The client reports the score — so what stops a forged one? |
| Any list in any screen | Page size, ordering, and whether ordering is stable under concurrent inserts |
| Any timestamp shown to a user | Whose timezone? Server or client clock? |
| "Fast" / "надёжно" / "много пользователей" | The actual number, or an explicit "unknown, plan for X" |

## Contradictions

When the spec and Figma disagree, or the spec disagrees with itself, record **both** with both sources and escalate. Never pick the newer one, the more detailed one, or the more convenient one. The right answer is frequently neither — the disagreement is usually a sign that the product decision was never actually made, and surfacing it is worth more than resolving it.

## Handing over to design

Stage 4 reads the ledgers and nothing else. So the ledger must be self-sufficient: if a rule is only comprehensible with a paragraph of spec context, put that paragraph in the row. Terseness that requires re-reading the source defeats the tiering.
