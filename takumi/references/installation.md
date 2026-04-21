# Installation

## Package choice

Always install the unified entrypoint. Do **not** install `@takumi-rs/core` or `@takumi-rs/wasm` directly — `takumi-js` auto-selects the right binding at runtime.

```bash
npm i takumi-js
# or: pnpm add takumi-js / yarn add takumi-js / bun add takumi-js
```

| Environment | Binding picked | Embedded fonts |
| ----------- | -------------- | -------------- |
| Node.js / Bun | `@takumi-rs/core` (native N-API, multithreaded via Rayon) | Geist, Geist Mono |
| Cloudflare Workers, Vercel Edge, browser | `@takumi-rs/wasm` (WASM + SIMD) | Manrope (variable, Latin only) |

The WASM build does **not** support WOFF font loading and ships with only Manrope. If you need non-Latin scripts or a monospace family on edge, bundle a font explicitly via the `fonts` option.

## Next.js

Mark the native core as a server-external package so Next.js doesn't try to bundle it:

```ts
// next.config.ts
import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["@takumi-rs/core"],
};

export default config;
```

Without this, Next.js will attempt to bundle the N-API binary and the build fails.

## pnpm / yarn `.npmrc` (native binding hoisting)

The `@takumi-rs/core` package has platform-specific optional deps (`@takumi-rs/core-linux-x64-gnu`, `@takumi-rs/core-darwin-arm64`, etc.). Virtual-store package managers (pnpm, classic yarn) won't hoist them by default and you'll get:

```
Error: Cannot find native binding.
```

Fix by adding this to `.npmrc`:

```ini
public-hoist-pattern[]=@takumi-rs/core-*
```

Then reinstall.

## Installing a specific Takumi version

Current stable release line is `1.x`. To pin:

```bash
npm i takumi-js@1
```

## Rust crate (optional)

For embedding the renderer directly in a Rust application, or porting Takumi to another language:

```toml
[dependencies]
takumi = "*"  # replace with latest
```

Docs: https://docs.rs/takumi/latest/takumi/
