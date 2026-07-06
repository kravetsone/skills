# Dockerfile templates for Coolify (Base Directory `/`)

All templates assume: Coolify Build Pack = Dockerfile, Base Directory = `/` (context = repo root), Dockerfile Location = `/apps/<app>/Dockerfile`, BuildKit available (Coolify auto-enables it). Replace `@acme/<app>` with the package name, not the folder name.

## Root `.dockerignore` (mandatory)

With base dir `/`, EVERY app build sends the whole repo as context. One root `.dockerignore`:

```
.git
**/node_modules
**/dist
**/.turbo
**/.next
*.log
docs
**/*.md
!README.md
.env*
data/
dumps/
```

Never ignore: `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, any `package.json`.

## 1. Compiled Node app (NestJS) — `turbo prune` multi-stage

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /repo

# -- prune: shrink repo to this app's dependency closure
FROM base AS pruner
COPY . .
RUN pnpm dlx turbo prune @acme/api --docker

# -- install: manifests + lockfile ONLY → this layer survives source-only commits
FROM base AS installer
COPY --from=pruner /repo/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# -- build
FROM installer AS builder
COPY --from=pruner /repo/out/full/ .
RUN pnpm turbo build --filter=@acme/api

# -- prod deps only, flattened for the app
FROM builder AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm --filter=@acme/api deploy --prod /out

# -- runtime
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /out/node_modules ./node_modules
COPY --from=builder /repo/apps/api/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

Notes: the `id=pnpm` cache mount is shared across ALL apps' builds on the host (one warm store). `pnpm deploy` needs the package to be deployable from a workspace — on pnpm ≥10 add `"inject-workspace-packages=true"` to `.npmrc` if deploy complains about workspace deps; alternative is copying `node_modules` from `installer` (bigger image, zero fuss).

## 2. Bun service

```dockerfile
# syntax=docker/dockerfile:1
FROM oven/bun:1 AS base
WORKDIR /repo

FROM base AS pruner
COPY . .
RUN bun x turbo prune @acme/tg-worker --docker

FROM base AS installer
COPY --from=pruner /repo/out/json/ .
COPY --from=pruner /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
# Bun reads package.json workspaces; simplest reliable path in a pnpm repo:
RUN bun install --frozen-lockfile || bun install

FROM installer AS runner
COPY --from=pruner /repo/out/full/ .
ENV NODE_ENV=production
WORKDIR /repo/apps/tg-worker
CMD ["bun", "run", "src/index.ts"]
```

Bun executes TS directly — no build stage; just-in-time internal packages (source exports) work as-is. If the repo standardizes on `bun.lock` workspaces instead of pnpm, drop the pnpm-lock line and keep `bun install --frozen-lockfile`. Keep MTProto/session state OUT of the image (volumes).

## 3. Node + tsx runtime service (no compile step)

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /repo

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo prune @acme/scraper --docker

FROM base AS runner
ENV NODE_ENV=production
COPY --from=pruner /repo/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod=false   # tsx + TS needed at runtime
COPY --from=pruner /repo/out/full/ .
WORKDIR /repo/apps/scraper
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
```

Runtime-TS keeps devDeps in the image (tsx, typescript). Acceptable for internal services; when image size matters, move the app to pattern 1 with `tsup`/`tsc`.

## 4. Fallback: one compose file at repo root (Docker Compose build pack)

Only if per-app resources are blocked (see cons in [coolify-build-model.md](coolify-build-model.md)):

```yaml
# docker-compose.yml at repo root; Coolify: compose pack, Base Directory /, Compose Location /docker-compose.yml
services:
  api:
    build: { context: ., dockerfile: apps/api/Dockerfile }
  tg-worker:
    build: { context: ., dockerfile: apps/tg-worker/Dockerfile }
```

Every service rebuilds/redeploys together; all env vars are shared across services (<https://github.com/coollabsio/coolify/issues/7655>). The per-app Dockerfiles above are reused unchanged — which keeps the escape hatch cheap in both directions.

## Log-verification (first deploy of any template)

In the Coolify build log confirm the final build command shape:

```
docker build ... -f /artifacts/<uuid>/apps/<app>/Dockerfile ... /artifacts/<uuid>
```

Trailing context = `/artifacts/<uuid>` (repo root). If it ends with `/apps/<app>`, Base Directory is wrong and every `COPY pnpm-lock.yaml` is about to fail — or worse, succeed against a stale nested lockfile.
