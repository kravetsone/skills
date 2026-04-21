# TanStack Start Integration

## 1. Install

```bash
npm i takumi-js
```

## 2. Server route with `server.handlers`

TanStack Start defines HTTP handlers on a file route via `server.handlers`:

```tsx
// src/routes/og-image.tsx
import { createFileRoute } from "@tanstack/react-router";
import ImageResponse from "takumi-js/response";

export const Route = createFileRoute("/og-image")({
  server: {
    handlers: {
      GET({ request }) {
        const url = new URL(request.url);
        const title = url.searchParams.get("title") ?? "Takumi + TanStack Start";
        const description =
          url.searchParams.get("description") ?? "Render OG images from a route handler.";

        return new ImageResponse(
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",                   // v1 requires explicit flex
              flexDirection: "column",
              justifyContent: "center",
              padding: "64px",
              backgroundImage: "linear-gradient(to bottom right, #eff6ff, #dbeafe)",
            }}
          >
            <p style={{ fontSize: 72, fontWeight: 700, color: "#111827" }}>{title}</p>
            <p style={{ fontSize: 42, fontWeight: 500, color: "#4b5563" }}>{description}</p>
          </div>,
          {
            width: 1200,
            height: 630,
          },
        );
      },
    },
  },
});
```

## 3. Request the endpoint

`/og-image?title=Hello&description=From%20TanStack%20Start` returns a PNG.

## Gotchas

- **`display: "flex"` is required** on layout containers in v1 — see [layout-engine](layout-engine.md#display-defaults-v1-gotcha).
- Load custom fonts via the `fonts` option — Takumi does not read system fonts. See [fonts](fonts.md).
- For best throughput on Node/Bun, construct one `Renderer` at module scope and pass it via the `renderer` option to each `ImageResponse`. See [performance](performance.md).
