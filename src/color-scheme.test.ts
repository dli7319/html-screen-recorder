import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(join(process.cwd(), 'dist', 'styles.css'), 'utf8');

/**
 * The browser's own widgets - scrollbars, the dropdown lists behind selects,
 * text fields - render in the scheme named by `color-scheme`, not the scheme
 * the stylesheet happens to paint. Without the declaration a dark page ships a
 * white scrollbar and white popups; with it always set to light, dark mode
 * would get light widgets instead. Both halves are pinned so neither can be
 * dropped when the palette is edited again.
 */
describe('native widget colour scheme', () => {
  /** The first bare `:root { ... }` block - the light token set. */
  const lightRoot = /:root\s*\{([^}]*)\}/.exec(styles)?.[1] ?? '';

  /** `@media (prefers-color-scheme: dark) { :root { ... } }` - the dark tokens. */
  const darkRoot =
    /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(
      styles
    )?.[1] ?? '';

  it('renders native widgets light on the default scheme', () => {
    expect(lightRoot, 'no :root block in dist/styles.css').not.toBe('');
    expect(lightRoot).toMatch(/color-scheme:\s*light\s*;/);
  });

  it('renders native widgets dark when the system is dark', () => {
    expect(
      darkRoot,
      'no @media (prefers-color-scheme: dark) :root block in dist/styles.css'
    ).not.toBe('');
    expect(darkRoot).toMatch(/color-scheme:\s*dark\s*;/);
  });

  it('declares one scheme per mode, never both', () => {
    expect(lightRoot).not.toMatch(/color-scheme:\s*dark/);
    expect(darkRoot).not.toMatch(/color-scheme:\s*light/);
  });
});
