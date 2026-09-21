# Codex thread orchestration

The human does not operate this pipeline from a shell. The LLM owns the loop inside the
current Codex thread: it runs deterministic scripts with `exec_command`, reads their output and
artefacts, delegates bounded extraction/design work, and asks the human only when a decision
changes the plan.

## The control loop

1. **Discover inputs.** Parse the user's message for Google Docs/Notion/PDF sources, Figma
   links, mode (`api`, `bot`, `both`) and an existing target repository. If a source is absent,
   ask one concise question before inventing a substitute.
2. **Initialize.** Run `plan-init.mjs` in the target workspace. Never ask the human to run it.
3. **Ingest.** Run `docs-pull.mjs` and `figma-digest.mjs` yourself. For a Figma handover with
   many `node-id` links, pass them as one invocation or write a temporary links file. Use
   `--render-images` only when a visual state/diagram can change a backend decision.
4. **Inspect.** Read the script output, `spec.meta.json`, the digest stats and warnings. If a
   node or document image is missing, add a question rather than silently continuing.
5. **Delegate stage 2.** Spawn facts and screens extractors in parallel when slots permit:
   `model: gpt-5.6-terra`, `fork_turns: "none"`. Their messages must contain absolute paths,
   the exact output file, and the relevant reference paths. The parent remains the coordinator.
6. **Reconcile.** Run `merge-facts.mjs` yourself, then read its generated findings. Do not ask
   a model to infer what a deterministic check already established.
7. **Ask Gate 1 questions in the thread.** Read `ledger/questions.md`, merge mechanical gaps
   and contradictions, and ask the human directly as a numbered list. Do not merely tell the
   human to open the file. Stop until the answers materially resolve the gate.
8. **Design.** After the human answers, spawn or perform the architect stage with the expensive
   model. Pass ledger paths and the relevant references explicitly; never pass raw Figma JSON.
9. **Ask Gate 2 questions in the thread.** Summarize concrete architectural decisions and
   unresolved tradeoffs. Stop for correction before emitting the final contract.
10. **Emit and verify.** Generate the five deliverables, run `hotspot-scan.mjs`,
    `plan-lint.mjs` and `coverage-report.mjs`, read failures, fix the plan, and report the
    final artefact paths.

## Question policy

`questions.md` is a durable ledger, not a mailbox. Every question asked in chat gets an ID
(`Q-###`) and the answer is written back beside it. Questions that are only mechanical
(`missing source`, `contradictory number`, `unreadable Figma node`) are grouped into one
message. Questions with concurrency, privacy, money, auth or irreversible product impact are
asked separately and block the gate.

Use this shape in the thread:

> **Q-014 — score authority:** Can the client submit the final score, or must the server
> validate a sequence of signed gameplay events? This changes the anti-cheat model and the
> `session_events` schema. Current evidence: REQ-021, SCR-008.

Never ask “please review questions.md” as a substitute for asking. The file is the audit trail;
the conversation is the decision surface.

## Failure and resume

- A script failure is reported with the command, exit code and a short stderr excerpt. Retry
  only when the failure is transient; ask the human when access, credentials or source choice
  is missing.
- If the thread is interrupted after a gate, inspect `plan.json`, hashes in `spec.meta.json`,
  and existing ledgers before re-running anything. Scripts are intended to be idempotent.
- Never silently promote a warning to a fact. Keep it in `questions.md` until answered.
