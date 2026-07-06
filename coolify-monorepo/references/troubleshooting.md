# Troubleshooting: symptom → cause → fix

Fast diagnosis table for monorepo-on-Coolify incidents. Read the **build log**, not the dashboard status — "Finished" ≠ "built" (same-SHA skips log "Build step skipped.").

## Build failures

| Symptom | Cause | Fix |
|---|---|---|
| `COPY pnpm-lock.yaml: not found` / `COPY packages/...: no such file or directory` | Base Directory is `/apps/<app>` → build context excludes repo root | Base Directory `/`, Dockerfile Location `/apps/<app>/Dockerfile` ([coolify-build-model.md](coolify-build-model.md)) |
| Dockerfile not found at build | Dockerfile Location is resolved **relative to Base Directory** (concatenated), not repo root | With base dir `/` use the full repo-root path `/apps/<app>/Dockerfile`; with base dir `/apps/<app>` it would be just `/Dockerfile` |
| `ERR_PNPM_OUTDATED_LOCKFILE` in image | Per-app lockfile leftovers or root lockfile not committed | One root `pnpm-lock.yaml`; delete nested ones |
| npm `EUNSUPPORTEDPROTOCOL Unsupported URL Type "workspace:"` | Nixpacks fell back to npm (workspace root mis-detection) | Move to Dockerfile pack; or nixpacks with base dir `/` + explicit pnpm commands ([coolify-build-model.md](coolify-build-model.md)) |
| Compose pack: COPY fails though files exist in repo | Compose build-context handling bugs — [#6002](https://github.com/coollabsio/coolify/issues/6002) (open), historical [#5182](https://github.com/coollabsio/coolify/issues/5182)/[#1996](https://github.com/coollabsio/coolify/issues/1996) | Prefer per-app Dockerfile resources; if stuck on compose, keep contexts explicit (`context: .` at root) |
| Build wizard "lost" my Base Directory (deploy-key repo) | Open bug [#10319](https://github.com/coollabsio/coolify/issues/10319) | Re-enter Base Directory in Build settings after creation; prefer GitHub App source |
| OOM / server melts during multi-app fan-out | N parallel builds after a `packages/**` push | Lower server concurrent-build limit; consider a dedicated build server |

## Stale / missing deployments

| Symptom | Cause | Fix |
|---|---|---|
| "Deployment finished" but old code serves | (a) same-SHA image skip — log says "Build step skipped."; (b) wrong build context hiding changed files from COPY layers (cache hit on stale content) | Force deploy `GET /api/v1/deploy?uuid=<uuid>&force=true`; then fix the root cause (context / base dir). Post-mortem of this exact failure: <https://jdmcasanova.com/blog/coolify-monorepo-silent-skip> |
| App didn't deploy on a push that touched its code | Watch paths didn't match: pattern typo (`*` doesn't cross `/` — use `**`), file outside listed dirs, or **>20-commit push truncated the changed-file list** ([GitHub webhook payload limit](https://docs.github.com/en/webhooks/webhook-events-and-payloads)) | Inspect the webhook delivery response (per-app status + `changed_files` + `watch_paths` echoed back); fix globs; force deploy now |
| App deploys on EVERY push despite watch paths | Watch paths field actually blank (blank = always deploy), or you're on an ancient beta with the multi-rule bug [#5800](https://github.com/coollabsio/coolify/issues/5800) (fixed by [PR #6699](https://github.com/coollabsio/coolify/pull/6699)) | Confirm saved value via API `GET /api/v1/applications/<uuid>` → `watch_paths`; upgrade if < v4.0.0 stable |
| Nothing deploys on push | Webhook not arriving (deploy-key source without manual webhook; GitHub App suspended), or all commits `[skip ci]` | GitHub → App/webhook Recent Deliveries; check Coolify server reachability |
| PR previews ignore watch paths | By design — push events only ([#6503](https://github.com/coollabsio/coolify/issues/6503)) | Accept or disable previews for noisy apps |

## Slow builds / disk

| Symptom | Cause | Fix |
|---|---|---|
| Random cold builds (base image re-pull, full reinstall) despite no changes | BuildKit GC evicted cache (~48 h default) | `daemon.json` builder GC `defaultKeepStorage` ([caching-and-disk.md](caching-and-disk.md); <https://www.loopwerk.io/articles/2026/docker-buildkit-cache-coolify/>) |
| Builds cold every morning | Coolify Automated Cleanup ran (it "Clears Docker build cache" — [docs](https://coolify.io/docs/knowledge-base/server/automated-cleanup)) | Schedule cleanup deliberately; add disk so threshold cleanup stops firing |
| Every commit rebuilds all layers | "Include Source Commit in Build" on, or Disable Build Cache on, or COPY-everything-first Dockerfile | Toggle both off; adopt prune-style layering ([dockerfile-templates.md](dockerfile-templates.md)) |
| Disk creeping up | Per-SHA images accumulate per app (by design of the skip check) + build cache + `/artifacts` leftovers | Cleanup cron + image retention; check `docker system df` |
| Context upload slow (`transferring context: 500MB+`) | Base dir `/` sends whole repo; `.dockerignore` missing/weak | Root `.dockerignore` (exclude `.git`, `**/node_modules`, data) |

## Debugging commands

```bash
# What Coolify thinks the app config is
curl -s -H "Authorization: Bearer $COOLIFY_TOKEN" \
  "$COOLIFY_URL/api/v1/applications/<uuid>" | jq '{build_pack, base_directory, dockerfile_location, watch_paths}'

# Force deploy one app / several apps
curl -s -H "Authorization: Bearer $COOLIFY_TOKEN" \
  "$COOLIFY_URL/api/v1/deploy?uuid=<uuid>&force=true"

# Reproduce the exact build locally (what Coolify runs, minus the helper container)
docker build -f apps/<app>/Dockerfile -t local-test .   # from repo root!

# Layer-cache autopsy
docker history <image>          # which layer got fat / rebuilt
docker buildx du                # BuildKit cache usage
docker system df                # images vs build-cache vs volumes disk split
```

## Where behavior is defined (for reading Coolify source when docs are silent)

Branch `v4.x` of <https://github.com/coollabsio/coolify>:

- `app/Jobs/ApplicationDeploymentJob.php` — clone, workdir (`:244`), build commands (dockerfile `:3615`, nixpacks `:3573`, compose `:762`, railpack `:2675`), cache flags (`:214`), same-SHA skip (`:1245`)
- `app/Models/Application.php` — clone command generation (`:1559`), watch-paths parsing/matching (`:2096-2215`)
- `app/Http/Controllers/Webhook/Github.php` — push fan-out, changed-files extraction, per-app trigger decision (`:50-135`)
