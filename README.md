# skills

Collection of agent skills, installable with [`npx skills`](https://github.com/vercel-labs/skills).

## Install

All skills in this repo:

```bash
npx skills add kravetsone/skills
```

Browse without installing:

```bash
npx skills add kravetsone/skills --list
```

A specific skill (recommended for large multi-file skills):

```bash
npx skills add kravetsone/skills --skill takumi
```

Target a specific agent:

```bash
npx skills add kravetsone/skills --skill takumi -a claude-code
```

## Skills

| Skill | Version | Description |
| ----- | ------- | ----------- |
| [`takumi`](./takumi/SKILL.md) | 1.0.15 | Server-side image generation from JSX/HTML — OG cards, certificates, invoices, badges, charts, GIF/WebP animations, ffmpeg pipelines. Replaces `canvas` / `node-canvas` / `@vercel/og` / Satori / Puppeteer with the Rust-powered [Takumi](https://takumi.kane.tw/) engine. |

## Layout convention

Each skill is a top-level directory. `npx skills` discovers them via recursive search.

```
skills/
├── README.md
└── <skill-name>/
    ├── SKILL.md          # required — entry point with YAML frontmatter
    ├── metadata.json     # optional — version, org, abstract, references
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
     author: <upstream>
     version: "<upstream-version>"
     source: <canonical URL>
   ---
   ```

2. **Triggers belong in the description.** List the exact package names, import paths, API surface words, and framework names a user might type. Treat the description as a discovery index — if it's missing a keyword, the agent won't activate.

3. **Split references.** For anything over ~300 lines, break into `references/<topic>.md` and link from `SKILL.md`. Keep `SKILL.md` itself focused on critical concepts and a navigation table.

4. **Ship a `metadata.json` for machine consumers.** Mirrors the frontmatter but is easy to grep across repos. Pattern:
   ```json
   {
     "version": "<upstream-version>",
     "organization": "<upstream-org>",
     "date": "<DD MMM YYYY>",
     "abstract": "<one-paragraph hook>",
     "references": ["<llms.txt or docs root>", "..."]
   }
   ```

5. **Link to `.md` / `.raw` URLs when possible.** Many doc sites expose Markdown by appending `.md` to any page. GitHub files have `raw.githubusercontent.com/...` raw URLs. Both make reference templates and upstream docs machine-readable.

6. **Pull the richest source.** Prefer `llms-full.txt` over `llms.txt` when it exists — it usually has full examples and API details instead of an index.

See [Agent Skills docs](https://docs.claude.com/en/docs/agents-and-tools/agent-skills) for Claude Code–specific conventions.
