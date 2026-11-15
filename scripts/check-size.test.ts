import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { BUDGETS, evaluateSizes, formatBytes, measureDist } from './check-size';

describe('evaluateSizes', () => {
  it('passes when every file is within its budget, boundary included', () => {
    expect(
      evaluateSizes(
        { 'index.js': 70, 'sw.js': 4 },
        { 'index.js': 70, 'sw.js': 4 }
      )
    ).toEqual([]);
  });

  it('reports a file over budget with both numbers', () => {
    expect(evaluateSizes({ 'index.js': 71 }, { 'index.js': 70 })).toEqual([
      { kind: 'over', file: 'index.js', bytes: 71, maxBytes: 70 },
    ]);
  });

  it('reports a shipped file that has no budget', () => {
    expect(evaluateSizes({ 'index.js': 10 }, {})).toEqual([
      { kind: 'unbudgeted', file: 'index.js', bytes: 10 },
    ]);
  });

  it('reports a budget whose file was not shipped', () => {
    expect(evaluateSizes({}, { 'index.js': 70 })).toEqual([
      { kind: 'stale', file: 'index.js', maxBytes: 70 },
    ]);
  });

  it('returns violations sorted by path, mixing kinds', () => {
    const sizes = { 'index.js': 80, 'zzz.txt': 1 };
    const budgets = { 'index.js': 70, 'sw.js': 4 };
    expect(evaluateSizes(sizes, budgets).map((v) => [v.file, v.kind])).toEqual([
      ['index.js', 'over'],
      ['sw.js', 'stale'],
      ['zzz.txt', 'unbudgeted'],
    ]);
  });

  it('does not mistake inherited object keys for files or budgets', () => {
    // `'constructor' in {}` is true via the prototype chain; Object.hasOwn is
    // what keeps a path like `toString` from reading as budgeted.
    expect(evaluateSizes({ toString: 1 }, { constructor: 70 })).toEqual([
      { kind: 'stale', file: 'constructor', maxBytes: 70 },
      { kind: 'unbudgeted', file: 'toString', bytes: 1 },
    ]);
  });
});

describe('formatBytes', () => {
  it('uses whole bytes below 1 KiB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(383)).toBe('383 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('uses one-decimal KiB and MiB above it', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(71680)).toBe('70.0 KB');
    expect(formatBytes(1048576)).toBe('1.0 MB');
  });
});

describe('measureDist', () => {
  const dirs: string[] = [];
  const tempDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'check-size-'));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  it('measures nested files as forward-slash relative paths', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'index.js'), 'x'.repeat(10));
    mkdirSync(join(dir, 'icons'));
    writeFileSync(join(dir, 'icons', 'favicon.png'), 'x'.repeat(5));

    expect(measureDist(dir)).toEqual({
      'icons/favicon.png': 5,
      'index.js': 10,
    });
  });

  it('throws for a dist/ that does not exist', () => {
    expect(() => measureDist(join(tempDir(), 'nope'))).toThrow();
  });
});

describe('BUDGETS', () => {
  it('keys are plain dist-relative posix paths with positive ceilings', () => {
    for (const [file, maxBytes] of Object.entries(BUDGETS)) {
      expect(file).toMatch(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/);
      expect(file).not.toContain('\\');
      expect(Number.isInteger(maxBytes)).toBe(true);
      expect(maxBytes).toBeGreaterThan(0);
    }
  });
});
