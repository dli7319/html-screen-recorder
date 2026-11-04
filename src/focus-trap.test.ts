import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { trapFocus } from './focus-trap';

function render(): HTMLElement {
  document.body.innerHTML = `
    <div id="dialog">
      <button id="a">A</button>
      <button id="b">B</button>
      <button id="c">C</button>
    </div>
  `;
  return document.getElementById('dialog') as HTMLElement;
}

const el = (id: string) => document.getElementById(id) as HTMLElement;

function tab(shift = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  document.activeElement?.dispatchEvent(event);
  return event;
}

describe('trapFocus', () => {
  let teardown: () => void;
  beforeEach(() => render());
  afterEach(() => {
    teardown?.();
    document.body.innerHTML = '';
  });

  it('wraps forward from the last element to the first', () => {
    teardown = trapFocus(el('dialog'));
    el('c').focus();

    const event = tab();
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(el('a'));
  });

  it('wraps backward from the first element to the last', () => {
    teardown = trapFocus(el('dialog'));
    el('a').focus();

    const event = tab(true);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(el('c'));
  });

  it('lets a normal mid-dialog Tab proceed untouched', () => {
    teardown = trapFocus(el('dialog'));
    el('b').focus();

    const event = tab();
    // No wrap: the browser's own focus move should happen, so not prevented.
    expect(event.defaultPrevented).toBe(false);
  });

  it('pulls focus back in when it escaped the dialog', () => {
    teardown = trapFocus(el('dialog'));
    document.body.focus(); // outside the dialog

    const event = tab();
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(el('a'));
  });

  it('stops trapping once torn down', () => {
    const local = trapFocus(el('dialog'));
    el('c').focus();
    local();
    teardown = () => {};

    const event = tab();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('trapFocus with an outside action in the cycle', () => {
  // The shape this exists for: a toast action (Undo/View) living outside the
  // dialog. Removing a take from the preview dialog is destructive and its
  // Undo arrives there - a trap that cannot reach it makes the undo mouse-only.
  function renderWithToast(): { dialog: HTMLElement; host: HTMLElement } {
    document.body.innerHTML = `
      <div id="dialog">
        <button id="a">A</button>
        <button id="b">B</button>
        <button id="c">C</button>
      </div>
      <div id="toastHost">
        <span id="toastText"></span>
        <button id="toastAction" class="hidden">Undo</button>
      </div>
    `;
    return {
      dialog: document.getElementById('dialog') as HTMLElement,
      host: document.getElementById('toastHost') as HTMLElement,
    };
  }

  let teardown: () => void;
  afterEach(() => {
    teardown?.();
    document.body.innerHTML = '';
  });

  it('wraps backward from the first element to the outside action', () => {
    const { dialog, host } = renderWithToast();
    el('toastAction').classList.remove('hidden'); // a toast with an action is up
    teardown = trapFocus(dialog, [host]);
    el('a').focus();

    const event = tab(true);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(el('toastAction'));
  });

  it('wraps forward from the outside action back into the dialog', () => {
    const { dialog, host } = renderWithToast();
    el('toastAction').classList.remove('hidden');
    teardown = trapFocus(dialog, [host]);
    el('toastAction').focus();

    const event = tab();
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(el('a'));
  });

  it('lets a Tab off the dialog edge proceed to the action', () => {
    const { dialog, host } = renderWithToast();
    el('toastAction').classList.remove('hidden');
    teardown = trapFocus(dialog, [host]);
    el('c').focus();

    // The action follows the dialog in the DOM, so the browser's own tab move
    // reaches it - the wrap boundary has moved past it and must not fire here.
    const event = tab();
    expect(event.defaultPrevented).toBe(false);
  });

  it('lets a Shift+Tab off the action proceed back into the dialog', () => {
    const { dialog, host } = renderWithToast();
    el('toastAction').classList.remove('hidden');
    teardown = trapFocus(dialog, [host]);
    el('toastAction').focus();

    // The action is inside the cycle, not an escape: the natural move back to
    // the dialog's last control must be left alone.
    const event = tab(true);
    expect(event.defaultPrevented).toBe(false);
  });

  it('drops a hidden action back out of the wrap boundary', () => {
    const { dialog, host } = renderWithToast();
    // The action stays `hidden` - no toast with an action is up.
    teardown = trapFocus(dialog, [host]);
    el('a').focus();

    const event = tab(true);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(el('c'));
  });

  it('tolerates a missing extra host', () => {
    const { dialog } = renderWithToast();
    teardown = trapFocus(dialog, [null]);
    el('c').focus();

    const event = tab();
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(el('a'));
  });
});
