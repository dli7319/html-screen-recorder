import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = join(process.cwd(), 'dist');
const styles = readFileSync(join(DIST, 'styles.css'), 'utf8');

/**
 * The self-hosted font contract.
 *
 * Two of these guards exist because of bugs that shipped once already. The
 * variable weight range is the silent one: Google serves Roboto as a variable
 * font spanning 400..700, Inter spans 100..900, and copying Inter's
 * declaration over does not fail - the browser quietly synthesises or clips
 * out-of-range weights and the result looks subtly wrong rather than broken.
 */
describe('self-hosted font', () => {
  it('declares the variable range the file actually supports', () => {
    const face = /@font-face\s*\{[^}]*\}/.exec(styles);
    expect(face, 'no @font-face in dist/styles.css').not.toBeNull();

    // Roboto's variable range. A 100 900 range here means the declaration was
    // copied from Inter and no longer matches the shipped bytes.
    expect(face![0]).toMatch(/font-weight:\s*400 700/);
    expect(face![0]).not.toMatch(/100 900/);
  });

  it('loads a relative path so the subpath deployment keeps working', () => {
    // A leading slash resolves to the domain root, which is not where this app
    // lives - it is served from /html-screen-recorder/ on GitHub Pages.
    expect(styles).toMatch(/src:\s*url\('\.\/fonts\/roboto-latin\.woff2'\)/);
    expect(styles).not.toMatch(/src:\s*url\('\//);
  });

  it('ships a real woff2 at that path', () => {
    const fontPath = join(DIST, 'fonts', 'roboto-latin.woff2');
    expect(
      existsSync(fontPath),
      'roboto-latin.woff2 missing from dist/fonts'
    ).toBe(true);

    const bytes = readFileSync(fontPath);
    // wOF2 magic number - a renamed ttf or an error page would fail here.
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('wOF2');
    expect(statSync(fontPath).size).toBeGreaterThan(10_000);
  });

  it('falls back to a system stack rather than another webfont', () => {
    expect(styles).toMatch(/font-family:\s*'Roboto',\s*system-ui/);
  });

  it('references no third-party font host anywhere in dist', () => {
    // The service worker precaches a fixed set of files; a stray CDN reference
    // would work online and fail only when the network is down.
    //
    // Matched only where it would actually fetch: inside url(), or a src/href
    // attribute. Prose about the CDN is legitimate - styles.css explains what
    // was deliberately removed - and an earlier version of this guard flagged
    // its own comment.
    const fetchRef =
      /(?:url\(\s*['"]?|<(?:link|script)[^>]*?(?:src|href)\s*=\s*['"])https?:\/\/fonts\.(?:googleapis|gstatic)\.com/;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(html|css|js|json)$/.test(entry)) continue;
        if (fetchRef.test(readFileSync(full, 'utf8'))) offenders.push(entry);
      }
    };
    walk(DIST);
    expect(offenders, 'third-party font fetch found in dist').toEqual([]);
  });
});
