# Nuxt Integration

The recommended path is the [Nuxt OG Image](https://nuxtseo.com/docs/og-image/getting-started/introduction) module with its [Takumi renderer](https://nuxtseo.com/docs/og-image/renderers/takumi). It already knows how to render Vue components as OG images.

## 1. Install the module and Takumi binding

```bash
npx nuxt module add og-image
```

Then install the Takumi package for your runtime:

- Node/Bun/default Nitro preset:
  ```bash
  npm install -D @takumi-rs/core
  ```
- Cloudflare Workers, Vercel Edge, or any edge Nitro preset:
  ```bash
  npm install -D @takumi-rs/wasm
  ```

## 2. Set Takumi as the default renderer

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  ogImage: {
    defaults: {
      renderer: "takumi",
    },
  },
});
```

## 3. Create a `.takumi.vue` template

Nuxt OG Image detects the Takumi renderer from the `.takumi.vue` suffix:

```vue
<!-- components/OgImage/BlogPost.takumi.vue -->
<script setup lang="ts">
defineProps<{
  title: string;
  description?: string;
}>();
</script>

<template>
  <div class="w-full h-full flex flex-col justify-center bg-gray-950 text-white p-16">
    <p class="text-6xl font-bold leading-tight">
      {{ title }}
    </p>
    <p v-if="description" class="mt-6 text-2xl text-gray-400">
      {{ description }}
    </p>
  </div>
</template>
```

Classes here go through Takumi's native Tailwind parser — see [tailwind](tailwind.md) for what's supported and when to prefer a compiled stylesheet.

## 4. Attach the template to a page

```vue
<!-- pages/blog/[slug].vue -->
<script setup lang="ts">
defineOgImageComponent("BlogPost", {
  title: "Takumi + Nuxt",
  description: "Render OG images with Nuxt OG Image.",
});
</script>
```

Nuxt OG Image will generate and cache the image at the page's canonical URL plus `/og.png`.

## Gotchas

- **Flexbox requires `display: flex` / the `flex` class explicitly.** v1 defaults to `inline` — see [layout-engine](layout-engine.md#display-defaults-v1-gotcha).
- **Fonts beyond Geist (core) / Manrope (wasm)** must be loaded via Nuxt OG Image's font config; Takumi does not read system fonts. See [fonts](fonts.md).
- **If `@takumi-rs/core` fails to load** under pnpm, add `public-hoist-pattern[]=@takumi-rs/core-*` to `.npmrc`. See [troubleshooting](troubleshooting.md).

## Upstream docs

- Nuxt OG Image: https://nuxtseo.com/docs/og-image
- Takumi renderer: https://nuxtseo.com/docs/og-image/renderers/takumi
