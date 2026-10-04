/**
 * Build the download name for a capture: a sortable, collision-resistant
 * `YYYYMMDDHHmmss` stamp plus the container extension.
 *
 * Shared by recordings and screenshots so both name files the same way.
 */
export function timestampFilename(ext: string, at: Date = new Date()): string {
  const timestamp = at
    .toISOString()
    .replace(/[-:T.]/g, '')
    .slice(0, 14);
  return `${timestamp}.${ext}`;
}
