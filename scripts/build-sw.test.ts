import { describe, expect, it } from 'vitest';
import {
  SHELL,
  computeVersion,
  findUnlisted,
  injectPlaceholders,
} from './build-sw';

const PRECACHE = ['./index.html', './index.js'];
const VERSION = 'abc123def456';

describe('computeVersion', () => {
  it('is stable for identical content', () => {
    const a = computeVersion([
      { path: 'index.js', bytes: Buffer.from('hello') },
      { path: 'index.html', bytes: Buffer.from('world') },
    ]);
    const b = computeVersion([
      { path: 'index.js', bytes: Buffer.from('hello') },
      { path: 'index.html', bytes: Buffer.from('world') },
    ]);
    expect(a).toBe(b);
  });

  it('does not depend on the order entries arrive in', () => {
    // Otherwise two builds of the same source on two machines could name the
    // cache differently and every deploy would look like an update.
    const forward = computeVersion([
      { path: 'a', bytes: Buffer.from('1') },
      { path: 'b', bytes: Buffer.from('2') },
    ]);
    const reversed = computeVersion([
      { path: 'b', bytes: Buffer.from('2') },
      { path: 'a', bytes: Buffer.from('1') },
    ]);
    expect(forward).toBe(reversed);
  });

  it('rotates when the content of any file changes', () => {
    const before = computeVersion([
      { path: 'index.js', bytes: Buffer.from('v1') },
    ]);
    const after = computeVersion([
      { path: 'index.js', bytes: Buffer.from('v2') },
    ]);
    expect(before).not.toBe(after);
  });

  it('rotates when a file is renamed even if the bytes match', () => {
    const before = computeVersion([
      { path: 'old.js', bytes: Buffer.from('x') },
    ]);
    const after = computeVersion([{ path: 'new.js', bytes: Buffer.from('x') }]);
    expect(before).not.toBe(after);
  });

  it('produces a short hex digest', () => {
    expect(computeVersion([{ path: 'a', bytes: Buffer.from('x') }])).toMatch(
      /^[a-f0-9]{12}$/
    );
  });
});

describe('injectPlaceholders', () => {
  it('substitutes both placeholders', () => {
    const compiled = `const A = "__PRECACHE_MANIFEST__";\nconst B = '__CACHE_VERSION__';`;
    const out = injectPlaceholders(compiled, PRECACHE, VERSION);
    expect(out).toContain('["./index.html","./index.js"]');
    expect(out).toContain(`"${VERSION}"`);
  });

  it('works regardless of which quote style the bundler emitted', () => {
    // This is the bug that shipped a worker throwing on first load: the
    // source used single quotes, rolldown rewrote them to double, and a
    // single-quoted match silently did nothing.
    for (const q of ["'", '"']) {
      const out = injectPlaceholders(
        `const A = ${q}__PRECACHE_MANIFEST__${q};\nconst B = ${q}__CACHE_VERSION__${q};`,
        PRECACHE,
        VERSION
      );
      expect(out, `quote style ${q}`).not.toContain('__PRECACHE_MANIFEST__');
      expect(out).not.toContain('__CACHE_VERSION__');
      expect(out).toContain('./index.html');
      expect(out).toContain(VERSION);
    }
  });

  it('throws when a placeholder is missing rather than writing a broken worker', () => {
    // A missing placeholder means the worker would use an unhashed cache name
    // and go stale forever, or precache nothing at all. Failing the build is
    // the correct response - and it must fail on absence too, not only on a
    // token that survived substitution.
    expect(() =>
      injectPlaceholders('const A = "real";', PRECACHE, VERSION)
    ).toThrow(/missing __PRECACHE_MANIFEST__/);
  });

  it('throws when only one of the two is present', () => {
    expect(() =>
      injectPlaceholders('const B = "__CACHE_VERSION__";', PRECACHE, VERSION)
    ).toThrow(/missing __PRECACHE_MANIFEST__/);

    expect(() =>
      injectPlaceholders(
        'const A = "__PRECACHE_MANIFEST__";',
        PRECACHE,
        VERSION
      )
    ).toThrow(/missing __CACHE_VERSION__/);
  });

  it('does not treat $ sequences in the replacement as patterns', () => {
    // JSON.stringify output can contain $&, $' and friends; a plain string
    // replacement would splice them in as regex group references.
    const weird = ['./a$&b', "./c$'d"];
    const out = injectPlaceholders(
      '"__PRECACHE_MANIFEST__";\n"__CACHE_VERSION__";',
      weird,
      VERSION
    );
    expect(out).toContain('./a$&b');
    expect(out).toContain("./c$'d");
  });
});

describe('findUnlisted', () => {
  it('reports shipped files the shell list does not cover', () => {
    expect(
      findUnlisted(['./index.html', './index.js', './stray.map'], PRECACHE)
    ).toEqual(['./stray.map']);
  });

  it('reports nothing when everything is covered', () => {
    expect(findUnlisted(['./index.html', './index.js'], PRECACHE)).toEqual([]);
  });

  it('ignores the worker itself', () => {
    // It cannot precache itself, and it is written after the list is built.
    expect(findUnlisted(['./index.html', './sw.js'], PRECACHE)).toEqual([
      './sw.js',
    ]);
  });
});

describe('SHELL', () => {
  it('covers the whole app shell', () => {
    // The pieces without which the app does not render or is not installable.
    for (const required of [
      'index.html',
      'index.js',
      'styles.css',
      'tailwind.css',
      'manifest.json',
      'fonts/roboto-latin.woff2',
      'icons/icon-512.png',
    ]) {
      expect(SHELL, required).toContain(required);
    }
  });

  it('has no duplicates', () => {
    expect(new Set(SHELL).size).toBe(SHELL.length);
  });
});
