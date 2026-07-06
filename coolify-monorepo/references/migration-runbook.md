# Runbook: N standalone `apps/*` folders → real workspace on Coolify

For repos that already have `apps/<a>..<f>` as **independent** projects (own lockfiles, own node_modules, deployed as separate Coolify apps from one repo). Goal: pnpm workspace + turbo, zero-downtime cutover, app by app.

## Phase 0 — inventory (before touching anything)

- [ ] List every Coolify application on this repo: build pack, base directory, dockerfile location, watch paths, env vars, domains. (Coolify API: `GET /api/v1/applications`.)
- [ ] Per app: package manager, lockfile, Node/Bun version, start command, ports, healthcheck.
- [ ] Identify copy-pasted code across apps → candidate `packages/*` (don't extract yet).
- [ ] Confirm build host prep: `daemon.json` BuildKit GC + cleanup schedule ([caching-and-disk.md](caching-and-disk.md)).

## Phase 1 — workspace-ify the repo (one PR, no Coolify changes yet)

1. Root: `pnpm-workspace.yaml` (`apps/*`, `packages/*`), private root `package.json`, `turbo.json` with `build`/`typecheck` tasks, root `.dockerignore`.
2. Name every app package (`@acme/<app>`), set `"engines"`, remove per-app lockfiles.
3. `pnpm install` at root → ONE `pnpm-lock.yaml`. Fix version conflicts now (pnpm catalogs help — [workspace-layout.md](workspace-layout.md)).
4. Verify each app still runs from the workspace: `pnpm --filter=@acme/<app> dev|start`.
5. **Critical during transition:** existing Coolify apps (nixpacks or old Dockerfiles with base dir `/apps/<app>`) may BREAK on this merge — their subfolder no longer contains a lockfile. Plan Phase 2 to land immediately after, or keep temporary per-app lockfile copies until each app is cut over (ugly but safe).

## Phase 2 — per-app cutover (repeat × N, one app at a time)

1. Write `apps/<app>/Dockerfile` from [dockerfile-templates.md](dockerfile-templates.md); test locally from repo root:
   `docker build -f apps/<app>/Dockerfile -t test-<app> .`
2. In Coolify (existing application — do NOT recreate; keeps domain/envs/history):
   - Build Pack → `Dockerfile`; Base Directory → `/`; Dockerfile Location → `/apps/<app>/Dockerfile`.
   - Watch Paths → per [watch-paths.md](watch-paths.md).
   - Env vars: verify build-time/runtime split **before** deploying (config changes force rebuilds anyway; do them in one batch).
3. Force deploy: `GET /api/v1/deploy?uuid=<uuid>&force=true`.
4. Verify in the build log: context = `/artifacts/<uuid>` (root), dockerfile path correct, install layer cached on the second run.
5. Runtime verify: healthcheck green, logs clean, domain serves.
6. Watch-path verify (two probe commits — see [watch-paths.md](watch-paths.md) testing section).
7. Move to the next app. Keep the previous deployment available for instant rollback (Coolify keeps prior images; Deployments → redeploy old one).

## Phase 3 — extract shared packages (after all apps are cut over)

1. Extract duplicated code into `packages/<name>` one package at a time; consumers switch to `workspace:*` deps.
2. Each extraction PR: update affected apps' watch paths if you scoped them narrower than `packages/**`.
3. Re-run the watch-path probe: a commit to the new package must redeploy exactly its consumers (`turbo ls --filter=...@acme/<pkg>` lists dependents — compare against what actually deployed).

## Phase 4 — optimization (optional, when pain appears)

- Turbo remote cache self-hosted on Coolify ([turborepo-graph-and-cache.md](turborepo-graph-and-cache.md)).
- Dedicated Coolify build server if app-server CPU contention shows.
- Narrow `packages/**` watch paths to real per-app closures.

## Rollback story at every step

- Phase 1 revert = git revert (no infra touched).
- Phase 2 per-app revert = restore old build-pack settings in Coolify (write them down in the PR description!) or redeploy the previous image from the Deployments list.
- Mixed state (3 apps cut over, 3 legacy) is fine indefinitely — the webhook/watch-paths model doesn't care which build pack each app uses.

## Common migration traps

| Trap | Avoidance |
|---|---|
| Merging Phase 1 breaks not-yet-cutover apps (lost per-app lockfiles) | Land Phase 2 same-day per app, or temporarily keep old lockfiles in subfolders |
| Recreating Coolify apps instead of flipping settings | Lose domains/env history; also new-app wizard w/ deploy keys drops Base Directory ([#10319](https://github.com/coollabsio/coolify/issues/10319)) |
| Env vars edited after the deploy | Extra rebuild cycle; batch env edits before triggering |
| Watch paths added before Dockerfile pack flip | Old nixpacks builds keep deploying on unrelated pushes mid-migration — set watch paths in the same flip |
| Two apps sharing one `Dockerfile` via build-args | Works, but couples cache keys and watch paths; prefer one Dockerfile per app (they're 30 lines) |
