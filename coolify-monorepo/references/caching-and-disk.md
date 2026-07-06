# Build caches & disk on the Coolify build host

Monorepos multiply builds (N apps × every shared-package commit). Cache health decides whether that's 40 s or 8 min per app — and whether the disk survives. Four cache layers exist; know who owns each.

## Layer 1 — same-SHA build skip (Coolify's own)

Before building, Coolify checks whether an image tagged with the current commit SHA already exists locally/in registry (`check_image_locally_or_remotely()` → `should_skip_build()`, `ApplicationDeploymentJob.php:1245-1290`):

- Image exists + no build-configuration diff → log: **"No build configuration changed & image found (…) with the same Git Commit SHA. Build step skipped."** — the old image is redeployed as-is.
- Image exists + build config changed → "Build configuration changed. Rebuilding image."
- This is why re-clicking Deploy at the same commit is a no-op build, and it's a documented source of "deployment finished but serving stale code" confusion in monorepos (community post-mortem: <https://jdmcasanova.com/blog/coolify-monorepo-silent-skip> — their root cause was a wrong build context + this skip masking it; "The dashboard will not tell you when a deploy is a no-op. You have to look at the live output.").
- Bypass: **force deploy** — UI "Force deploy without cache" or `GET /api/v1/deploy?uuid=<uuid>&force=true` (adds `--no-cache` too).

## Layer 2 — Docker layer cache (the daemon's)

- Default behavior **reuses layer cache across deployments** of the same app: plain `docker build` without `--no-cache` (see command construction, `ADJ:3615+`). Nixpacks builds additionally pass a stable `--cache-key '{app-uuid}'`.
- `--no-cache` is applied only when: per-app **Disable Build Cache** is on (`disable_build_cache` → forces `force_rebuild`, `ADJ:214-217`) or a one-off force deploy. Keep the toggle **off** ([discussion #4401](https://github.com/coollabsio/coolify/discussions/4401)).
- **Include Source Commit in Build** = off, or the injected SHA build-arg invalidates cache every commit ([docs](https://coolify.io/docs/applications/build-packs/dockerfile)).
- Cache correctness in a workspace: layer cache keys on the bytes COPY'd from the context. With Base Directory `/` the context contains `packages/`, so shared-package changes correctly invalidate `COPY` layers. With a wrong (subfolder) context, shared changes are invisible → stale-but-"successful" images. Context correctness IS cache correctness.
- BuildKit **cache mounts** work (Coolify sets `DOCKER_BUILDKIT=1` when supported): use `RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile` to keep the pnpm store warm across builds of ALL apps (shared `id=` = shared mount).

## Layer 3 — BuildKit GC (the silent cache killer)

BuildKit garbage-collects its build cache **independently of Coolify**, by default evicting unused entries after **~48 h** — so weekly deploys always build cold (base image re-pull, full reinstall). Write-up: <https://www.loopwerk.io/articles/2026/docker-buildkit-cache-coolify/>.

Fix once per build host — `/etc/docker/daemon.json`:

```json
{
  "builder": {
    "gc": {
      "enabled": true,
      "defaultKeepStorage": "20GB"
    }
  }
}
```

then `systemctl restart docker` (brief downtime for running containers' management plane, not the containers). Size `defaultKeepStorage` ≈ (Σ per-app cache) + pnpm-store cache mount; for 6 Node apps 20–30 GB is realistic.

Note: the Railpack pack builds via a separate `docker buildx` builder (`coolify-railpack`) with its **own** GC config, not the daemon default.

## Layer 4 — Coolify Automated Cleanup (the loud cache killer)

Coolify's cleanup (Server → Advanced) removes stopped managed containers, unused images, **and "Clears Docker build cache"** — docs: <https://coolify.io/docs/knowledge-base/server/automated-cleanup>. Triggers: disk-usage threshold (default ~80%) and/or cron when "Force Docker Cleanup" is enabled. There is **no setting to preserve build cache** during cleanup.

Policy that works:

- Schedule cleanup at a fixed low-traffic cron instead of letting the threshold fire mid-day.
- Accept: the first build of each app after cleanup is cold. If cleanup fires daily, your cache is effectively dead — fix the disk instead.
- Old images accumulate **per commit SHA per app** (that's how Layer 1 works) — image cleanup is what actually returns disk; build-cache clearing is collateral. Budget disk = Σ(app image size × retained SHAs) + keepStorage + repo clones in `/artifacts` (transient).

## Turborepo cache (application-level, optional)

- `turbo` caches task outputs keyed by input hashes. Inside Docker builds each build starts fresh — turbo's local cache does nothing there **unless** you mount it: `RUN --mount=type=cache,id=turbo,target=/repo/.turbo pnpm turbo build --filter=<app>` (plus `"cacheDir": ".turbo"` awareness) — nice-to-have, second-order vs layer cache.
- **Remote cache** makes turbo hits survive any Docker/BuildKit eviction: Vercel-hosted, or self-hosted `ducktors/turborepo-remote-cache` — which itself deploys fine as a Coolify app. Wire via `TURBO_API`/`TURBO_TOKEN`/`TURBO_TEAM` build-time envs. Worth it once cold builds hurt; not required on day one.
- Details: [turborepo-graph-and-cache.md](turborepo-graph-and-cache.md).

## Build performance checklist

- [ ] `daemon.json` builder GC configured on every build host
- [ ] Automated Cleanup on cron, not threshold-panic
- [ ] Root `.dockerignore` (context upload for base-dir `/` is the whole repo — exclude `.git`, `**/node_modules`, data dumps)
- [ ] `turbo prune --docker` Dockerfiles (lockfile-only layer for installs → dependency layer survives source changes)
- [ ] pnpm store cache mount shared across apps (`id=pnpm`)
- [ ] Server concurrent-build limit sized to RAM (N-app fan-out queues, doesn't parallelize infinitely)
- [ ] Known bug if using compose pack: cache reused on webhook deploys even when disabled ([#6133](https://github.com/coollabsio/coolify/issues/6133)); cache not utilized at all in some compose builds ([#7040](https://github.com/coollabsio/coolify/issues/7040))
