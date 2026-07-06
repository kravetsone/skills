# Turborepo: task graph, prune, filters, caches

The orchestration half. For deep turbo internals also install the official skill: `npx skills add vercel/turborepo` (see [Turborepo AI guide](https://turborepo.dev/docs/guides/ai)); machine-readable docs: <https://turborepo.dev/llms.txt>. This file covers what matters at the Coolify seam.

## turbo.json — the task graph

```jsonc
{
  "$schema": "https://turborepo.dev/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],                  // ^ = build my workspace deps first (graph order)
      "outputs": ["dist/**"],                   // what gets cached/restored
      "inputs": ["$TURBO_DEFAULT$", "!**/*.md"] // hash inputs; exclude noise
    },
    "typecheck": { "dependsOn": ["^build"] },
    "test":      { "dependsOn": ["build"] },
    "dev":       { "cache": false, "persistent": true }
  }
}
```

- `dependsOn: ["^build"]` encodes the **dependency graph**: building `@acme/api` first builds `@acme/db`, `@acme/shared-core`, … in topological order. This is the "graph" you maintain — it mirrors `workspace:*` deps in package.jsons.
- `outputs` MUST list every artifact dir or cache restores will be incomplete (classic: forgetting `.next/**` or nest's `dist/**`).
- Cache key = hash of: task inputs (files), lockfile slice, turbo.json config, relevant env vars (declare in `"env"`/`"globalEnv"` or hashes lie).
- Inspect the graph: `turbo run build --dry=json --filter=@acme/api` (full closure + hashes), `turbo ls`, `turbo run build --graph` (dot output).

## `turbo prune <pkg> --docker` — the Docker bridge

```
turbo prune @acme/api --docker    # writes ./out
out/
├── json/            # ONLY package.json files of the closure + pnpm-lock.yaml + pnpm-workspace.yaml
├── full/            # full source of app + its internal package closure
└── pnpm-lock.yaml   # pruned lockfile
```

Why it's the canonical monorepo Dockerfile pattern (docs: <https://turborepo.dev/docs/guides/tools/docker>):

1. `COPY out/json/ .` + `pnpm install --frozen-lockfile` → **install layer depends only on manifests/lockfile** → survives every source-only commit (the single biggest layer-cache win; this layer is what makes Coolify rebuilds fast).
2. `COPY out/full/ .` + `turbo build --filter=<pkg>` → source layer, small and per-app.
3. Unrelated packages never enter the image — smaller context, smaller image, fewer cache invalidations.

The prune step itself runs in an early Docker stage against the whole repo — which is why the **build context must be the repo root** (Coolify Base Directory `/`).

## Filters & affected

- `--filter=@acme/api` — the app; `--filter=@acme/api...` — app + its dependencies (closure); `--filter=...@acme/db` — everything depending on db (dependents).
- `--filter=[origin/main...HEAD]` / `--affected` — only packages changed since a ref. **On Coolify you don't need this for deploy selection** — Watch Paths do change-detection at the webhook layer, per app. Use affected-filters in pre-merge CI (typecheck/test only what changed), and use `turbo ls --filter=<app>...` output to author each app's watch paths ([watch-paths.md](watch-paths.md)).

## Caching layers with turbo on Coolify

| Cache | Lives | Survives |
|---|---|---|
| turbo local cache (`.turbo/`, `node_modules/.cache/turbo`) | inside each Docker build | nothing, unless mounted: `RUN --mount=type=cache,id=turbo,target=/repo/.turbo` |
| turbo **remote cache** | HTTP service | everything — Docker rebuilds, `--no-cache`, cleanup, even a new build server |
| Docker layer cache | daemon on build host | until BuildKit GC / Coolify cleanup ([caching-and-disk.md](caching-and-disk.md)) |

Remote cache options: Vercel-hosted (works outside Vercel; `turbo login && turbo link`) or **self-hosted open-source `ducktors/turborepo-remote-cache`** (<https://github.com/ducktors/turborepo-remote-cache>) — a small Node service with S3/filesystem storage that itself deploys as a Coolify app; point builds at it with `TURBO_API`, `TURBO_TOKEN`, `TURBO_TEAM` (build-time env vars in each Coolify app; `--api`/`--token` flags also work). Adopt when: cold builds after cache eviction hurt, or multiple build hosts. Skip while a single warm build host is fast enough.

## Nx instead of turbo?

Everything Coolify-side is identical (context, watch paths, caching). Replace prune with Nx equivalents (`nx graph`, `@nx/node` docker executors or `nx release`-generated Dockerfiles); note nixpacks' Nx autodetection is buggy (`NIXPACKS_NX_APP_NAME` issues: <https://github.com/railwayapp/nixpacks/issues/1034>) — one more reason to stay on the Dockerfile pack. For a 6-service all-backend TS repo, turbo is the lower-config choice; Nx earns its weight with generators/plugins/enforced module boundaries.
