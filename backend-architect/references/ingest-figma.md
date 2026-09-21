# Ingesting Figma

Goal: turn a design file into a small, backend-relevant graph. What a backend needs from a design is not geometry — it is **which screens exist, what data each one shows, what actions it offers, what states were drawn, and how screens connect**.

## The shape the handover actually arrives in

Almost never a single tidy link. It arrives as *`Implement these 48 designs`* followed by
48 deep-links, all into the same file, each carrying its own `node-id`, pasted out of a
chat with `@` prefixes still attached. The script is built for that:

```bash
export FIGMA_TOKEN=figd_...

# the normal case — paste them all, in any quantity
node backend-architect/scripts/figma-digest.mjs <url1> <url2> ... <url48>

# same thing when the list is too long for a comfortable command line
node backend-architect/scripts/figma-digest.mjs --from-file links.txt
pbpaste | node backend-architect/scripts/figma-digest.mjs --stdin

# when layout or a visual state carries backend meaning, opt in to PNG renders
node backend-architect/scripts/figma-digest.mjs --from-file links.txt --render-images --render-limit 12
```

Leading `@`, angle brackets and trailing commas are stripped, duplicates are collapsed, and
non-Figma lines in the file are reported and skipped. All links must belong to **one file key**;
two different keys is a hard error, because one plan covers one product surface.

Writes `.backend-plan/raw/figma.digest.json` (plus `figma.raw.json` for debugging, which no model reads).

## Two modes, chosen automatically

| Input | Mode | What it fetches |
| --- | --- | --- |
| links carrying `node-id` | **targeted** | only `GET /nodes?ids=...`, in batches of 8. No whole-file inventory at all. |
| a bare file link | **broad** | `GET /files/{key}?depth=2`, then the top-level frames it found |

`--render-images` is opt-in. It calls `GET /v1/images/{key}?ids=...&format=png` for at most
`--render-limit` selected frames and saves the results under `raw/figma-images/`. The digest
contains paths, not base64 pixels; a subagent opens only the renders relevant to an uncertain
state with `view_image`. This keeps visual context available without making every architect
call pay for every screenshot.

Targeted is both cheaper and **more correct**, and the reason is worth internalising: the
inventory call only ever sees frames that are *direct children of a canvas*. Real files are
organised into sections, and the frames a designer links to usually sit several levels below
that. Searching the `depth=2` inventory for a deep node id finds nothing — so any code that
treats "not found" as "fall back to everything" will silently digest the whole file and
quietly discard the 48-screen selection the human just made. Prefer targeted whenever node
ids are available, which is nearly always.

### The node-id separator

URLs write the id as `6301-6506`; the REST API wants `6301:6506`. Convert with an
**alternation**, never a character class:

```js
u.match(/node[-_]?id=([0-9]+)(?:-|:|%3A)([0-9]+)/i)   // correct
u.match(/node[-_]?id=([0-9]+)[-:%3A]+([0-9]+)/i)      // silently corrupts ~10% of ids
```

`[-:%3A]` also matches the literal characters `3`, `A` and `%`, so it eats the leading `3` of
the second half: `6823-3364` parses as `6823:364`. Those ids then come back empty and look
exactly like deleted frames. This bug was caught by running the pipeline against a mock file
seeded with the real id list — worth doing before believing any ingest result.

### Node ids that return nothing

A requested id with no `document` in the response is **reported loudly, never skipped**. The
frame was deleted, moved to another file, or lives on a branch the token cannot read. Each one
is a question for the designer before the plan is written around the survivors.

## Token and scopes

A personal access token from Figma → Settings → Security is the right choice for local Codex
work. The official flow is documented at
https://developers.figma.com/docs/rest-api/personal-access-tokens/.

1. Open Figma account settings → **Security**.
2. Under **Personal access tokens**, choose **Generate new token**.
3. Give it a short name such as `codex-backend-architect-local`.
4. Set an expiration (personal tokens are user-bound and have a maximum lifetime of 90 days).
5. Grant `file_content:read`. Add `file_comments:read` and `file_dev_resources:read` if the
   plan should ingest comments and attached ticket/docs links.
6. Copy it immediately — Figma shows the secret only once.

Scopes do not bypass file permissions: the account must already be able to open the Figma file.
The REST scope list is maintained at https://developers.figma.com/docs/rest-api/scopes/.
Variables remain Enterprise-only (`file_variables:read`).

For a shared CI/production integration, use a **Plan access token** instead. It is not tied to
one employee, supports resource allowlists and up to one year of expiration, but Figma makes it
available only on Organization and Enterprise plans; an organization admin creates it at
https://www.figma.com/developers/tokens. Do not use a personal token as a permanent CI secret.

## The endpoints that matter

| Endpoint | Why |
| --- | --- |
| `GET /v1/files/{key}/nodes?ids=a,b,c` | full subtree for exactly the frames that were handed over. **Start here when you have node ids.** Also returns the file's `name` and `lastModified`, so no second call is needed for metadata. |
| `GET /v1/files/{key}?depth=2` | cheap inventory: pages and their top-level frames. Only when no node ids were given. |
| `GET /v1/files/{key}/comments` | where the team argued about behaviour — often the only record of a rule |
| `GET /v1/files/{key}/dev_resources` | links designers attached to frames (tickets, docs) |
| `GET /v1/images/{key}?ids=...` | rendered PNGs, if a human wants to look |

A design file is tens of megabytes. Both routes exist to avoid ever pulling it whole: `depth=2`
reduces it to a kilobyte-scale index when you must explore, and `/nodes?ids=` skips exploration
entirely when the selection is already known.

