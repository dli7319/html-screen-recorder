# html-screen-recorder

A screen recorder that runs entirely in the browser. Share a screen, window or
browser tab, optionally trim to a region, pick a codec, and download the result —
no install, no upload, no account.

**Live → <https://dli7319.github.io/html-screen-recorder/>**

Everything happens on your machine: the recording is captured with
`MediaRecorder` and handed to you as a local download. Nothing is sent anywhere.

## Features

- **Share screen, window or tab** via `getDisplayMedia`, with the cursor included
- **Region cropping** — drag a box over the preview and record only that region.
  Uses the native `CropTarget` API when the browser has it, and falls back to a
  `canvas`-based re-encode when it doesn't.
- **Resize from any side** — four corner handles plus four edge handles
- **Preview that matches your screen** — the preview container adopts the real
  aspect ratio of whatever you shared, so non-16:9 screens are not cropped
- **Six recording formats**, filtered to whatever your browser actually supports:

  | Format            | Container |
  | ----------------- | --------- |
  | AV1 + Opus        | MP4       |
  | H.265/HEVC + Opus | MP4       |
  | VP9 + Opus        | WebM      |
  | H.264 + AAC       | MP4       |
  | VP9               | WebM      |
  | H.264             | MP4       |

- **System audio and microphone** as independent toggles, each with a live level
  meter
- **Running timer** on the record button while recording
- **Timestamped filenames** (`20261004193012.mp4`)
- **Dark mode** that follows your OS setting
- **Responsive layout** — usable down to phone widths

## Requirements

A browser with:

- `getDisplayMedia` (screen capture)
- `MediaRecorder` (recording)
- a **secure context** — HTTPS, or `localhost` while developing

Modern Chrome, Edge and Firefox all qualify. Safari supports the core APIs but
not every codec.

Two optional behaviours degrade gracefully:

| Capability                      | If unavailable                                        |
| ------------------------------- | ----------------------------------------------------- |
| `CropTarget` / `track.cropTo()` | cropping falls back to a `canvas` re-encode           |
| system audio capture            | the checkbox yields no system audio — mic still works |

> **Note on system audio:** whether it is offered depends on both the browser and
> the OS. Chromium on Windows and ChromeOS supports it broadly; macOS support is
> limited and typically needs a loopback device.

## Getting started

```bash
git clone https://github.com/dli7319/html-screen-recorder.git
cd html-screen-recorder
npm install
npm run build
```

Then serve `dist/` with any static file server and open it over `localhost` (the
APIs above need a secure context):

```bash
npx http-server dist        # or: python3 -m http.server -d dist
```

There is no dev server — `npm run build` compiles everything into `dist/`, so
rebuild after editing.

## Scripts

| Command                | What it does                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `npm run build`        | Compile Tailwind → `dist/tailwind.css`, then bundle with Rolldown → `dist/index.js` |
| `npm run lint`         | Lint with Oxlint                                                                    |
| `npm run format`       | Format the source with Prettier                                                     |
| `npm run format:check` | Check formatting without writing                                                    |

## How it works

Plain TypeScript with **no framework and no runtime dependencies**. The bundle is
a single IIFE.

```
dist/index.html     markup + Tailwind utility classes (this is the source of truth)
dist/styles.css     app styles: status dot, crop handles
dist/tailwind.css   generated at build time — do not edit
dist/icons.svg      sprite referenced by <use href="./icons.svg#…">
src/
  index.ts          orchestration: share → preview → record → download
  ui-manager.ts     DOM access and UI state transitions
  screen-share.ts   getDisplayMedia + mic + AudioContext analyser wiring
  recorder.ts       MediaRecorder wrapper
  cropper.ts        crop box drag/resize + CropTarget and canvas paths
  stopwatch.ts      mm:ss timer for the record button
  constants.ts      the format list probed at startup
  types.ts          CropTarget / cropTo shims
```

A few things worth knowing if you are changing this code:

- **Tailwind is compiled at build time**, not loaded from the Play CDN. It is
  pinned to `3.4.17`, and `tailwind.config.js` scans `./dist/index.html` only —
  that is where every class lives, including the three toggled from JavaScript
  (`hidden`, `pointer-events-none`, `opacity-50`).
- **`dist/tailwind.css` is linked _after_ `dist/styles.css`** on purpose. Tailwind
  utilities must win ties against the app stylesheet, so do not reorder those two
  `<link>` tags.
- **The preview container starts at `aspect-video` (16:9)** purely as an
  empty-state placeholder. Once a stream is live, `syncPreviewAspect()` overrides
  it with the shared surface's real aspect ratio, and resets it when sharing
  stops. It reads the `<video>` element's decoded frame size rather than
  `MediaTrack.getSettings()`, because the two can disagree and the element is
  what `object-contain` actually fits — matching it is what keeps the preview
  free of letterbox bars. The sync runs off the element's `resize` event, so it
  follows the recorded window as it is resized.
- **The preview is height-capped** (`max-height: min(500px, 56vh)` in
  `dist/styles.css`) so a tall shared surface shrinks in width instead of
  pushing the controls below it down. CSS derives the width from the aspect
  ratio and `margin-inline: auto` centres it.
- **The cropper's `canvas` fallback** converts crop-box coordinates to source
  pixels by scaling against the rendered `<video>` box. That is only correct when
  the container matches the frame — which is why the aspect-ratio sync matters
  for cropped recordings too, not just for how the preview looks.

## Deployment

Pushing to `main` runs
[`.github/workflows/build.yml`](.github/workflows/build.yml), which builds and
publishes `dist/` to the **`dist` branch** via `peaceiris/actions-gh-pages`.
GitHub Pages serves that branch.

## License

[MIT](LICENSE) © 2025 David Li
