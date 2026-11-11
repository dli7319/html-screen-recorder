/**
 * Verify that every class name assigned from TypeScript actually has a rule in
 * the built CSS.
 *
 * Tailwind only compiles classes it can find in a scanned source (see
 * src/tailwind.css). A class that first appears in JavaScript - set via
 * `element.className = ...` or `classList.toggle(...)` - is invisible to that
 * scan unless it is also listed in an `@source inline(...)` block. Miss one and
 * the build stays green while the element silently ships with no styles at all:
 * no typography, no dark-mode colours, no layout. That exact bug shipped once
 * (a gallery row's filename vanished against the dark background) and the
 * `@source inline` list exists because of it. The list is maintained by hand,
 * so this check is what keeps it honest - the build fails instead of the UI.
 *
 * The check is against the COMPILED css (dist/tailwind.css plus the
 * hand-written dist/styles.css), not against the source list, so it catches
 * every way a class can end up without a rule: forgotten `@source inline`
 * entry, a typo in that entry, or a typo in the TypeScript itself.
 *
 * Scope: string literals assigned to `className`, passed to `classList`, or
 * set via `setAttribute('class', ...)`. Classes built dynamically (template
 * interpolation, concatenation, variables) cannot be checked statically and
 * are skipped - prefer literals so they stay covered here. A class that is
 * deliberately an unstyled JS hook can be given an empty rule in
 * dist/styles.css to mark it as intentional.
 *
 * Run from `npm run build` (after the Tailwind compile). The pure helpers are
 * exported so they can be unit tested - see check-styles.test.ts.
 *
 * Usage: node scripts/check-styles.ts
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SRC = join(ROOT, 'src');
export const DIST = join(ROOT, 'dist');

/** A class name observed in a class assignment, with its source location. */
export type ClassUse = { name: string; line: number };

/**
 * One string literal: any quote style, backslash escapes honoured, the quote
 * character not repeated unescaped inside (which is what `(?!\1)[^\\]` says).
 * Anchored: an argument that is exactly one string literal and nothing else.
 */
