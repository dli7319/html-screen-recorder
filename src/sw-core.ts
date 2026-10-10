/**
 * Service worker logic, free of side effects so it can be unit tested.
 *
 * sw.ts holds the listeners and the two build-time placeholders; everything
 * with a rule worth testing lives here.
 */

/** Files the worker caches up front so the first offline visit works. */
export function parsePrecache(input: unknown): string[] {
  const list =
    typeof input === 'string' ? (JSON.parse(input) as unknown) : input;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('precache manifest is empty or not an array');
  }
  if (!list.every((e) => typeof e === 'string' && e.length > 0)) {
    throw new Error('precache manifest must be an array of non-empty strings');
  }
  return list as string[];
}

/**
 * The cache name for a given build.
 *
 * Distinct per deploy, which is the entire mechanism for not serving last
 * month's app forever: a new build gets a new cache name, `activate` deletes
 * every other cache, and the new worker has already fetched fresh copies into
 * the new one. Old and new content never mix.
 */
export function cacheName(version: string): string {
  // A real version is a hex digest, so any double underscore means
  // build-sw.ts never substituted the placeholder. Written as a pattern
  // rather than the literal token so it cannot trip that script's own check.
  if (!version || version.includes('__')) {
    throw new Error('cache version was not injected by build-sw.ts');
  }
  return `screen-recorder-${version}`;
}

/** True when a cached entry from a previous build should be dropped. */
export function isStaleCache(key: string, current: string): boolean {
  return key.startsWith('screen-recorder-') && key !== current;
}

/**
 * Whether this worker should answer a request at all.
 *
 * Cross-origin and non-GET requests are left alone: caching a third-party
 * response would be a privacy leak, and caching a POST is meaningless.
 */
export function shouldHandle(request: {
  method: string;
  url: string;
  origin?: string;
}): boolean {
  if (request.method !== 'GET') return false;
  try {
    const origin = request.origin ?? self.location.origin;
    if (new URL(request.url).origin !== origin) return false;
  } catch {
    return false;
  }
  return true;
}
