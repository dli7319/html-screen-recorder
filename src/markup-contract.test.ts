import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const html = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');

/**
 * Every element the bundle looks up must exist in the markup.
 *
 * This exists because of a bug that rendered perfectly and did nothing. The
 * gallery mounted on `document.querySelector('main')`; a layout rewrite dropped
 * the <main> element, so GalleryView threw during boot and the entire app
 * stopped wiring up - no event listeners, no codec list, no drawer. The static
 * markup still painted, so a screenshot looked flawless while every control was
 * dead.
 *
 * Unit tests could not catch it: they build their own DOM fixture, which kept
 * containing the element. Only the real markup and the real bundle disagree.
 */
describe('markup contract', () => {
  const sources = readdirSync(join(ROOT, 'src'))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => ({
      file: f,
      text: readFileSync(join(ROOT, 'src', f), 'utf8'),
    }));

  it('has an id for every getElementById in the sources', () => {
    const missing: string[] = [];
    for (const { file, text } of sources) {
      for (const m of text.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)) {
        const id = m[1];
        if (!new RegExp(`id="${id}"`).test(html))
          missing.push(`${file} -> #${id}`);
      }
    }
    expect(
      missing,
      'ids referenced from TS but missing from dist/index.html'
    ).toEqual([]);
  });

  it('has an id for every require("#…") in the sources', () => {
    // GalleryView.require() resolves selectors against its own root, so a
    // missing id throws mid-render rather than at boot.
    const missing: string[] = [];
    for (const { file, text } of sources) {
      for (const m of text.matchAll(/require\(\s*'#([^']+)'\s*\)/g)) {
        if (!new RegExp(`id="${m[1]}"`).test(html))
          missing.push(`${file} -> #${m[1]}`);
      }
    }
    expect(
      missing,
      'ids required from TS but missing from dist/index.html'
    ).toEqual([]);
  });

  it('never mounts on a bare tag name off the document', () => {
    // querySelector('main') is the shape that caused the bug: it silently
    // depends on a tag surviving every layout rewrite.
    //
    // Scoped lookups like `recordBtn.querySelector('svg')` are fine - they
    // resolve inside an element the bundle already holds by id. It is the
    // document-rooted, tag-only lookup that couples boot to the layout.
    //
    // Comments are stripped first. The fix for this very bug is documented in
    // index.ts in prose that names the old selector, and without stripping
    // the guard reports the comment that explains it - the same failure the
    // font-CDN guard had before it was taught to ignore prose.
    const offenders: string[] = [];
    for (const { file, text } of sources) {
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|\s)\/\/.*$/gm, '$1');
      for (const m of code.matchAll(
        /document\.querySelector(?:All)?\(\s*'(?!#|\.)([^']+)'\s*\)/g
      )) {
        offenders.push(`${file} -> ${m[1]}`);
      }
    }
    expect(
      offenders,
      'document-rooted tag selectors couple boot to the layout'
    ).toEqual([]);
  });

  it('keeps .hidden authoritative over any display rule', () => {
    // Tailwind defines `.hidden` inside `@layer utilities`, and a layered rule
    // loses to any unlayered rule of equal specificity regardless of source
    // order. Every `display` in styles.css therefore overrode it, and the 3-2-1
    // countdown overlay stayed painted over the preview at 50% black while
    // carrying `class="hidden"` - a permanent dark scrim before any capture.
    //
    // The unlayered `!important` rule in styles.css is what restores the
    // contract. This asserts it survived the Tailwind 4 migration, which is
    // exactly how it was lost once already.
    const styles = readFileSync(join(ROOT, 'dist', 'styles.css'), 'utf8');
    const hiddenRule = /(^|\n)\s*\.hidden\s*\{([^}]*)\}/.exec(styles);
    expect(hiddenRule, 'styles.css must define a .hidden rule').toBeTruthy();
    expect(
      /display\s*:\s*none\s*!important/.test(hiddenRule?.[2] ?? ''),
      '.hidden must be display:none !important, or unlayered display rules win'
    ).toBe(true);
    // styles.css must stay unlayered: a rule of ours inside an @layer would
    // lose to Tailwind's unlayered reset, and the trap re-arms from the other
    // direction.
    //
    // Comments are stripped before looking, because the explanation above this
    // rule discusses the cascade layer by name. That has now happened three
    // times - a guard matching the prose that documents the very bug it guards.
    const stylesCode = styles
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1');
    expect(
      /@layer/.test(stylesCode),
      'styles.css must not declare @layer blocks'
    ).toBe(false);
  });
});
