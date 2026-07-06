---
name: coolify-monorepo
description: "Deploying and maintaining JS/TS monorepos (pnpm workspaces + Turborepo/Nx, `apps/` + `packages/`) on self-hosted Coolify v4. Invoke for ANY Coolify work on a repo with multiple apps: Base Directory / Dockerfile Location / Watch Paths / build pack choice (Dockerfile vs Nixpacks vs Railpack vs Docker Compose), why `COPY pnpm-lock.yaml` fails (Base Directory IS the docker build context), webhook fan-out (one push → N apps, GitHub App vs deploy keys), selective redeploys via watch-paths globs + `!` negation, `turbo prune --docker` multi-stage Dockerfiles, dependency graph (`workspace:*`, `dependsOn: [\"^build\"]`), build caches (layer cache, BuildKit GC, Coolify cleanup, same-SHA skip, `force=true`, turbo remote cache), disk pressure, migrating standalone folders to a workspace, debugging stale/skipped/slow deploys. Also triggers on turbo.json, pnpm-workspace.yaml, `workspace:` protocol. When delegating to a subagent, pass reference files inline — skills don't auto-load there."
metadata:
  author: kravetsone
  version: "4.1.2"
  source: https://github.com/kravetsone/skills/tree/main/coolify-monorepo
  upstream: https://github.com/coollabsio/coolify
---

# Monorepos on Coolify v4

Coolify builds every "application" resource by cloning the **whole repo** into a helper container and running `docker build` (or nixpacks/railpack) on the server itself. Its monorepo story is three settings — **Base Directory**, **Dockerfile Location**, **Watch Paths** — and almost every production incident comes from misunderstanding what those three actually do. Everything in this skill is verified against the Coolify `v4.x` source branch (v4.1.2, 2026-06) with file:line references, plus the official docs and GitHub issues.

## The Five Laws (memorize these)

1. **Base Directory IS the docker build context.** Coolify runs
   `docker build -f {workdir}{dockerfile_location} -t {image} {workdir}` where `workdir = clone_dir + base_directory` (`app/Jobs/ApplicationDeploymentJob.php:3615`). **Dockerfile Location is resolved relative to Base Directory, not repo root.**
   ⇒ With pnpm workspaces you MUST set Base Directory `/` and Dockerfile Location `/apps/<app>/Dockerfile`, otherwise `COPY pnpm-lock.yaml` / `COPY packages/` fail — the root lockfile and shared packages are outside the context.

2. **One push fans out to every app on that repo+branch.** The webhook controller loads ALL matching applications and deploys each one unless its Watch Paths filter says otherwise (`app/Http/Controllers/Webhook/Github.php:133-135`). No watch paths = 6 apps rebuild on every commit.

3. **Watch Paths are newline-separated globs matched against repo-root-relative paths**, leading `/` auto-stripped, `!` negation supported, **last matching pattern wins** (gitignore-style). Every app in a workspace needs `apps/<app>/**` PLUS its shared inputs (`packages/**`, `pnpm-lock.yaml`, `turbo.json`).

4. **Coolify skips the whole build if an image for the same commit SHA exists** and no build config changed ("Build step skipped." — `should_skip_build()`, `ApplicationDeploymentJob.php:1245`). Recovery from any stale state: `GET /api/v1/deploy?uuid=<app>&force=true`.

5. **Two independent garbage collectors eat your layer cache**: BuildKit's own GC (~48 h default) and Coolify's Automated Cleanup ("Clears Docker build cache"). Healthy monorepo CI on Coolify requires the `daemon.json` builder GC config and a deliberate cleanup schedule — see [caching-and-disk.md](references/caching-and-disk.md).

## Default recipe (pnpm + turbo, N apps, one repo)

Per Coolify application: **GitHub App source** · build pack **Dockerfile** · Base Directory **`/`** · Dockerfile Location **`/apps/<app>/Dockerfile`** · Watch Paths:

```
apps/<app>/**
packages/**
pnpm-lock.yaml
pnpm-workspace.yaml
package.json
turbo.json
```

Dockerfile: `turbo prune <pkg> --docker` multi-stage (templates in [dockerfile-templates.md](references/dockerfile-templates.md)). Disable Build Cache **off**, Include Source Commit in Build **off**. Full why + variants: [per-app-settings.md](references/per-app-settings.md).

## Reference map

| File | Read when |
|------|-----------|
| [references/coolify-build-model.md](references/coolify-build-model.md) | Understanding what Coolify actually executes: clone → helper container → build; build pack comparison (Dockerfile / Nixpacks / Railpack / Compose); why Dockerfile is the monorepo default |
| [references/per-app-settings.md](references/per-app-settings.md) | Configuring a Coolify application for a workspace app: every setting, GitHub App vs deploy key, env vars, rollout order |
| [references/watch-paths.md](references/watch-paths.md) | Selective redeploys: exact glob grammar (from source), webhook fan-out mechanics, 20-commit payload truncation, `[skip ci]`, testing patterns |
| [references/caching-and-disk.md](references/caching-and-disk.md) | Build speed & disk: Docker layer cache, same-SHA skip, BuildKit GC `daemon.json`, Coolify cleanup, cache mounts, concurrent build queue |
| [references/workspace-layout.md](references/workspace-layout.md) | `apps/` + `packages/` design: pnpm-workspace.yaml, `workspace:*`, catalogs, internal-package patterns (compiled vs just-in-time), dependency-graph hygiene |
| [references/turborepo-graph-and-cache.md](references/turborepo-graph-and-cache.md) | turbo.json task graph (`dependsOn: ["^build"]`, inputs/outputs), `turbo prune --docker`, `--filter`/`--affected`, remote cache (incl. self-hosting it on Coolify) |
| [references/dockerfile-templates.md](references/dockerfile-templates.md) | Ready-to-paste Dockerfiles: NestJS (compiled), Bun service, Node tsx runtime via `pnpm deploy`, root `.dockerignore`, compose-file fallback |
| [references/migration-runbook.md](references/migration-runbook.md) | Converting N standalone app folders in one repo into a real workspace with zero-downtime Coolify cutover, app by app |
| [references/troubleshooting.md](references/troubleshooting.md) | Symptom → cause → fix table with Coolify issue links: COPY failures, stale deploys, watch-paths misfires, nixpacks pnpm errors, compose-pack bugs |

## Companion skills (install alongside)

This skill owns the **Coolify ⇄ monorepo seam**. For deep work inside the monorepo itself, pair it with:

- **`turborepo` (official, by Vercel)** — `npx skills add vercel/turborepo` (also listed in [Turborepo's AI guide](https://turborepo.dev/docs/guides/ai)). Task pipelines, `turbo.json` authoring, cache debugging (`turbo run --dry`, `--summarize`), creating packages. Use it for anything turbo-internal; use *this* skill for how turbo output meets Coolify.
- **`turborepo` (antfu/skills)** — `npx skills add antfu/skills --skill turborepo` — community alternative, pnpm-centric.
- A Docker/Dockerfile best-practices skill if your agent has one installed — multi-stage patterns here assume BuildKit.
- Upstream machine-readable docs for lookups beyond this skill: `https://turborepo.dev/llms.txt`, Coolify docs `https://coolify.io/docs` (source of truth for UI naming).

## Scope & non-goals

Covers Coolify **v4.0.0–v4.1.x** application resources built **on the Coolify server or a Coolify build server** from a git source. Not covered: Coolify v3, Kubernetes, building images in external CI and deploying via the "Docker Image" resource (that path sidesteps everything here except watch paths and webhooks), and Coolify "services" (one-off compose stacks not built from your repo).
