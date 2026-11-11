import { describe, expect, it } from 'vitest';
import {
  cssEscapeIdent,
  extractAssignedClasses,
  findUnstyled,
  isStyled,
  stripCssComments,
} from './check-styles';

describe('extractAssignedClasses', () => {
  it('reads every class of a className assignment with its line', () => {
    const source = ['const x = 1;', "el.className = 'flex-1 min-w-0';"].join(
      '\n'
    );
    expect(extractAssignedClasses(source)).toEqual([
      { name: 'flex-1', line: 2 },
      { name: 'min-w-0', line: 2 },
    ]);
  });

  it('reads className += as well', () => {
    expect(
      extractAssignedClasses("el.className += ' is-fresh';").map((u) => u.name)
    ).toEqual(['is-fresh']);
  });

  it('reads every literal argument of a classList call', () => {
    expect(
      extractAssignedClasses("el.classList.remove('is-soon', 'is-urgent');")
    ).toEqual([
      { name: 'is-soon', line: 1 },
      { name: 'is-urgent', line: 1 },
    ]);
  });

  it('reads a multi-line classList call and reports the call line', () => {
    const source = [
      'this.copyBtn.classList.toggle(',
      "  'hidden',",
      '  take.kind !== screenshot',
      ');',
    ].join('\n');
    expect(extractAssignedClasses(source)).toEqual([
      { name: 'hidden', line: 1 },
    ]);
  });

  it('ignores non-literal arguments', () => {
    expect(extractAssignedClasses('el.classList.add(tone);')).toEqual([]);
    expect(extractAssignedClasses('el.className = makeRow();')).toEqual([]);
  });

  it('does not read a string inside an expression argument as a class', () => {
    // The real shape of preview-modal.ts: only 'hidden' is a class here;
    // 'screenshot' is a comparison value.
    const source =
      "el.classList.toggle('hidden', take.kind !== 'screenshot' || ok());";
    expect(extractAssignedClasses(source).map((u) => u.name)).toEqual([
      'hidden',
    ]);
  });

  it('reads several wholly-literal arguments of one call', () => {
    const source = "el.classList.replace('is-soon', 'is-urgent');";
    expect(extractAssignedClasses(source).map((u) => u.name)).toEqual([
      'is-soon',
      'is-urgent',
    ]);
  });

  it('skips template literals containing interpolation', () => {
    const source = 'el.className = `text-${size} p-2`;';
    expect(extractAssignedClasses(source)).toEqual([]);
  });

  it('reads setAttribute class assignments', () => {
    expect(
      extractAssignedClasses("el.setAttribute('class', 'take-row');").map(
        (u) => u.name
      )
    ).toEqual(['take-row']);
  });

  it('is not confused by parens inside a class string', () => {
    // Arbitrary-value utilities put parens in the class name; a naive scan
    // would end the classList call at the wrong paren.
    const source = "el.classList.toggle('w-[calc(100%-2rem)]', on);";
    expect(extractAssignedClasses(source).map((u) => u.name)).toEqual([
      'w-[calc(100%-2rem)]',
    ]);
  });
});

describe('cssEscapeIdent', () => {
  it('escapes the characters Tailwind escapes in selectors', () => {
    expect(cssEscapeIdent('dark:text-gray-100')).toBe('dark\\:text-gray-100');
    expect(cssEscapeIdent('w-1/2')).toBe('w-1\\/2');
  });

  it('leaves plain names alone', () => {
    expect(cssEscapeIdent('take-row')).toBe('take-row');
  });
});

describe('isStyled', () => {
  it('finds a plain class rule', () => {
    expect(isStyled('flex', '.flex{display:flex}')).toBe(true);
  });

  it('finds a class inside a compound selector', () => {
    expect(isStyled('is-fresh', '.take-row.is-fresh{outline:1px}')).toBe(true);
    expect(isStyled('take-row', '.take-row.is-fresh{outline:1px}')).toBe(true);
  });

  it('matches escaped names the way Tailwind emits them', () => {
    expect(isStyled('w-1/2', '.w-1\\/2{width:50%}')).toBe(true);
    expect(
      isStyled(
        'dark:text-gray-100',
        '@media (prefers-color-scheme:dark){.dark\\:text-gray-100{color:#fff}}'
      )
    ).toBe(true);
    expect(isStyled('last:border-b-0', '.last\\:border-b-0:last-child{}')).toBe(
      true
    );
  });

  it('does not match a name that is only a prefix of a selector', () => {
    expect(isStyled('btn', '.btn--outline{border:1px}')).toBe(false);
    expect(isStyled('flex', '.flex-row{display:flex}')).toBe(false);
  });

  it('ignores class names mentioned only in comments', () => {
    const css = '/* see .ghost for the old style */ .real{color:red}';
    expect(isStyled('ghost', css)).toBe(false);
    expect(isStyled('real', css)).toBe(true);
  });
});

describe('findUnstyled', () => {
  it('returns exactly the uses without a rule', () => {
    const uses = [
      { name: 'flex', line: 1 },
      { name: 'ghost', line: 2 },
      { name: 'btn', line: 3 },
    ];
    expect(findUnstyled(uses, '.flex{}.btn{}')).toEqual([
      { name: 'ghost', line: 2 },
    ]);
  });
});

describe('stripCssComments', () => {
  it('removes block comments including multi-line ones', () => {
    expect(stripCssComments('a{}\n/* x\ny */b{}')).toBe('a{}\n b{}');
  });
});
