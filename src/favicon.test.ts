import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guards the tab icon against the way it silently disappears: nothing in the
 * app's runtime touches it, so a broken href or a missing file renders the
 * page perfectly and leaves the tab with the browser's generic placeholder.
 *
 * Two failure modes, both checked against the real files rather than trusted:
 *
 *   1. The head stops declaring an icon (or points at one that is not there).
 *      The manifest's icons do not cover this - they only apply once the app
 *      is installed, so an uninstalled visit gets nothing without these links.
 *   2. The generated favicon copies drift from assets/icon.svg: the PNGs and
 *      favicon.svg are build-icons.sh output that is committed, so editing the
 *      artwork without re-running the script leaves the tab showing the OLD
 *      mark while every launcher icon shows the new one.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const html = readFileSync(join(DIST, 'index.html'), 'utf8');

/** Every <link rel="icon" …> in the head, as its attributes. */
function iconLinks(): { href: string; type: string; sizes: string }[] {
  return [...html.matchAll(/<link\s[^>]*rel="icon"[^>]*>/g)].map((m) => {
    const attr = (name: string) =>
      new RegExp(`${name}="([^"]*)"`).exec(m[0])?.[1] ?? '';
    return { href: attr('href'), type: attr('type'), sizes: attr('sizes') };
  });
}

/** PNG dimensions from the IHDR chunk, so we never trust the declared size. */
function pngSize(file: string): { width: number; height: number } {
  const buf = readFileSync(file);
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('tab favicon', () => {
  it('declares a vector icon with a raster fallback', () => {
    const links = iconLinks();
    expect(
      links.length,
      'no rel="icon" link in dist/index.html'
    ).toBeGreaterThan(0);
    expect(
      links.some((l) => l.type === 'image/svg+xml'),
      'a vector icon keeps the tab crisp on HiDPI'
    ).toBe(true);
    expect(
      links.some((l) => l.type === 'image/png'),
      'a PNG fallback covers engines without SVG favicon support'
    ).toBe(true);
  });

  it('points every declared icon at a file that exists in dist', () => {
    for (const link of iconLinks()) {
      expect(link.href, 'icon href must stay inside the subpath').toMatch(
        /^\.\//
      );
      const file = join(DIST, link.href.replace(/^\.\//, ''));
      expect(
        () => readFileSync(file),
        `missing icon file ${link.href}`
      ).not.toThrow();
    }
  });

  it('declares PNG sizes that match the real pixels', () => {
    for (const link of iconLinks()) {
      if (link.type !== 'image/png') continue;
      const [w, h] = link.sizes.split('x').map(Number);
      const real = pngSize(join(DIST, link.href.replace(/^\.\//, '')));
      expect(
        real.width,
        `${link.href} claims ${link.sizes} but is ${real.width}x${real.height}`
      ).toBe(w);
      expect(real.height, `${link.href} claims ${link.sizes}`).toBe(h);
    }
  });

  it('ships favicon copies that match the artwork in assets/', () => {
    const source = readFileSync(join(ROOT, 'assets', 'icon.svg'));
    // The vector copy is served as-is; a stale one means the script was not
    // re-run after an artwork change and the tab lags behind the app icons.
    expect(readFileSync(join(DIST, 'icons', 'favicon.svg'))).toEqual(source);
  });
});
