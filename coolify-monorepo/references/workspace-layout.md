# Workspace layout: `apps/` + `packages/` done right

The monorepo half of the equation. Structure decisions here directly determine Coolify watch-path precision, Docker layer cache hit rates, and prune sizes.

## Canonical layout

```
repo/
├── pnpm-workspace.yaml
├── package.json              # private, root scripts only, no runtime deps
├── pnpm-lock.yaml            # ONE lockfile — the whole point
├── turbo.json
├── .dockerignore             # see dockerfile-templates.md
├── apps/                     # deployables — each maps 1:1 to a Coolify application
│   ├── api/                  #   NestJS
│   │   ├── Dockerfile        #   ← Coolify "Dockerfile Location" points here
│   │   └── package.json      #   name: @acme/api
│   └── tg-worker/            #   Bun/tsx service
└── packages/                 # never deployed directly — only consumed by apps
    ├── shared-core/          #   name: @acme/shared-core
    ├── db/                   #   drizzle schema + client
    └── telegram/             #   shared MTProto/gramio helpers
```

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
```

Rules:

- **`apps/` = deploy units, `packages/` = library units.** An app is allowed to depend on packages; packages may depend on packages; **apps never depend on apps** (if two apps share code, extract a package).
- Every workspace package gets a **scoped name** (`@acme/db`) and apps reference them with the **workspace protocol**: `"@acme/db": "workspace:*"`. pnpm links them locally and refuses to resolve from the registry — typo-proof.
- Root `package.json` is `"private": true`, holds only `devDependencies` shared by tooling (turbo, typescript, biome/eslint) and root scripts. Runtime deps ALWAYS live in the app/package that imports them — root-installed runtime deps break `turbo prune` and `pnpm deploy` output.
- **One lockfile at the root.** Delete per-app lockfiles during migration; `pnpm install --frozen-lockfile` at root is the only install command anyone runs (locally, in Docker, anywhere).
- Version alignment across apps: pnpm **catalogs** (`catalog:` protocol in `pnpm-workspace.yaml`) pin shared dep versions once — kills drift between 6 apps without a bot.

## Internal package patterns (pick per package)

| Pattern | How | Use when |
|---|---|---|
| **Just-in-time (source exports)** | `"exports": { ".": "./src/index.ts" }` — consumers compile it via their own tsc/bundler/tsx/bun | Default for TS-everywhere repos; zero build step, `turbo prune` copies source; requires consumers that execute TS (tsx, bun, or bundling apps like NestJS+swc/webpack) |
| **Compiled** | package has its own `build` (tsc → `dist/`), exports `./dist/index.js` + types | Needed when a consumer runs plain `node`, when build tooling differs, or for publishing; slots into turbo graph via `dependsOn: ["^build"]` |

Just-in-time is simpler and usually right for Bun/tsx services; NestJS apps consuming JIT packages must ensure their compiler includes the package sources (nest build with webpack, or tsc project references / `tsconfig` `paths` + `includes`).

## Dependency-graph hygiene (this is what "maintaining the graph" means)

- **No cycles.** pnpm tolerates workspace cycles at install, but turbo task graphs and prune outputs degrade. Check: `pnpm ls -r --depth -1` for inventory; `turbo ls` / `turbo run build --dry` shows the resolved graph; add `madge --circular` or `turbo boundaries` (turbo ≥2.x, experimental) in CI.
- **Depend narrow.** Each `apps/<app>/package.json` lists exactly the `@acme/*` it imports — nothing transitively assumed. The dependency closure is what `turbo prune` puts in the image and what your Coolify watch paths should mirror (`turbo ls --filter=<app>...`  → list of `packages/*` for that app's watch paths).
- **Types-only sharing counts.** If an app imports types from `@acme/db`, that's a real dependency (declare it) — otherwise prune/watch-paths miss it and you get stale builds.
- Node version pinned once: root `.nvmrc` / `engines` + same base image tag in all Dockerfiles.
- Env validation per app (zod/envalid at boot) — with per-app Coolify env vars, a missing var should crash on start, not at 3am.

## Why this layout is exactly what Coolify needs

- One root lockfile + `packages/` in the build context ⇒ Base Directory `/` requirement ([coolify-build-model.md](coolify-build-model.md)).
- 1:1 `apps/<app>` ↔ Coolify application ⇒ clean per-app watch paths, env vars, domains, rollbacks.
- Explicit per-app dependency closure ⇒ minimal `turbo prune` images and precise watch paths ⇒ fewer, faster, correct rebuilds.
