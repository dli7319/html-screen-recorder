/**
 * Fail the build when a file shipped in dist/ outgrows its size budget.
 *
 * The deploy workflow publishes ./dist wholesale to the `dist` branch, and the
 * service worker precaches the shell in a single addAll - so every byte in
 * dist/ is a byte every visitor pays for on first load, and again on every
 * offline start. Nothing else in the toolchain notices growth: rolldown and
 * tailwind happily emit a bundle three times the current size, CI stays green,
 * and the regression only shows up as a slow first paint nobody attributes to
 * a merged PR.
 *
 * The budgets below are explicit per file, each sitting ~25-50% above the size
 * it was written against - room for normal growth, tight enough that an
 * accidental dependency, an unminified asset, or a stray file dropped into
 * dist/ cannot ship unnoticed. Two invariants keep the table honest:
 *
 *   - a shipped file with no budget fails (nothing would guard it), and
 *   - a budget with no shipped file fails (the table went stale).
 *
 * So when this fires, the fix is a decision, not a workaround: raise or add
 * the ceiling in BUDGETS when the growth is intentional and say why in review,
 * or stop shipping the file. The ceiling is meant to be moved in the open.
 *
 * Runs last in `npm run build`, after build-sw.ts has rewritten dist/sw.js
 * (its size is not final until the placeholders are substituted).
 * The pure helpers are exported so they can be unit tested - see
 * check-size.test.ts. `main()` runs only when this file is executed directly.
 *
 * Usage: node scripts/check-size.ts
 */

import { readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DIST = join(ROOT, 'dist');

const KiB = 1024;
const MiB = 1024 * KiB;

/**
 * Size ceilings for every file in dist/, keyed by path relative to dist/ with
 * forward slashes. The set is exactly the precached shell (SHELL in
 * build-sw.ts) plus sw.js itself.
 *
 * Budgets are in whole KiB so the numbers read as round limits. Raising one is
 * fine when a change genuinely needs the space - pair it with a line in the PR
 * saying what grew.
 */
export const BUDGETS: Readonly<Record<string, number>> = {
  'fonts/roboto-latin.woff2': 56 * KiB,
  'icons/apple-touch-icon.png': 3 * KiB,
  'icons/favicon-16.png': 1 * KiB,
  'icons/favicon-32.png': 1 * KiB,
  'icons/favicon.svg': 2 * KiB,
  'icons/icon-192.png': 6 * KiB,
  'icons/icon-512-maskable.png': 8 * KiB,
  'icons/icon-512.png': 16 * KiB,
  'icons.svg': 4 * KiB,
  'index.html': 32 * KiB,
  'index.js': 70 * KiB,
  'manifest.json': 2 * KiB,
  'styles.css': 80 * KiB,
  'sw.js': 4 * KiB,
  'tailwind.css': 12 * KiB,
};

/**
 * A shipped file whose size disagrees with its budget.
 *
 * A discriminated union so consumers narrow on `kind` instead of poking at
 * nullable fields: `over` knows both numbers, the other two know only one.
 */
export type SizeViolation =
  | { kind: 'over'; file: string; bytes: number; maxBytes: number }
  | { kind: 'unbudgeted'; file: string; bytes: number }
  | { kind: 'stale'; file: string; maxBytes: number };

function walk(dir: string, prefix: string, out: Record<string, number>): void {
  // Sorted traversal so the report order does not depend on the filesystem.
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, rel, out);
    else out[rel] = stat.size;
  }
}

/**
 * Every file under `dir` as a relative path -> byte size, following no
 * symlinks' extra targets (statSync does follow the link itself, which is what
 * ships). Throws if `dir` does not exist - callers decide whether that is
 * fatal.
 */
export function measureDist(dir: string): Record<string, number> {
  const out: Record<string, number> = {};
  walk(dir, '', out);
  return out;
}

/**
 * Compare shipped sizes against the budget table, over the union of both key
 * sets, so a file nobody budgeted and a budget nobody ships are both
 * violations rather than silent no-ops. Results are sorted by path for stable
 * output between runs.
 */
export function evaluateSizes(
  sizes: Readonly<Record<string, number>>,
  budgets: Readonly<Record<string, number>>
): SizeViolation[] {
  const files = [
    ...new Set([...Object.keys(sizes), ...Object.keys(budgets)]),
  ].sort();

  const violations: SizeViolation[] = [];
  for (const file of files) {
    const hasSize = Object.hasOwn(sizes, file);
    const hasBudget = Object.hasOwn(budgets, file);
    if (!hasBudget) {
      violations.push({ kind: 'unbudgeted', file, bytes: sizes[file] });
    } else if (!hasSize) {
      violations.push({ kind: 'stale', file, maxBytes: budgets[file] });
    } else if (sizes[file] > budgets[file]) {
      violations.push({
        kind: 'over',
        file,
        bytes: sizes[file],
        maxBytes: budgets[file],
      });
    }
  }
  return violations;
}

/** Human-readable byte count: whole bytes below 1 KiB, one decimal above. */
export function formatBytes(bytes: number): string {
  if (bytes < KiB) return `${bytes} B`;
  if (bytes < MiB) return `${(bytes / KiB).toFixed(1)} KB`;
  return `${(bytes / MiB).toFixed(1)} MB`;
}

function main(): void {
  let sizes: Record<string, number>;
  try {
    sizes = measureDist(DIST);
  } catch {
    console.error('check-size: dist/ missing - run the full build first');
    process.exit(1);
  }

  const violations = evaluateSizes(sizes, BUDGETS);
  if (violations.length) {
    console.error('check-size: dist/ disagrees with its size budgets:');
    for (const v of violations) {
      if (v.kind === 'over') {
        console.error(
          `  dist/${v.file}  ${formatBytes(v.bytes)} > ${formatBytes(v.maxBytes)}` +
            ` (over by ${formatBytes(v.bytes - v.maxBytes)})`
        );
      } else if (v.kind === 'unbudgeted') {
        console.error(
          `  dist/${v.file}  ${formatBytes(v.bytes)} - no budget in scripts/check-size.ts`
        );
      } else {
        console.error(
          `  budget for dist/${v.file} (${formatBytes(v.maxBytes)}) - not shipped; ` +
            'drop the budget or restore the file'
        );
      }
    }
    console.error(
      '  fix: raise or add the ceiling in scripts/check-size.ts if the growth is'
    );
    console.error(
      '       intentional (this whole directory is deployed and precached), or'
    );
    console.error('       stop shipping the file.');
    process.exit(1);
  }

  const files = Object.keys(sizes).sort();
  const total = files.reduce((sum, file) => sum + sizes[file], 0);
  console.log(
    `check-size: ${files.length} shipped files, ${formatBytes(total)} total, all within budget`
  );

  // Tightest budgets first: the line to watch before it turns red.
  const ranked = files
    .map((file) => ({ file, pct: sizes[file] / BUDGETS[file] }))
    .sort((a, b) => b.pct - a.pct);
  for (const { file, pct } of ranked) {
    console.log(
      `  ${String(Math.round(pct * 100)).padStart(3)}%  ` +
        `${file.padEnd(30)} ${formatBytes(sizes[file])} / ${formatBytes(BUDGETS[file])}`
    );
  }
}

// Only run when executed directly, so tests can import the helpers above
// without walking dist/.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
