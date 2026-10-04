import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindShortcuts, isTypingTarget, matchShortcut } from './shortcuts';

function key(
  key: string,
  opts: Partial<KeyboardEvent> = {}
): Parameters<typeof matchShortcut>[0] {
  return {
    key,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...opts,
  };
}

describe('matchShortcut', () => {
  it('maps each letter to its action', () => {
    expect(matchShortcut(key('r'))).toBe('record');
    expect(matchShortcut(key('p'))).toBe('pause');
    expect(matchShortcut(key('s'))).toBe('stop');
    expect(matchShortcut(key('S', { shiftKey: true }))).toBe('screenshot');
  });

  it('is case insensitive for the plain letters', () => {
    expect(matchShortcut(key('R'))).toBe('record');
    expect(matchShortcut(key('P'))).toBe('pause');
    expect(matchShortcut(key('S'))).toBe('stop');
  });

  it('treats Shift+S as screenshot and bare S as stop', () => {
    expect(matchShortcut(key('s', { shiftKey: true }))).toBe('screenshot');
    expect(matchShortcut(key('s'))).toBe('stop');
    expect(matchShortcut(key('S', { shiftKey: false }))).toBe('stop');
  });

  it('ignores chords carrying a modifier so browser shortcuts survive', () => {
    expect(matchShortcut(key('s', { metaKey: true }))).toBeNull();
    expect(matchShortcut(key('s', { ctrlKey: true }))).toBeNull();
    expect(matchShortcut(key('p', { altKey: true }))).toBeNull();
    expect(matchShortcut(key('r', { ctrlKey: true }))).toBeNull();
  });

  it('ignores keys that are not shortcuts', () => {
    expect(matchShortcut(key('a'))).toBeNull();
    expect(matchShortcut(key('Enter'))).toBeNull();
    expect(matchShortcut(key('ArrowLeft'))).toBeNull();
    expect(matchShortcut(key('F5'))).toBeNull();
    expect(matchShortcut(key(''))).toBeNull();
  });

  it('maps Escape to cancel', () => {
    expect(matchShortcut(key('Escape'))).toBe('cancel');
    expect(matchShortcut(key('Escape', { shiftKey: true }))).toBe('cancel');
  });

  it('lets Escape cancel from inside a field, unlike the others', () => {
    // Escape aborts something in progress, so it cannot be swallowed by a
    // focused input the way a recording shortcut must be.
    const input = document.createElement('input');

    expect(matchShortcut(key('Escape', { target: input }))).toBe('cancel');
    expect(matchShortcut(key('r', { target: input }))).toBeNull();
  });

  it('leaves modifier chords to the platform', () => {
    expect(matchShortcut(key('Escape', { metaKey: true }))).toBeNull();
    expect(matchShortcut(key('Escape', { ctrlKey: true }))).toBeNull();
  });

  it('never fires while the user is typing', () => {
    const input = document.createElement('input');
    expect(matchShortcut(key('r', { target: input }))).toBeNull();
    expect(matchShortcut(key('s', { target: input }))).toBeNull();

    const textarea = document.createElement('textarea');
    expect(matchShortcut(key('p', { target: textarea }))).toBeNull();

    const select = document.createElement('select');
    expect(matchShortcut(key('r', { target: select }))).toBeNull();
  });

  it('still fires when focus is on a button or the page', () => {
    const button = document.createElement('button');
    expect(matchShortcut(key('r', { target: button }))).toBe('record');
    expect(matchShortcut(key('r'))).toBe('record');
  });
});

describe('isTypingTarget', () => {
  it('recognises form controls', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true);
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(document.createElement('select'))).toBe(true);
    expect(isTypingTarget(document.createElement('button'))).toBe(false);
    expect(isTypingTarget(document.createElement('div'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(window)).toBe(false);
  });

  it('treats a contenteditable region as typing', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    document.body.appendChild(div);
    expect(isTypingTarget(div)).toBe(true);

    // the empty spelling means editable too
    const plain = document.createElement('div');
    plain.setAttribute('contenteditable', '');
    expect(isTypingTarget(plain)).toBe(true);
  });

  it('honours an explicit contenteditable="false"', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'false');
    expect(isTypingTarget(div)).toBe(false);
  });
});

describe('bindShortcuts', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  function press(init: Partial<KeyboardEventInit>) {
    window.dispatchEvent(new KeyboardEvent('keydown', init));
  }

  it('dispatches to the matching handler', () => {
    const handlers = {
      onRecord: vi.fn(),
      onPause: vi.fn(),
      onStop: vi.fn(),
      onScreenshot: vi.fn(),
    };
    bindShortcuts(handlers);

    press({ key: 'r' });
    press({ key: 'p' });
    press({ key: 's' });
    press({ key: 'S', shiftKey: true });

    expect(handlers.onRecord).toHaveBeenCalledOnce();
    expect(handlers.onPause).toHaveBeenCalledOnce();
    expect(handlers.onStop).toHaveBeenCalledOnce();
    expect(handlers.onScreenshot).toHaveBeenCalledOnce();
  });

  it('prevents default so the letter is not typed into the page', () => {
    bindShortcuts({ onRecord: vi.fn() });
    const event = new KeyboardEvent('keydown', { key: 'r', cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores a modifier chord entirely', () => {
    const handlers = { onRecord: vi.fn(), onStop: vi.fn() };
    bindShortcuts(handlers);

    press({ key: 'r', ctrlKey: true });
    press({ key: 's', metaKey: true });

    expect(handlers.onRecord).not.toHaveBeenCalled();
    expect(handlers.onStop).not.toHaveBeenCalled();
  });

  it('tolerates handlers that were not supplied', () => {
    expect(() => {
      bindShortcuts({ onRecord: vi.fn() });
      press({ key: 'p' });
      press({ key: 's' });
      press({ key: 'S', shiftKey: true });
    }).not.toThrow();
  });

  it('stops listening once unsubscribed', () => {
    const onRecord = vi.fn();
    const off = bindShortcuts({ onRecord });

    press({ key: 'r' });
    expect(onRecord).toHaveBeenCalledOnce();

    off();
    press({ key: 'r' });
    expect(onRecord).toHaveBeenCalledOnce();
  });
});
