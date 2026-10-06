/**
 * Making a small picture for a take: one frame of a recording, or a shrunk
 * screenshot.
 *
 * The pure parts (where to seek, what size to draw) are separate from the
 * DOM glue because jsdom can neither decode a video nor rasterise a canvas.
 * The glue is therefore thin and verified in a real browser; everything with
 * a decision in it is a plain function with a test.
 *
 * Every entry point is best-effort: a codec the browser cannot decode, a
 * corrupt blob, or a canvas that refuses to export all resolve to `null`, and
 * the gallery falls back to its glyph. A thumbnail is decoration; nothing in
 * the capture path may depend on one.
 */

/** Longest edge of a generated thumbnail, in CSS pixels. Rows display these
 *  at roughly 64x36, so this is over 2x for sharpness on dense screens while
 *  still staying around 10 KB per image. */
export const THUMBNAIL_MAX_EDGE = 320;

/** Give up on extraction rather than leave a half-loaded video hanging. */
export const THUMBNAIL_TIMEOUT_MS = 3_000;

/**
 * Where in a recording to grab the frame.
 *
 * Not the first frame: a MediaRecorder stream can open on a black or partial
 * frame before the compositor settles. Not the middle either - for a screen
 * recording, a second in is what the user was actually looking at. Clips
 * shorter than two seconds go to their midpoint instead of past their end.
 */
export function pickSeekTime(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return Math.min(1_000, durationMs / 2);
}

/**
 * The largest size within a max box that keeps the source aspect ratio.
 * Never upscales: a 40px screenshot stays 40px wide rather than blurring.
 */
export function fitWithin(
  sourceWidth: number,
  sourceHeight: number,
  maxEdge: number = THUMBNAIL_MAX_EDGE
): { width: number; height: number } {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

/**
 * Draw a source that knows its own size into a JPEG/WebP blob. Prefers WebP
 * (roughly a third smaller at equal quality); falls back to JPEG for the
 * canvases that do not implement it. Returns null if the canvas cannot be
 * read back - some privacy modes taint or blank it.
 */
async function canvasToThumbnail(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number
): Promise<Blob | null> {
  const { width, height } = fitWithin(sourceWidth, sourceHeight);
  if (width === 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(source, 0, 0, width, height);

  const encode = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, quality)
    );

  return (
    (await encode('image/webp', 0.75)) ?? (await encode('image/jpeg', 0.8))
  );
}

/**
 * One frame of a recorded clip, as a small image. `durationMs` comes from the
 * take when known - a MediaRecorder blob cannot be trusted to describe its
 * own length - and is only used to choose where to seek.
 *
 * Resolves null rather than rejecting: callers treat failure identically
 * whether it is a decode error, a timeout, or the browser refusing.
 */
export async function extractVideoThumbnail(
  blob: Blob,
  durationMs?: number
): Promise<Blob | null> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  // Enough to seek and draw one frame, never the whole stream.
  video.preload = 'metadata';
  video.muted = true;

  try {
    return await new Promise<Blob | null>((resolve) => {
      let settled = false;
      const finish = (thumb: Blob | null) => {
        if (settled) return;
        settled = true;
        resolve(thumb);
      };

      const timer = setTimeout(() => finish(null), THUMBNAIL_TIMEOUT_MS);
      const done = (thumb: Blob | null) => {
        clearTimeout(timer);
        finish(thumb);
      };

      video.addEventListener('error', () => done(null), { once: true });

      // 'loadeddata' - not 'canplay' - is the first state that guarantees a
      // decodable frame exists, which is all a still needs.
      video.addEventListener(
        'loadeddata',
        () => {
          const seekTo = pickSeekTime(durationMs ?? video.duration * 1000);
          if (seekTo > 0) {
            video.addEventListener(
              'seeked',
              () => {
                void canvasToThumbnail(
                  video,
                  video.videoWidth,
                  video.videoHeight
                ).then(done);
              },
              { once: true }
            );
            video.currentTime = seekTo / 1000;
          } else {
            void canvasToThumbnail(
              video,
              video.videoWidth,
              video.videoHeight
            ).then(done);
          }
        },
        { once: true }
      );

      video.src = url;
      video.load();
    });
  } finally {
    // The take keeps its own URL; this one existed only for the decode.
    URL.revokeObjectURL(url);
    video.removeAttribute('src');
    video.load();
  }
}

/**
 * A screenshot is already an image, so its thumbnail is just a shrunk copy -
 * the same fit math as the video path, without the seek.
 */
export async function downscaleImage(blob: Blob): Promise<Blob | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }
  try {
    return await canvasToThumbnail(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}
