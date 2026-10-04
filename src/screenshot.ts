/**
 * Still-frame capture. Grabs the preview's current frame as a PNG, and the
 * download plumbing it needs (which the recording path does not, since a
 * recording is offered as a link the user clicks).
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
