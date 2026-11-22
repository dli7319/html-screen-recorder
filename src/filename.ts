/**
 * Build the download name for a capture: a sortable `YYYYMMDDHHmmss` stamp
 * plus the container extension.
 *
 * Shared by recordings and screenshots so both name files the same way. The
 * stamp has second granularity, so two captures inside the same second would
 * share a name - `dedupeFilename` resolves that against the takes already
 * listed.
 */
export function timestampFilename(ext: string, at: Date = new Date()): string {
  const timestamp = at
    .toISOString()
    .replace(/[-:T.]/g, '')
    .slice(0, 14);
  return `${timestamp}.${ext}`;
}

/**
 * Resolve a name that is already taken to a free one: `shot.png`, then
 * `shot-2.png`, `shot-3.png`, and so on before the extension.
 *
 * The stamp names a moment, not a take, and two takes can share a moment -
 * Shift+S twice inside one second used to file both as `20261119160518.png`,
 * two gallery rows with nothing to tell them apart and downloads that did not
 * match the names shown. The numbered suffix is what browsers do with a
 * colliding download, done up front so the name on the row is the name on
 * disk. The set is finite, so the walk always terminates.
 */
export function dedupeFilename(
  filename: string,
  taken: Iterable<string>
): string {
  const used = new Set(taken);
  if (!used.has(filename)) return filename;
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}${ext}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * The download name for a still cut from a recording: the take's own name with
 * its extension swapped for the frame's position in the clip -
 * `clip.webm` at 3.24s becomes `clip-frame-3.2s.png`.
 *
 * The position is part of the name because it is what makes the file
 * meaningful ("the frame at three seconds") and what keeps two grabs from the
 * same clip from wearing the same name. The clip's extension is dropped, not
 * kept: the output is a PNG whatever the recording was encoded as, and a
 * `clip.webm.png` would misstate that.
 */
export function frameFilename(
  currentFilename: string,
  atSeconds: number
): string {
  const dot = currentFilename.lastIndexOf('.');
  const base = dot > 0 ? currentFilename.slice(0, dot) : currentFilename;
  return `${base}-frame-${atSeconds.toFixed(1)}s.png`;
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
