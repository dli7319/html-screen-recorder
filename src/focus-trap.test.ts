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