const LITERAL_ONLY = /^(['"`])((?:\\.|(?!\1)[^\\])*)\1$/;

/** `el.className = '...'` and the rarer `el.className += '...'`. */
const CLASSNAME_ASSIGN =
  /\bclassName\s*\+?=\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

/** `el.setAttribute('class', '...')`. */
const SET_ATTR_CLASS =
  /\bsetAttribute\s*\(\s*(['"])class\1\s*,\s*(['"`])((?:\\.|(?!\2)[^\\])*)\2/g;

/** `el.classList.add/remove/toggle/replace(` - arguments scanned separately. */
const CLASSLIST_CALL = /\.classList\.(?:add|remove|toggle|replace)\s*\(/g;

/**
 * A plausible class name. Tailwind utilities carry variant prefixes and
 * arbitrary-value syntax (`dark:text-gray-100`, `w-1/2`, `bg-[url(x.png)]`),
 * so the charset is wide - anything else (fragments of interpolation, prose)
 * is not a class and is ignored.
 */
const CLASS_NAME = /^[A-Za-z_!][A-Za-z0-9_!:\-/@[\]().%]*$/;

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

/**
 * Find the matching close paren for the `(` at `open`, skipping over string
 * literals - `w-[calc(100%-2rem)]` puts a paren inside a class string and
 * would otherwise unbalance the scan. Returns -1 when unbalanced.
 */
function matchParen(source: string, open: number): number {
  let depth = 0;
  let quote = '';
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i;
  }
  return -1;
}

/**
 * Split a call's argument text on top-level commas, respecting nesting and
 * strings. `toggle('hidden', take.kind !== 'x')` has two arguments, and only
 * the first is a class - reading every string literal in the call would flag
 * `'x'` as a class name.
 */
export function splitTopLevelArgs(args: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(args.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(args.slice(start));
  return parts;
}

/**
 * Every class name assigned from one TypeScript source file.
 *
 * Only literals are read: `classList.add(tone)` with a variable argument
 * yields nothing, a template literal containing `${...}` is skipped whole (its
 * static fragments may not be real classes), and inside a classList call only
 * arguments that are wholly a string literal count - a class-like string in an
 * expression (`toggle('hidden', kind !== 'screenshot')`) is not a class.
 * Whitespace inside a literal separates classes, matching how DOMTokenList and
 * className treat them.
 */
export function extractAssignedClasses(source: string): ClassUse[] {
  const uses: ClassUse[] = [];
  const push = (text: string, at: number): void => {
    if (text.includes('${')) return;
    for (const token of text.split(/\s+/)) {
      if (token && CLASS_NAME.test(token)) {
        uses.push({ name: token, line: lineAt(source, at) });
      }
    }
  };

  for (const m of source.matchAll(CLASSNAME_ASSIGN)) push(m[2], m.index);
  for (const m of source.matchAll(SET_ATTR_CLASS)) push(m[3], m.index);

  for (const m of source.matchAll(CLASSLIST_CALL)) {
    const open = m.index + m[0].length - 1;
    const close = matchParen(source, open);
    if (close < 0) continue;
    for (const arg of splitTopLevelArgs(source.slice(open + 1, close))) {
      const lit = arg.trim().match(LITERAL_ONLY);
      if (lit) push(lit[2], open);
    }
  }
  return uses;
}

/** Remove `/* ... *\/` comments so a class named in prose cannot count. */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/**
 * Escape a class name the way CSS escapes an identifier, so it can be looked
 * up as a selector: `dark:text-gray-100` -> `dark\:text-gray-100`.
 */
export function cssEscapeIdent(name: string): string {
  let out = '';
  for (const ch of name) {
    out +=
      /[A-Za-z0-9_-]/.test(ch) || (ch.codePointAt(0) ?? 0) > 0x7f
        ? ch
        : '\\' + ch;
  }
  return out;
}

/** Escape a literal string so every character means itself in a RegExp. */
function regexEscape(text: string): string {
  return text.replace(/[^A-Za-z0-9]/g, '\\$&');
}

/**
 * Does this class name have a rule anywhere in the CSS?
 *
 * Matches `.<escaped-name>` as a complete selector part: `.btn` must not be
 * satisfied by `.btn--outline`, so the name cannot be followed by more name
 * characters. Anything after is fine - `{`, `:hover`, `.is-soon`, `,`.
 */
export function isStyled(name: string, css: string): boolean {
  const bare = stripCssComments(css);
  // The CSS text carries the CSS-escaped name (`.dark\:text-gray-100`), so the
  // needle is that escaped name regex-escaped again: `\\:` must match the two
  // literal characters backslash-colon, which a plain `new RegExp` would not.
  const needle = '\\.' + regexEscape(cssEscapeIdent(name));
  const re = new RegExp(needle + '(?![A-Za-z0-9_-])');
  return re.test(bare);
}

/** The subset of `uses` with no rule in `css`. */
export function findUnstyled<T extends ClassUse>(
  uses: readonly T[],
  css: string
): T[] {
  return uses.filter((u) => !isStyled(u.name, css));
}

function main(): void {
  const files = readdirSync(SRC)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort();

  const uses = files.flatMap((file) =>
    extractAssignedClasses(readFileSync(join(SRC, file), 'utf8')).map((u) => ({
      ...u,
      file,
    }))
  );

  let css: string;
  try {
    css =
      readFileSync(join(DIST, 'styles.css'), 'utf8') +
      '\n' +
      readFileSync(join(DIST, 'tailwind.css'), 'utf8');
  } catch {
    console.error(
      'check-styles: dist/styles.css or dist/tailwind.css missing - run the full build first'
    );
    process.exit(1);
  }

  const unstyled = findUnstyled(uses, css);
  if (unstyled.length) {
    // One line per class, first occurrence, sorted for stable output.
    const seen = new Set<string>();
    const unique = unstyled
      .filter((u) => (seen.has(u.name) ? false : (seen.add(u.name), true)))
      .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

    console.error(
      'check-styles: classes assigned from src/ with no rule in the built CSS:'
    );
    for (const u of unique) {
      console.error(`  src/${u.file}:${u.line}  ${u.name}`);
    }
    console.error(
      '  fix: list each class in an @source inline(...) block in src/tailwind.css'
    );
    console.error(
      '  (or dist/index.html), or give it a rule in dist/styles.css if it is a'
    );
    console.error('  custom class or a deliberately unstyled JS hook.');
    process.exit(1);
  }

  console.log(
    `check-styles: ${uses.length} class assignments in src/ are all styled`
  );
}

// Only run when executed directly, so tests can import the helpers above
// without scanning the tree.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
