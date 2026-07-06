# Watch Paths & webhook fan-out

Selective redeploys are the whole point of a monorepo on Coolify. This is the exact behavior in v4.1.x, from source (`app/Models/Application.php:2096-2215`, `app/Http/Controllers/Webhook/Github.php`).

## Webhook fan-out model

On a push event Coolify:

1. Extracts changed files from the payload: `commits.*.added` + `commits.*.removed` + `commits.*.modified`, flattened + deduped (`Github.php:50-53`). **It never calls the GitHub compare API.**
2. Finds **every** application on that repo + branch (GitHub App: by `repository_project_id`; manual/deploy-key: by repo full name).
3. For each app: skips if server not functional / app not deployable; then
   ```php
   $is_watch_path_triggered = $application->isWatchPathsTriggered($changed_files);
   if ($is_watch_path_triggered || blank($application->watch_paths)) { queue deployment; }
   ```
   (`Github.php:133-135`)

⇒ **Blank watch paths = deploy on every push.** Non-blank = deploy only if ≥1 changed file survives the filter. Each app decides independently; one push can queue 0..N deployments.

Also: pushes where **all** commit messages contain `[skip ci]`/`[skip cd]` are skipped entirely.

## Pattern grammar (exact)

- **One pattern per line** (textarea, newline-separated).
- On save, each line is trimmed and a **leading `/` is stripped** (`parseWatchPaths`) — patterns are matched against **repo-root-relative** file paths (`apps/foo/src/x.ts`), regardless of the app's Base Directory.
- Glob support (`globToRegex`): `*` (anything except `/`), `**` (any depth incl. `/`), `?`, `[abc]`, `[!abc]`.
- **`!` prefix = exclusion.** Evaluation is order-based, **last matching pattern wins** (gitignore semantics). If ONLY exclusion patterns exist, files matching none of them are included by default.
- A file is "triggering" if its final state after all patterns is *included*; the app deploys if any changed file triggers.

### Recommended set per workspace app

```
apps/<app>/**
packages/**
pnpm-lock.yaml
pnpm-workspace.yaml
package.json
turbo.json
!apps/<app>/**/*.md
```

Tighten `packages/**` to the packages this app actually depends on (`packages/shared-core/**`, `packages/telegram/**`, …) once the graph is stable — `turbo ls --filter=<app>...` / `turbo run build --dry=json --filter=<app>` prints the dependency closure to derive the list. Keep the root manifests: a lockfile or turbo.json change can alter any app's build output.

## Reliability record & caveats

| Item | Status |
|---|---|
| Multiple lines triggering deploys for non-matching files ([#5800](https://github.com/coollabsio/coolify/issues/5800), beta.416) and "watch paths do nothing" ([#2755](https://github.com/coollabsio/coolify/issues/2755), beta.306) | **Fixed** by [PR #6699](https://github.com/coollabsio/coolify/pull/6699) — the last-match-wins matcher described above is that fix. Multi-line watch paths are reliable on ≥ v4.0.0 stable |
| Watch paths on PR preview deployments | **Not applied** — push events only ([#6503](https://github.com/coollabsio/coolify/issues/6503), open) |
| **Payload truncation**: GitHub push payloads include at most **20 commits'** file lists ([GitHub webhook docs](https://docs.github.com/en/webhooks/webhook-events-and-payloads)) | Inherent. A mega-push/merge can under-report changed files → an app is **wrongly skipped**. Rare; recovery = force deploy. Prefer squash-merges / small pushes |
| Force-pushes / rebases | Changed-file lists come from the pushed commits only; rewritten history can mislead the filter the same way |
| History (why the feature exists) | Requested in [discussion #1898](https://github.com/coollabsio/coolify/discussions/1898), shipped June 2024 |

## Testing watch paths (do this on rollout)

1. Commit touching ONLY `apps/other-app/` → this app must show **no** new deployment; the webhook response (GitHub App → Advanced → Recent Deliveries) lists per-app statuses with `changed_files` and `watch_paths` — read it, it's the ground truth.
2. Commit touching `packages/<dep>/` → app must deploy.
3. Commit touching only `apps/<app>/README.md` with the `!` rule above → no deploy.

## Recovery / manual control

- Any wrongly-skipped or stale app: `GET /api/v1/deploy?uuid=<app-uuid>&force=true` (force bypasses both the watch-path decision — it's a direct deploy — and the same-SHA/image-cache skip).
- Deploy several apps: call the endpoint per uuid, or `POST /api/v1/deploy` with `uuid=<uuid1>,<uuid2>` (comma-separated list is supported by the deploy API).
- Nuclear option while debugging: clear the app's watch paths (reverts to deploy-on-every-push — wasteful but never silently stale).
