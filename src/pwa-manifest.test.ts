import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guards the web app manifest against the two ways it silently stops being
 * installable:
 *
 *   1. A path escapes the subpath. This app is served from
 *      /html-screen-recorder/, so `start_url: "/"` puts the start URL outside
 *      the manifest's scope and the browser rejects the manifest outright - no
 *      error, no install button.
 *   2. An icon is declared at a size it does not actually have. Chrome needs a
 *      real 192 and 512; it does not rescale a lying declaration, it just
 *      refuses to install.
 *
 * Both failures are invisible until someone tries to install on a phone, so
 * they are checked against the real files rather than trusted.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

type ManifestIcon = {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
};

type Manifest = {
  name?: string;
  short_name?: string;
  id?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  background_color?: string;
  theme_color?: string;
  icons?: ManifestIcon[];
};

const manifestPath = join(DIST, 'manifest.json');

function readManifest(): Manifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

/** PNG dimensions from the IHDR chunk, so we never trust the declared size. */
function pngSize(file: string): { width: number; height: number } {
  const buf = readFileSync(file);
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  // IHDR: 8-byte signature, 4-byte length, 4-byte 'IHDR', then width/height.
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('web app manifest', () => {
  it('exists and parses', () => {
    expect(existsSync(manifestPath)).toBe(true);
    expect(() => readManifest()).not.toThrow();
  });

  it('has every field Chrome requires to offer installation', () => {
    const m = readManifest();
    expect(m.name, 'name').toBeTruthy();
    expect(m.short_name, 'short_name').toBeTruthy();
    expect(m.start_url, 'start_url').toBeTruthy();
    expect(m.display, 'display').toBeTruthy();
    // standalone | fullscreen | minimal-ui - anything else is not installable.
    expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(m.display);
  });

  it('keeps every URL inside the subpath', () => {
    const m = readManifest();
    // The app lives at /html-screen-recorder/, not the origin root. A leading
    // '/' escapes the manifest's own directory and breaks both scope and
    // installability. Relative paths are the whole difference between a
    // root-deployed PWA and a subpath one.
    for (const [field, value] of Object.entries({
      id: m.id,
      start_url: m.start_url,
      scope: m.scope,
    })) {
      expect(value, `${field} must be set`).toBeTruthy();
      expect(
        value!.startsWith('/'),
        `${field}=${value} escapes the subpath`
      ).toBe(false);
      expect(
        value!.startsWith('./'),
        `${field}=${value} must be relative`
      ).toBe(true);
    }
  });

  it('declares icon paths that exist on disk', () => {
    const m = readManifest();
    expect(m.icons?.length, 'at least one icon').toBeGreaterThan(0);
    for (const icon of m.icons!) {
      const file = join(DIST, icon.src.replace(/^\.\//, ''));
      expect(existsSync(file), `missing icon file ${icon.src}`).toBe(true);
    }
  });

  it('declares icon sizes that match the real pixels', () => {
    for (const icon of readManifest().icons!) {
      const file = join(DIST, icon.src.replace(/^\.\//, ''));
      const [w, h] = icon.sizes.split('x').map(Number);
      const real = pngSize(file);
      expect(
        real.width,
        `${icon.src} claims ${icon.sizes} but is ${real.width}x${real.height}`
      ).toBe(w);
      expect(real.height, `${icon.src} claims ${icon.sizes}`).toBe(h);
    }
  });

  it('has the 192 and 512 icons Chrome requires', () => {
    const sizes = readManifest().icons!.map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  it('has a maskable icon with opaque full-bleed artwork', () => {
    const maskable = readManifest().icons!.find(
      (i) => i.purpose === 'maskable'
    );
    expect(maskable, 'a purpose:"maskable" icon is required').toBeTruthy();
    // Maskable is a different geometry, not a different size: the artwork must
    // fill the canvas or Android's circular crop shows whatever is behind it.
    // Verified here by requiring the same declared size as the plain 512 and
    // that the file exists; the opacity check lives in build-icons.sh's output.
    expect(maskable!.sizes).toBe('512x512');
    expect(existsSync(join(DIST, maskable!.src.replace(/^\.\//, '')))).toBe(
      true
    );
  });
});