## What the digest keeps

Per screen:

- `id`, `name`, `page` (null in targeted mode — the nodes endpoint reports no ancestry), and a
  `url` that links straight back to the frame, so every claim in the plan is one click from its source
- `family` — the screen name with its state suffix removed; see below
- `devStatus` — `READY_FOR_DEV` / `COMPLETED` / `NONE`. **This is your build-order signal**: screens marked ready-for-dev are what the team intends to ship first, which is a better backlog ordering input than your own guess.
- all text content, flattened and de-duplicated — labels, empty-state copy, error messages, button captions
- interactive nodes: `interactions`, `transitionNodeID` — the outgoing edges
- `componentPropertyDefinitions` — variant names like `state=empty|loading|error` are a literal enumeration of the states the API must be able to produce
- repeated sibling structures — a list, therefore pagination
- counts of image/vector fills — a media-upload requirement hiding in plain sight

Per canvas: `flowStartingPoints` (and the deprecated `prototypeStartNodeID`) — the designer's declared entry points. Those name the user journeys.

## What the digest throws away

Geometry, fills, strokes, effects, constraints, font metrics, vector paths, absolute coordinates. None of it has a backend consequence, and it is 95% of the bytes.

## The flow graph is free

Prototype edges (`transitionNodeID` on nodes with `interactions`) form a directed graph over frames. The script emits it as `flows: [{from, to, trigger}]`, so **you never spend a model on reconstructing navigation**. Read directly off it:

- entry points → what must work for a cold user (auth, bootstrap payload)
- a node with many inbound edges → a hub screen, usually the one that needs the fattest aggregate endpoint
- a cycle → a repeatable action, which is a concurrency question ("can it be done twice at once?")
- a dead end with no back edge → often a missing error path rather than a deliberate design

## Known limits — do not design around these

| Limit | Consequence |
| --- | --- |
| **Dev Mode annotations are not in the REST API.** The `AnnotationsTrait` in the official spec is an empty placeholder. | Annotations are reachable only through Figma's official Dev Mode MCP server. If the team put behaviour notes in annotations, ask for them explicitly, or connect the MCP server. |
| **`/v1/files/{key}/variables/local` is Enterprise-only.** A Dev seat gets 403. | Never make design tokens or variable collections a required input. The script swallows the 403 and continues. |
| Rate limits are per-token and undocumented in detail. | The script backs off on 429 and caches `figma.raw.json`. Re-running the digest does not re-fetch. |
| Branches are separate file keys. | If the team works on a branch, ask for the branch's URL — the main file will be stale. |

## N designs are not N screens, and never N endpoints

The single most common way to over-scope a backend from a design handover is to count the
links. A batch of 48 frames is typically 20-25 real screens, each drawn two or three times:
default, empty, loading, error, modal-open.

The digest does this collapsing for you. `familyOf()` strips a trailing state segment from the
frame name — `Корзина / empty` and `Корзина` become one family `Корзина` — and understands both
separator style (`Лента / Список / loading`) and Figma variant syntax
(`Каталог, state=empty, size=lg`). The result is `screenFamilies`, sorted by how many variants
each has. A run on a real 35-link handover produced **34 readable frames → 23 families**.

Read it like this:

| Signal | Backend consequence |
| --- | --- |
| A family with 3+ variants | one endpoint, with a **response union** wide enough to express every drawn state. The variants are a free, designer-authored enumeration of your error and empty cases. |
| A family with exactly one frame | either genuinely simple, or the empty/error states were never drawn — **ask**, do not assume the happy path is the whole contract. |
| Two families sharing a prefix (`Оплата / Успех`, `Оплата / Выбор способа`) | usually one flow, one state machine, one table — not two resources. |
| `hasList: true` anywhere in the family | pagination contract for that resource. |
| `likelyInputs > 0` | a write endpoint plus server-side validation; the disabled-button state tells you the precondition. |

So: **count families, not links**, when sizing the endpoint table. Then state the number in the
plan explicitly — "48 links → 23 screens → 14 endpoints" — because that reduction is exactly the
piece of reasoning a reviewer will want to check, and the one a model is most tempted to skip.

## Reading the digest as a backend engineer

This is the interpretation stage-2b performs. The mapping is mechanical enough to be worth stating:

| Seen in Figma | Backend consequence |
| --- | --- |
| A list with a "load more" or a scroll cut-off | pagination contract (`limit`/`offset` or cursor) — decide which, in the plan |
| An empty state with copy | a legitimate `[]` response, not a 404; the copy tells you the semantics |
| An error toast with specific wording | a named error code in the response union |
| A disabled button | a precondition the API must also enforce — never client-only |
| A badge with a count | either a field on the parent resource or an aggregate; prefer computing it in the same query |
| A relative timestamp ("2 часа назад") | the server sends absolute ISO-8601 plus its own `serverTime`; never let the client's clock decide |
| A currency/points balance in the header | present on the bootstrap/user endpoint, and mutated only via Class-1 atomic updates |
| An avatar or photo upload | S3 presigned upload, plus a size/MIME policy that the spec almost certainly omits |
| A "share" affordance | a public, unauthenticated render endpoint — check whether it leaks anything |
| Screens with no visible entry point | ask; it is either dead design or a missing flow |

## When there is no Figma

Say so in the plan's Sources section and proceed. Expect roughly twice as many Gate-1 questions, because empty/error/loading states — which designers produce for free — now have to be elicited from the human one at a time.
