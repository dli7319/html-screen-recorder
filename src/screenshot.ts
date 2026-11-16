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

/** A rectangle in viewport coordinates, e.g. from getBoundingClientRect(). */
export interface ViewRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A capture region in frame pixel coordinates, whole pixels inside the frame. */
export interface FrameRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Map a selection drawn over the video element onto the frame's own pixels.
 *
 * A crop box is positioned over the preview element, but a capture is made
 * from the decoded frame - two different coordinate spaces. The frame is
 * displayed `object-contain`ed inside the element, so the mapping runs through
 * the element's fitted content box: a selection hanging into a letterbox bar
 * is clamped away rather than sampling blank margin.
 *
 * Edges are rounded to whole pixels together (before clamping) so the region
 * keeps the size it was drawn with instead of drifting a pixel per edge, and
 * anything that covers no picture at all returns null.
 */
export function selectionToFrameRegion(
  selection: ViewRect,
  element: ViewRect,
  frameWidth: number,
  frameHeight: number
): FrameRegion | null {
  if (
    !(frameWidth > 0) ||
    !(frameHeight > 0) ||
    !(element.width > 0) ||
    !(element.height > 0)
  ) {
    return null;
  }

  // object-fit: contain - the frame's picture box inside the element.
  const scale = Math.min(
    element.width / frameWidth,
    element.height / frameHeight
  );
  const contentWidth = frameWidth * scale;
  const contentHeight = frameHeight * scale;
  const offsetX = element.left + (element.width - contentWidth) / 2;
  const offsetY = element.top + (element.height - contentHeight) / 2;

  const x0 = Math.round((selection.left - offsetX) / scale);
  const y0 = Math.round((selection.top - offsetY) / scale);
  const x1 = Math.round((selection.left + selection.width - offsetX) / scale);
  const y1 = Math.round((selection.top + selection.height - offsetY) / scale);

  // Clamp to the frame; a selection sitting in a letterbox bar collapses.
  const cx0 = Math.min(Math.max(x0, 0), frameWidth);
  const cy0 = Math.min(Math.max(y0, 0), frameHeight);
  const cx1 = Math.min(Math.max(x1, cx0), frameWidth);
  const cy1 = Math.min(Math.max(y1, cy0), frameHeight);

  const width = cx1 - cx0;
  const height = cy1 - cy0;
  if (width < 1 || height < 1) return null;
  return { x: cx0, y: cy0, width, height };
}

/**
 * Render the video's current frame into a PNG blob - the whole frame, or just
 * `region` when a crop selection decides what a capture means.
 */
export async function captureFrame(
  video: HTMLVideoElement,
  region?: FrameRegion | null
): Promise<Blob | null> {
  const frame = frameSize(video);
  if (!frame) return null;

  const width = region ? region.width : frame.width;
  const height = region ? region.height : frame.height;
  if (!(width > 0) || !(height > 0)) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if (region) {
    ctx.drawImage(
      video,
      region.x,
      region.y,
      region.width,
      region.height,
      0,
      0,
      width,
      height
    );
  } else {
    ctx.drawImage(video, 0, 0, width, height);
  }

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
