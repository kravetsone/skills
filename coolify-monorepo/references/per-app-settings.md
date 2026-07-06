# Per-application Coolify settings for a workspace app

The complete checklist for one `apps/<app>` deployed as one Coolify application resource. Repeat per app — N apps from the same repo is a first-class pattern (the webhook evaluates all of them per push, see [watch-paths.md](watch-paths.md)).

## Settings table

| Setting (UI: Configuration → General/Build) | Value | Why |
|---|---|---|
| Source | **GitHub App** (one app, all repos/one repo) | Automatic per-push webhooks, PR previews, no manual webhook secrets. Deploy-key sources need a manually-added webhook to `/webhooks/source/github/events/manual` AND the creation wizard **loses the Base Directory you type** (open bug <https://github.com/coollabsio/coolify/issues/10319> — re-enter it after creation if you must use deploy keys) |
| Build Pack | **Dockerfile** | Only pack with fully deterministic monorepo behavior; see [coolify-build-model.md](coolify-build-model.md) |
| Base Directory | **`/`** | Base dir = docker build context. `/` makes the repo root the context so the root lockfile + `packages/` are COPY-able |
| Dockerfile Location | **`/apps/<app>/Dockerfile`** | Resolved relative to Base Directory (concatenated). Default is `/Dockerfile` |
| Build target (optional) | e.g. `runner` | Passed as `docker build --target` — lets one Dockerfile serve dev/prod stages |
| Watch Paths | `apps/<app>/**` + shared inputs | See [watch-paths.md](watch-paths.md) for grammar; without it every push rebuilds every app |
| Disable Build Cache | **off** | On = every build runs `docker build --no-cache` (source: `disable_build_cache` force-sets `force_rebuild`, `ApplicationDeploymentJob.php:214-217`). Keep layer cache; use one-off *Force deploy without cache* instead (<https://github.com/coollabsio/coolify/discussions/4401>) |
| Include Source Commit in Build | **off** | Injects SHA as build arg → invalidates layer cache every commit (docs: <https://coolify.io/docs/applications/build-packs/dockerfile>). Only enable if the app must know its SHA at build time — prefer a runtime env var |
| Git shallow clone | on (optional) | `--depth=1` clone; saves time/disk on big repos. Off by default |
| Ports / healthcheck / domains | per app | Unrelated to monorepo, don't forget them on cutover |

## Environment variables

- Env vars are **per Coolify application** — this is a major advantage over the compose pack (which shares one `.env` across all services, <https://github.com/coollabsio/coolify/issues/7655>).
- **Build-time vs runtime**: mark variables "Build Variable" only if the Dockerfile needs them; Coolify wraps builds with `set -a && source .env` for build-time vars and passes `--build-arg`s. Runtime-only secrets should stay runtime-only (they don't invalidate layer cache).
- Set ALL env vars (flags + secrets) **before** triggering the first deploy of a new configuration — changing envs later means another rebuild/restart cycle. Configuration changes are themselves rebuild triggers: `should_skip_build()` calls `pendingDeploymentConfigurationDiff()->requiresBuild()` — changed build config forces a rebuild even at the same SHA.

## Webhook / source wiring

- **GitHub App**: Coolify matches incoming pushes to applications by `repository_project_id` + branch (`app/Http/Controllers/Webhook/Github.php:318-328`). All apps from the repo share the one GitHub App installation. Nothing to configure per app beyond selecting the source.
- **Deploy key + manual webhook**: matched by repo full name + branch among apps with a deploy key set (`Github.php:79-88`). You must add the webhook in GitHub repo settings yourself (URL `/webhooks/source/github/events/manual`, secret = Coolify's webhook secret).
- Pushes where **every** commit message contains `[skip ci]` / `[skip cd]` are skipped (webhook controller).
- Manual/API deploy of any single app: `GET /api/v1/deploy?uuid=<app-uuid>` (add `&force=true` to bypass the same-SHA build skip and layer cache).

## Server-level settings that affect all N apps

- **Concurrent builds limit** (Server → Settings): a `packages/**` commit legitimately triggers many apps at once; they queue beyond the limit. Size it against server RAM/CPU — N simultaneous `pnpm install`s can OOM a small box.
- **Build server**: Coolify can offload builds to a dedicated build server (Server settings → "Use it as a build server"). Same context/caching semantics apply, just on the other machine — including the `daemon.json` BuildKit GC fix from [caching-and-disk.md](caching-and-disk.md).
- `/etc/docker/daemon.json` builder GC + Automated Cleanup schedule — see [caching-and-disk.md](caching-and-disk.md). Do this once per build host.

## Per-app cutover checklist (existing app, settings flip)

1. Write/commit the app's Dockerfile at `apps/<app>/Dockerfile` (+ root `.dockerignore`).
2. In Coolify: switch Build Pack → Dockerfile; Base Directory → `/`; Dockerfile Location → `/apps/<app>/Dockerfile`.
3. Set Watch Paths.
4. Verify env vars (build vs runtime split) BEFORE deploying.
5. Deploy manually with force once: `.../deploy?uuid=<uuid>&force=true`.
6. In the build log verify: clone at repo root, `docker build -f /artifacts/<uuid>/apps/<app>/Dockerfile ... /artifacts/<uuid>` — the trailing context path must be the artifacts root, not `.../apps/<app>`.
7. Push a no-op commit touching only another app → confirm this app does NOT deploy (watch paths working).
8. Push a commit touching `packages/<shared-dep>` → confirm this app DOES deploy.
