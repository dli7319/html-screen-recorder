/**
 * Still-frame capture. Grabs the preview's current frame as a PNG, and the
 * output plumbing it needs (a download, a clipboard copy) - which the
 * recording path does not, since a recording is offered as a link the user
 * clicks.
 */

/**
 * The pixel size to capture at: the frame's own decoded dimensions.
 *
 * Returning null is the "there is no frame yet" case - sharing has not started,
 * or the video has not produced a frame - and callers should do nothing rather
 * than emit a blank image.
 */
export function frameSize(video: {
  videoWidth: number;
  videoHeight: number;
}): { width: number; height: number } | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;
  return { width, height };
}

/** Render the video's current frame into a PNG blob. */
export async function captureFrame(
  video: HTMLVideoElement
): Promise<Blob | null> {
  const size = frameSize(video);
  if (!size) return null;

  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, size.width, size.height);

  return new Promise<Blob | null>((resolve) => {
    // toBlob reports null when the canvas cannot be encoded.
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

/**
 * Whether this browser can take an image on the clipboard from a script.
 *
 * ClipboardItem and clipboard.write are both absent in insecure contexts and
 * in some embedded webviews, so the Copy affordance is offered only where it
 * can actually do something.
 */
export function canCopyImages(): boolean {
  return (
    typeof ClipboardItem !== 'undefined' &&
    typeof navigator.clipboard?.write === 'function'
  );
}

/**
 * Put an image blob on the clipboard. Reports whether it landed.
 *
 * Callers run this straight from a click - the clipboard write needs
 * transient user activation - and treat false as "tell the user", not an
 * error to propagate: the blob is still downloadable either way.
 */
export async function copyImageToClipboard(blob: Blob): Promise<boolean> {
  if (!canCopyImages()) return false;
  try {
    // Screenshots are encoded as PNG; an empty type still means PNG here, and
    // the clipboard wants the key to match the payload.
    const type = blob.type || 'image/png';
    await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
    return true;
  } catch {
    return false;
  }
}

/** Save a blob to the user's downloads under the given name. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a tick to start the download before releasing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
