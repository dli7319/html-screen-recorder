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

/**
 * The download name for a renamed take: the typed text, kept as spelled, with
 * the take's own extension appended when the name has none.
 *
 * The extension states the file's format and the blob cannot change format by
 * being renamed - an mp4 renamed "demo" would download as an extensionless
 * file the OS cannot open. So a plain name gets the real extension; anything
 * the user spelled with a dot is kept verbatim, because they named the whole
 * file, not just its base. Trailing dots are stripped first so "demo." is
 * treated as the plain name it is.
 *
 * Empty (after trimming) refuses the rename: null rather than a silent keep or
 * a nameless download.
 */
export function renameFilename(
  currentFilename: string,
  typed: string
): string | null {
  const name = typed.trim().replace(/\.+$/, '');
  if (!name) return null;
  const dot = currentFilename.lastIndexOf('.');
  const ext = dot > 0 ? currentFilename.slice(dot + 1) : '';
  if (!ext || name.includes('.')) return name;
  return `${name}.${ext}`;
}
