# Keyframe Animation

Takumi treats animation as a render-time parameter: the same renderer is called at timestamp `t` along a time axis. You choose **how** to drive it.

## Two workflows

| Goal | Use |
| ---- | --- |
| Single frozen frame of an animated scene | `render(scene, { keyframes, timeMs })` |
| Animated GIF / APNG / WebP file | `renderer.renderAnimation({ scenes, fps, format, ... })` |
| MP4 / WebM / custom video | `render()` with `format: "raw"` + pipe frames into ffmpeg |

All three use the same node tree — you don't rebuild the scene per frame.

## Defining animations

### Option A — Structured `keyframes` object

Best when you call `render()` at a specific `timeMs`.

```tsx
import { render } from "takumi-js";

const output = await render(
  <div tw="animate-[move_1s_ease-in-out_infinite_alternate]" />,
  {
    width: 100,
    height: 100,
    format: "png",
    timeMs: 500,
    keyframes: {
      move: {
        from: { transform: "translateX(0)" },
        "50%": { transform: "translateX(60px)" },
        to: { transform: "translateX(120px)" },
      },
    },
  },
);
```

### Option B — `@keyframes` in a `<style>` tag

Travels with the JSX tree. Works with both `renderAnimation()` and `render()` (via `stylesheets`).

```tsx
import { Renderer } from "takumi-js/node";
import { fromJsx } from "takumi-js/helpers/jsx";

const renderer = new Renderer();

const { node, stylesheets } = await fromJsx(
  <div tw="w-full h-full items-center justify-center">
    <style>{`
      @keyframes move {
        from { transform: translateX(0); }
        to   { transform: translateX(60px); }
      }
    `}</style>
    <div tw="w-10 h-10 bg-red-500 animate-[move_1s_ease-in-out_infinite_alternate]" />
  </div>,
);

const output = await renderer.renderAnimation({
  width: 100,
  height: 100,
  fps: 30,
  format: "webp",
  stylesheets,
  scenes: [{ durationMs: 1000, node }],
});
```

## Tailwind animation utilities

Takumi supports:

- Presets: `animate-none`, `animate-spin`, `animate-ping`, `animate-pulse`, `animate-bounce` (work automatically — no config).
- Arbitrary shorthand: `animate-[move_1s_ease-in-out_infinite_alternate]` — underscores become spaces, so this is parsed as `animation: move 1s ease-in-out infinite alternate`.

**Not supported:** the `animate-(--custom-property)` form. CSS custom-property resolution for `animation` is not implemented.

## `renderAnimation()`

Minimal API for animated image output:

```ts
await renderer.renderAnimation({
  width: 100,
  height: 100,
  fps: 30,
  format: "webp",       // "webp" | "apng" | "gif"
  stylesheets,
  scenes: [
    { durationMs: 1000, node },
    // Multiple scenes concatenate — Takumi does NOT generate transitions between them.
  ],
});
```

Use a single scene with `@keyframes` / Tailwind presets for smooth animation. Multiple scenes are for distinct "cuts" in a single animated file.

## `render()` + ffmpeg pipeline

For MP4/WebM or tighter pipeline control, render raw RGBA frames and pipe them into ffmpeg. Example using Bun:

```tsx
import { render } from "takumi-js";
import { spawn } from "bun";

const fps = 30;
const durationSeconds = 4;
const width = 1200;
const height = 630;
const totalFrames = fps * durationSeconds;

const ffmpeg = spawn(
  [
    "ffmpeg", "-y",
    "-f", "rawvideo",
    "-pixel_format", "rgba",
    "-video_size", `${width}x${height}`,
    "-framerate", `${fps}`,
    "-i", "pipe:0",
    "output.mp4",
  ],
  { stdin: "pipe", stdout: "ignore", stderr: "ignore" },
);

const scene = <Scene />;

for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
  const timeMs = (frameIndex / fps) * 1000;
  const frame = await render(scene, {
    width,
    height,
    format: "raw",
    keyframes,
    timeMs,
  });
  ffmpeg.stdin.write(frame);
}

ffmpeg.stdin.end();
await ffmpeg.exited;
```

See the upstream [`ffmpeg-keyframe-animation` example](https://github.com/kane50613/takumi/blob/master/example/ffmpeg-keyframe-animation/) for a complete project.

## Parameters on the animation timing function

Supported timing functions: `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out`, `steps(N[, start|end])`, `cubic-bezier(a, b, c, d)`. Fill modes, delays, and iteration counts all work per the CSS spec.
