# Next.js Integration

Full walk-through for Next.js App Router. If you're migrating from `@vercel/og`, see [migration-vercel-og](migration-vercel-og.md) for the short version.

## 1. Install

```bash
npm i takumi-js
```

(or `pnpm add takumi-js` / `yarn add takumi-js` / `bun add takumi-js`)

## 2. Mark the core as a server-external package

`@takumi-rs/core` ships as a native N-API binary. Next.js must not try to bundle it:

```ts
// next.config.ts
import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["@takumi-rs/core"],
};

export default config;
```

On pre-15 Next.js versions, use `experimental.serverComponentsExternalPackages`:

```ts
const config: NextConfig = {
  experimental: { serverComponentsExternalPackages: ["@takumi-rs/core"] },
};
```

## 3. Build the OG component

```tsx
// app/og/OgImage.tsx
type OgImageProps = {
  title: string;
  description: string;
};

export default function OgImage({ title, description }: OgImageProps) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",                 // v1 requires explicit flex
        flexDirection: "column",
        justifyContent: "center",
        padding: "64px",
        backgroundImage: "linear-gradient(to bottom right, #fff7ed, #fecaca)",
      }}
    >
      <p style={{ fontSize: 72, fontWeight: 700, color: "#111827" }}>{title}</p>
      <p style={{ fontSize: 42, fontWeight: 500, color: "#4b5563" }}>{description}</p>
    </div>
  );
}
```

## 4. App Router route handler

```tsx
// app/og/route.tsx
import { ImageResponse } from "takumi-js/response";
import OgImage from "./OgImage";

export function GET(request: Request) {
  const url = new URL(request.url);
  const title = url.searchParams.get("title") ?? "Takumi + Next.js";
  const description = url.searchParams.get("description") ?? "Render OG images with React.";

  return new ImageResponse(<OgImage title={title} description={description} />, {
    width: 1200,
    height: 630,
  });
}
```

Visit `/og?title=Hello&description=World` and you'll get a PNG.

## 5. Wiring it into `generateMetadata`

For per-page OG images in a site:

```tsx
// app/blog/[slug]/page.tsx
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);

  const ogUrl = new URL("/og", "https://example.com");
  ogUrl.searchParams.set("title", post.title);
  ogUrl.searchParams.set("description", post.excerpt);

  return {
    title: post.title,
    openGraph: { images: [ogUrl.toString()] },
    twitter: { card: "summary_large_image", images: [ogUrl.toString()] },
  };
}
```

## 6. Optional: reuse a Renderer across routes

For higher throughput, construct a single `Renderer` at module scope and pass it to every `ImageResponse`:

```ts
// lib/og-renderer.ts
import { Renderer } from "takumi-js/node";
import inter from "./inter.ttf" with { type: "bytes" };

export const renderer = new Renderer({ fonts: [inter] });
```

```tsx
// app/og/route.tsx
import { renderer } from "@/lib/og-renderer";

return new ImageResponse(<Og />, {
  width: 1200,
  height: 630,
  renderer,
});
```

## 7. Tailwind — compiled stylesheet

```tsx
// app/og/route.tsx
import stylesheet from "@/app/globals.css?inline";

return new ImageResponse(<Og />, {
  width: 1200,
  height: 630,
  stylesheets: [stylesheet],
});
```

(Requires your Vite/webpack config to support `?inline` — see [tailwind](tailwind.md).)

## 8. Caching

Next.js caches route handlers by default. For parameterized OG images, mark the route dynamic or use `revalidate`:

```ts
export const revalidate = 3600;  // cache for 1h
// or:
export const dynamic = "force-dynamic";
```

Inside the route, a `Cache-Control` header tuned for your CDN + OG-crawler behavior is usually more useful:

```ts
return new ImageResponse(<Og />, {
  width: 1200,
  height: 630,
  headers: { "Cache-Control": "public, max-age=3600, s-maxage=31536000" },
});
```

## Gotchas

- **`display: "flex"` is not optional.** See [layout-engine](layout-engine.md#display-defaults-v1-gotcha).
- **pnpm/yarn:** add `public-hoist-pattern[]=@takumi-rs/core-*` to `.npmrc` or you'll hit `Cannot find native binding` — see [troubleshooting](troubleshooting.md).
- **Edge runtime**: if you set `export const runtime = "edge"`, Takumi will use `@takumi-rs/wasm` (single-threaded, Manrope-only default font). For parallel throughput keep the default Node.js runtime.
