# Tailwind CSS

Two modes — pick based on whether you already run Tailwind in your build.

## Mode 1 — Bring a compiled stylesheet (recommended)

If your project already compiles Tailwind (Vite, Next.js, etc.), import the compiled CSS as inline text and pass it via `stylesheets`. You get **full Tailwind v4** including custom theme config.

```tsx
import stylesheet from "~/styles/global.css?inline";
import { ImageResponse } from "takumi-js/response";

export async function loader() {
  return new ImageResponse(
    <div className="bg-background text-foreground flex justify-center items-center w-full h-full text-4xl">
      Hello Tailwind!
    </div>,
    { width: 1200, height: 630, stylesheets: [stylesheet] },
  );
}
```

Vite config:

```ts
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
});
```

Any bundler pattern that lets you inline a compiled CSS string works — `?inline` in Vite, `?raw` in some loaders, `fs.readFileSync` at build time, etc.

## Mode 2 — Native `tw` parser

Takumi has a built-in Tailwind-subset parser. Use the `tw` prop on any node. No bundler setup required.

```tsx
<div tw="bg-blue-500 p-4 rounded-lg">
  <h1 tw="text-white text-2xl font-bold">Hello Tailwind!</h1>
</div>
```

### Limitations of the native parser

- **No custom theme config.** Only built-in scale values + arbitrary values via `[...]` syntax.
- Covers the common subset; not every v4 plugin utility. Parser mapping reference: https://github.com/kane50613/takumi/blob/master/takumi/src/layout/style/tw/map.rs
- Arbitrary values are passed to the CSS parser, so `tw="bg-[#0ea5e9] p-[32px]"` works.
- **`animate-(--custom-property)` form is not supported** — CSS custom property resolution for `animation` is not implemented (see [animation](animation.md)). Use `animate-[move_1s_ease-in-out]` arbitrary syntax instead.

### Dynamic classes

`tw` is just a string prop, so conditional composition via `clsx` / `cva` / template literals works:

```tsx
import clsx from "clsx";

const isError = true;

<div tw={clsx("p-4 rounded", isError ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700")}>
  {isError ? "Something went wrong" : "Success!"}
</div>;
```

## Mixing modes

You can use both in the same tree — `tw` props are resolved by the native parser, compiled stylesheets come from `stylesheets`. But it's simpler to pick one: use compiled stylesheets if your project already ships Tailwind; reach for `tw` only for zero-config, simple OG images.

## Priority (reminder)

```
preset  <  stylesheet selector  <  tw  <  inline style
```

So an inline `style={{...}}` always wins over any Tailwind class.
