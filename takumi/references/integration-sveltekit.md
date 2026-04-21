# SvelteKit Integration

## 1. Install

```bash
npm i takumi-js
```

## 2. Build a Svelte component with injected CSS

To keep component styles in the same file, set the `css` option to `injected`:

```svelte
<!-- src/lib/components/OgImage.svelte -->
<script lang="ts">
  let { title, description } = $props();
</script>

<svelte:options css="injected" />

<div
  id="og-image"
  class="w-full h-full flex items-center justify-center p-12 flex-col whitespace-pre-wrap leading-normal"
>
  <p class="text-7xl font-semibold text-black">
    {title}
  </p>
  <p class="text-5xl font-medium text-black/75">
    {description}
  </p>
</div>

<style>
  #og-image {
    background-image: linear-gradient(to bottom right, var(--color-orange-50), var(--color-red-200));
  }
</style>
```

## 3. Server route handler

Render the Svelte component to HTML with `svelte/server`, then pass the combined `head + body` into `ImageResponse`:

```ts
// src/routes/og-image/+server.ts
import { render } from "svelte/server";
import style from "../app.css?inline";
import ImageResponse from "takumi-js/response";
import OgImage from "$lib/components/OgImage.svelte";
import type { RequestEvent } from "./$types";

export async function GET({ url }: RequestEvent) {
  const { body, head } = await render(OgImage, {
    props: {
      title: url.searchParams.get("title"),
      description: url.searchParams.get("description"),
    },
  });

  return new ImageResponse(`${head}${body}`, {
    width: 1200,
    height: 630,
    stylesheets: [style],
    fonts: [
      {
        name: "Geist",
        data: () =>
          fetch("https://takumi.kane.tw/fonts/Geist.woff2").then((r) => r.arrayBuffer()),
      },
    ],
  });
}
```

Notes:
- `ImageResponse` accepts a pre-rendered HTML string, not just JSX. That's why this flow works.
- If you use Tailwind, import the compiled app stylesheet via `?inline` and pass it as `stylesheets`.

## 4. Request the endpoint

Visit `/og-image?title=Hello&description=World` — you'll get a PNG.

## Gotchas

- **`display: flex` is mandatory** on containers that need flex layout (v1 default is `inline`). Spelled as the `flex` Tailwind class in the example above.
- The Geist font in the example is fetched from the Takumi docs site for demo purposes; in production, bundle the font as a static asset and import it as an `ArrayBuffer`.
- If your Svelte component relies on browser-only styling (pseudo-elements, `position: sticky`), it won't render the same way — see [layout-engine](layout-engine.md).
