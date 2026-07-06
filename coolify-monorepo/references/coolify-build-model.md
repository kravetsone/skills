# How Coolify actually builds your app

Understanding the pipeline explains every monorepo behavior. Verified against `coollabsio/coolify` branch `v4.x` (v4.1.2). Key file: `app/Jobs/ApplicationDeploymentJob.php` (referenced below as `ADJ`).

## The deployment pipeline

For every deployment Coolify:

1. **Spins up a `coolify-helper` container** on the target/build server (docker socket mounted). All build steps run inside it via `executeInDocker(...)`.
2. **Clones the entire repository** into `/artifacts/{deployment_uuid}`:
   - Full clone by default; `--depth=1` only if the per-app **"Git shallow clone"** setting is on (`is_git_shallow_clone_enabled`, default false — `app/Models/Application.php:1559`).
   - Submodules only if enabled (`--recurse-submodules`).
   - **The Base Directory does NOT limit the clone.** The whole repo is always present on disk; base dir only selects the working subdirectory. (Sparse checkout exists in the code only for a compose-file-only fast path.)
3. Computes `workdir`:
   ```php
   $this->workdir = "{$this->basedir}".rtrim($baseDir, '/');   // ADJ:244
   ```
   i.e. `workdir = /artifacts/{uuid} + base_directory`.
4. Generates the image name **tagged by git commit SHA** and, unless force-rebuilding, checks if that image already exists locally/in registry → may **skip the build entirely** (see [caching-and-disk.md](caching-and-disk.md)).
5. Runs the build pack (below), then rolling-updates the container(s).

## Build pack → exact command executed

### Dockerfile build pack (recommended for monorepos)

```bash
DOCKER_BUILDKIT=1 docker build {--no-cache if forced} {--target ...} \
  --network host \
  -f {workdir}{dockerfile_location} \
  --progress plain -t {image} {build_args} {workdir}     # ADJ:3615-3631
```

Consequences:

- **Build context = `workdir` = Base Directory.** Not the repo root, unless Base Directory is `/`.
- **`Dockerfile Location` is concatenated onto Base Directory** (`{workdir}{dockerfile_location}`). It is *not* repo-root-relative when base dir ≠ `/`.
- ⇒ **pnpm-workspace rule: Base Directory `/`, Dockerfile Location `/apps/<app>/Dockerfile`.** Then `COPY pnpm-lock.yaml ./` and `COPY packages/ ./packages/` work.
- BuildKit is auto-enabled when the server's docker supports it (capability probes at ADJ:435-464), including **build secrets** and therefore **`RUN --mount=type=cache`** mounts.
- Docs: <https://coolify.io/docs/applications/build-packs/dockerfile> — "Use `/` if your files are at the root or specify a subfolder (like `/backend` for a monorepo)". The docs frame base-dir-as-subfolder as *the* monorepo feature; that framing is only correct for repos whose subfolders are self-contained. Workspaces are not.

### Nixpacks build pack

```bash
nixpacks build -c plan.json --cache-key '{app-uuid}' -n {image} {workdir} -o {workdir}
DOCKER_BUILDKIT=1 docker build -f {workdir}/.nixpacks/Dockerfile -t {image} {workdir}   # ADJ:3573-3588
```

- Same context rule: nixpacks sees only `workdir`.
- Nixpacks is **in maintenance mode** since March 2025 (Railway replaced it: <https://blog.railway.com/p/introducing-railpack>; Coolify tracking: <https://github.com/coollabsio/coolify/issues/7983>).
- Known workspace failure modes: with a subdirectory as root it mis-detects the package manager and falls back to npm → `EUNSUPPORTEDPROTOCOL "Unsupported URL Type 'workspace:'"`; historical pnpm v9 breakage (<https://github.com/coollabsio/coolify/issues/2250>); version pinning quirks (<https://github.com/coollabsio/coolify/issues/3324>).
- The only working nixpacks-monorepo pattern (used by the maintainers' own example <https://github.com/coollabsio/coolify-examples/tree/main/turbo-nextjs>): base dir = repo root + explicit commands, e.g. build `pnpm turbo build --filter=<app>`, start `cd apps/<app> && pnpm start`. Produces fat whole-workspace images. Treat as legacy/fallback only.

### Railpack build pack (Beta)

- Nixpacks' successor; merged into Coolify 2026-05-11 (<https://github.com/coollabsio/coolify/pull/9117>), shipped in **v4.1.x**, marked **Beta** in docs (<https://coolify.io/docs/applications/build-packs/railpack>).
- Builds via `docker buildx build --builder coolify-railpack` (dedicated docker-container builder, ADJ:2675-2685) — its cache lives in the buildx builder, not the default daemon cache.
- Config: `railpack.json` at the app root or `RAILPACK_*` env vars. Monorepo support is young; do not base a 6-app migration on it yet, but it is the successor to watch.

### Docker Compose build pack

```bash
docker compose --project-name {uuid} --project-directory {workdir} \
  -f {workdir}{compose_location} build --pull {--no-cache if forced}    # ADJ:762-764
```

- `Docker Compose Location` is combined with Base Directory (docs: <https://coolify.io/docs/applications/build-packs/docker-compose>).
- Per-service `build.context` in the compose file resolves against `--project-directory` = workdir → each service CAN use repo root as context with its own `dockerfile:`.
- **Why it's a poor fit for many-app monorepos:** one resource = one deploy unit (every matching push rebuilds/redeploys *all* services; watch paths apply to the resource as a whole); **all env vars are injected into every service** — one shared `.env` for the project, each container sees every other container's secrets (open improvement <https://github.com/coollabsio/coolify/issues/7655>, fix planned for v5); open build bugs: empty/incomplete build context making `COPY` fail (<https://github.com/coollabsio/coolify/issues/6002>, OPEN), build cache not utilized (<https://github.com/coollabsio/coolify/issues/7040>), webhook deploys reusing cache even when disabled (<https://github.com/coollabsio/coolify/issues/6133>).
- Legitimate use: tightly-coupled service groups that must always ship together, or as a fallback when per-app dockerfile-location handling misbehaves.

## Decision table

| Situation | Build pack |
|---|---|
| pnpm/turbo workspace, one Coolify app per `apps/*` | **Dockerfile** (base dir `/`, dockerfile location per app) |
| Can't write Dockerfiles yet, need something running today | Nixpacks, base dir `/`, explicit `--filter` commands (fat images) |
| Future auto-build migration path | Railpack (Beta) — re-evaluate each minor release |
| Services that must deploy as one atomic unit | Docker Compose pack at repo root (accept shared envs + all-services rebuilds) |
| Build load outgrows the server | Pre-build in CI → Coolify "Docker Image" resource (out of scope here), or attach a dedicated Coolify build server |
