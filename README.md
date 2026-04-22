# skills

Collection of [agent skills](https://docs.claude.com/en/docs/agents-and-tools/agent-skills) maintained by [@kravetsone](https://github.com/kravetsone), installable with [`npx skills`](https://github.com/vercel-labs/skills) — the open agent-skills tool that fetches `SKILL.md` files from any GitHub repo and drops them into Claude Code, Cursor, OpenCode, Codex CLI, or any supported coding agent.

## Install

### All skills in this repo

```bash
npx skills add kravetsone/skills
```

```bash
bunx skills add kravetsone/skills
```

### Browse without installing

```bash
npx skills add kravetsone/skills --list
```

```bash
bunx skills add kravetsone/skills --list
```

### Install a specific skill (recommended for large multi-file skills)

```bash
npx skills add kravetsone/skills --skill takumi
```

```bash
bunx skills add kravetsone/skills --skill takumi
```

### Target a specific agent

```bash
npx skills add kravetsone/skills --skill takumi -a claude-code
```

```bash
bunx skills add kravetsone/skills --skill takumi -a claude-code
```

Supported agent targets include `claude-code`, `cursor`, `opencode`, `codex`, `copilot`, and others — see [`vercel-labs/skills`](https://github.com/vercel-labs/skills) for the full list.

## Skills

| Skill | Version | Description |
| ----- | ------- | ----------- |
| [`takumi`](./takumi/SKILL.md) | 1.0.15 | Server-side image generation from JSX/HTML — OG cards, certificates, invoices, badges, charts, GIF/WebP animations, ffmpeg pipelines. Replaces `canvas` / `node-canvas` / `@vercel/og` / Satori / Puppeteer with the Rust-powered [Takumi](https://takumi.kane.tw/) engine. |
| [`adminjs`](./adminjs/SKILL.md) | 2026.4.23 | AdminJS 7 on the Bun + Elysia + Drizzle ORM + S3 stack plus the wider ecosystem (`@adminjs/passwords`, `@adminjs/logger`, `@adminjs/import-export`, `@adminjs/leaflet`, `@adminjs/bundler`, `@adminjs/relations` premium note, `@gugupy/adminjs-keycloak` for OIDC, `@rulab/adminjs-components` for Singleton/ColorStatus/Slug/UUID/EditorJS/SortableList/Tabs/Preview). Documents `adminjs-elysia` v0.1.4 cookie-name bug, `adminjs-drizzle` snake_case + boolean-as-string quirks, `@adminjs/upload` BaseProvider contract for Web API Blobs, multiple upload features per resource, production pre-bundling with `ADMIN_JS_SKIP_BUNDLE="true"`, richtext patch, React 18 pin, custom actions & components, JWT auth, plus ready-to-paste templates and `doctor.mjs` / `bundle-check.mjs` / `scaffold-resource.mjs` node scripts. |
| [`subsonic-api`](./subsonic-api/SKILL.md) | 2026.4.23 | Building Subsonic / OpenSubsonic / Navidrome clients in TypeScript (Node, Bun, Deno, Cloudflare Workers, browser, Electron). Covers token+salt MD5 auth, OpenSubsonic `apiKey` extension, `getOpenSubsonicExtensions` discovery, every endpoint category with a Navidrome support matrix, streaming/transcoding knobs (`format=raw`, `maxBitRate`, `transcodeOffset`), scrobble submission heuristic (≥50% or ≥4min), play-queue sync, lyrics (legacy + `songLyrics` synced LRC), cover art caching, Navidrome quirks (IDs-as-strings, no video, no folder browse, `search3` without Lucene, reverse-proxy auth, CVE-2025-27112). Also documents Navidrome's **native** `/api/*` JWT REST (unstable) — `/auth/login`, react-admin pagination, admin endpoints `/api/plugin`/`/api/library`/`/api/missing`/`/api/config`, SSE `/api/events?jwt=`. Comparison of `@audioling/open-subsonic-api-client` / `subsonic-api` / `@vmohammad/subsonic-api` / `subsonicjs` + zero-dep `minimal-client.ts` template, ready-to-paste Hono/Elysia/Cloudflare proxy, `check-server.mjs` capability probe. |

## Layout convention

Each skill is a top-level directory. `npx skills` discovers them via recursive search.

```
skills/
├── README.md
└── <skill-name>/
    ├── SKILL.md          # required — entry point with YAML frontmatter
    ├── metadata.json     # optional — version, author, abstract, references
    └── references/       # optional — split large topics into focused files
        ├── installation.md
        ├── <topic>.md
        └── ...
```

## Authoring guidelines

1. **Frontmatter.** Every `SKILL.md` starts with:
   ```yaml
   ---
   name: <skill-name>            # lowercase, hyphens only, matches directory
   description: "..."            # what it does + when to invoke + trigger keywords
   metadata:
     author: <skill-maintainer>
     version: "<upstream-version>"
     source: <URL to the skill in this repo>
     upstream: <URL to the library the skill documents, if applicable>
   ---
   ```

2. **Triggers belong in the description.** List the exact package names, import paths, API surface words, and framework names a user might type. Treat the description as a discovery index — if it's missing a keyword, the agent won't activate.

3. **Split references.** For anything over ~300 lines, break into `references/<topic>.md` and link from `SKILL.md`. Keep `SKILL.md` itself focused on critical concepts and a navigation table.

4. **Ship a `metadata.json` for machine consumers.** Mirrors the frontmatter but is easy to grep across repos:
   ```json
   {
     "version": "<upstream-version>",
     "author": "<skill-maintainer>",
     "source": "<URL to the skill in this repo>",
     "upstream": "<URL to the documented library>",
     "date": "<DD MMM YYYY>",
     "abstract": "<one-paragraph hook>",
     "references": ["<llms-full.txt>", "<docs root>", "..."]
   }
   ```

5. **Link to `.md` / `.raw` URLs when possible.** Many doc sites expose Markdown by appending `.md` to any page. GitHub files have `raw.githubusercontent.com/...` raw URLs. Both make reference templates and upstream docs machine-readable.

6. **Pull the richest source.** Prefer `llms-full.txt` over `llms.txt` when it exists — it usually has full examples and API details instead of an index.

See the [Agent Skills docs](https://docs.claude.com/en/docs/agents-and-tools/agent-skills) for Claude Code–specific conventions.
