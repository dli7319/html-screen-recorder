/**
 * Inject the precache manifest and cache version into dist/sw.js.
 *
 * Run after rolldown has compiled src/sw.ts. It replaces the two placeholder
 * string literals in that file with real values computed from the build
 * output.
 *
 * ## Why this exists
 *
 * dist/index.js is gitignored - it is produced by `npm run build` during the
 * deploy workflow. A hand-written precache list would therefore drift from the
 * files that actually ship, and the failure is invisible until someone loads
 * the app with the network down: they get a service worker that promises
 * offline and quietly cannot deliver it. Generating the list here makes that
 * class of bug impossible rather than unlikely.
 *
 * The version is a hash of the file contents, so every deploy produces a
 * differently named cache. sw.ts relies on that to swap atomically instead of
 * serving last month's app forever.
 *
 * The pure parts are exported so they can be unit tested - see
 * build-sw.test.ts. `main()` runs only when this file is executed directly.
 *
 * Usage: node scripts/build-sw.ts
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DIST = join(ROOT, 'dist');
export const SW = join(DIST, 'sw.js');

/**
 * Files that must be cached for the app to work offline.
 *
 * Kept explicit rather than "cache everything in dist/": the worker's install
 * is a single addAll, so anything missing from here is unreachable offline,
 * and anything unused is dead weight in the install. Both are decisions.
 */
export const SHELL: readonly string[] = [
  'index.html',
  'index.js',
  'styles.css',
  'tailwind.css',
  'icons.svg',
  'manifest.json',
  'fonts/roboto-latin.woff2',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-512-maskable.png',
  'icons/apple-touch-icon.png',
];

/** A file taking part in the cache hash. */
export type ShellEntry = { path: string; bytes: Buffer };

/**
 * Hash the shell contents into a cache version.
 *
 * Sorted by path first so the digest does not depend on directory traversal
 * order - otherwise two identical builds on two machines could name the cache
 * differently and every deploy would look like an update.
 */
export function computeVersion(entries: readonly ShellEntry[]): string {
  const hash = createHash('sha256');
  for (const entry of [...entries].sort((a, b) =>
    a.path.localeCompare(b.path)
  )) {
    hash.update(entry.path);
    hash.update(entry.bytes);
  }
  return hash.digest('hex').slice(0, 12);
}

/**
 * Substitute the two placeholders in the compiled worker.
 *
 * Quote-agnostic on purpose. rolldown emits double quotes where the source
 * uses single ones, and matching a fixed quote style silently no-ops - which
 * ships a worker that throws on first load. A replacer function keeps the
 * replacement text from being read as a $-pattern.
 *
 * Throws rather than returning partial output, so a failed injection can
 * never be written to disk.
 */
export function injectPlaceholders(
  compiled: string,
  precache: readonly string[],
  version: string
): string {
  // Both tokens must actually be present. Checking only for leftovers after
  // substitution would miss a placeholder that a future minifier renamed or
  // dropped entirely - which would ship a worker with no precache list and no
  // cache version, failing at runtime instead of at build time.
  if (!/(["'])__PRECACHE_MANIFEST__\1/.test(compiled)) {
    throw new Error(
      'missing __PRECACHE_MANIFEST__ placeholder - check src/sw.ts'
    );
  }
  if (!/(["'])__CACHE_VERSION__\1/.test(compiled)) {
    throw new Error('missing __CACHE_VERSION__ placeholder - check src/sw.ts');
  }

  // Quote-agnostic on purpose. rolldown emits double quotes where the source
  // uses single ones, and matching a fixed quote style silently no-ops. A
  // replacer function keeps the replacement text from being read as a
  // $-pattern.
  const result = compiled
    .replace(/(["'])__PRECACHE_MANIFEST__\1/, () => JSON.stringify(precache))
    .replace(/(["'])__CACHE_VERSION__\1/, () => JSON.stringify(version));

  if (
    result.includes('__PRECACHE_MANIFEST__') ||
    result.includes('__CACHE_VERSION__')
  ) {
    throw new Error('placeholder survived compilation - check src/sw.ts');
  }
  return result;
}

/**
 * Shipped files the shell list does not cover.
 *
 * Not fatal - some files are deliberately not cached - but almost always a
 * new asset that was added and forgotten, which is exactly how an app ends up
 * broken only when the network is down.
 */
export function findUnlisted(
  shipped: readonly string[],
  precache: readonly string[]
): string[] {
  const known = new Set(precache);
  return shipped.filter((f) => !known.has(f)).sort();
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** Every file in dist except the worker itself, as './'-relative URLs. */
export function shippedFiles(dist: string): string[] {
  return walk(dist)
    .map((f) => './' + relative(dist, f).split('\\').join('/'))
    .filter((f) => f !== './sw.js')
    .sort();
}

export function main(): void {
  const missing = SHELL.filter((f) => {
    try {
      return !statSync(join(DIST, f)).isFile();
    } catch {
      return true;
    }
  });
  if (missing.length) {
    console.error(`build-sw: missing from dist/: ${missing.join(', ')}`);
    process.exit(1);
  }

  const precache = SHELL.map((f) => './' + f);

  const unlisted = findUnlisted(shippedFiles(DIST), precache);
  if (unlisted.length) {
    console.warn(
      `build-sw: not precached (offline would skip these): ${unlisted.join(', ')}`
    );
  }

  const version = computeVersion(
    SHELL.map((f) => ({
      path: f,
      bytes: readFileSync(join(DIST, f)),
    }))
  );

  const compiled = readFileSync(SW, 'utf8');
  const injected = injectPlaceholders(compiled, precache, version);

  writeFileSync(SW, injected);
  console.log(
    `build-sw: ${precache.length} files precached, ` +
      `cache screen-recorder-${version} (${compiled.length} -> ${injected.length} B)`
  );
}

// Only run when executed directly, so tests can import the helpers above
// without performing a build.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    // A failed injection must not leave a half-written worker behind.
    console.error(`build-sw: ${(error as Error).message}`);
    process.exit(1);
  }
}
