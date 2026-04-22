// scripts/bundle.ts
// Standalone AdminJS pre-bundler. Run in CI/CD or image build — NOT at server startup.
//
// Usage:
//   bun run scripts/bundle.ts
//
// Prereqs:
//   1. bun add -d @adminjs/bundler
//   2. src/admin/index.ts must `export const componentLoader = new ComponentLoader();`
//   3. Set ADMIN_JS_SKIP_BUNDLE="true" in prod env so the server skips re-bundling.

import { bundle } from "@adminjs/bundler";
import { componentLoader } from "../src/admin";

const DEST = "public/admin-assets";

await bundle({
    destinationDir: DEST,
    componentLoader,
    // Enable versioned file names for CDN cache-busting.
    // Omit `versioning` for fixed-name output (bundle.js, entry.js, etc.).
    versioning: {
        manifestPath: `${DEST}/manifest.json`,
    },
});

console.log(`✓ AdminJS bundle written to ${DEST}/`);

// After running, wire the manifest into your AdminJS config:
//
//   import manifest from "../public/admin-assets/manifest.json" with { type: "json" };
//
//   new AdminJS({
//       componentLoader,
//       assets: {
//           coreScripts: [
//               { src: `/admin-assets/${manifest.entry}`, cors: true },
//               { src: `/admin-assets/${manifest.bundle}`, cors: true },
//               { src: `/admin-assets/${manifest.designSystemBundle}`, cors: true },
//               { src: `/admin-assets/${manifest.components}`, cors: true },
//           ],
//       },
//       // ...
//   });
//
// And serve the folder via @elysiajs/static:
//
//   import { staticPlugin } from "@elysiajs/static";
//
//   new Elysia()
//       .use(staticPlugin({
//           assets: "public/admin-assets",
//           prefix: "/admin-assets",
//           headers: { "Cache-Control": "public, max-age=31536000, immutable" },
//       }))
//       .use(adminRouter);
