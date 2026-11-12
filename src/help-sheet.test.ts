import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HelpSheet } from './help-sheet';
import { SHORTCUT_DOCS } from './shortcuts';
import { CountdownHandle, runCountdown } from './countdown';

/**
 * The exact element ids HelpSheet looks up in its constructor. Keeping the
 * fixture explicit means a renamed id fails here instead of silently turning
 * into `null` at runtime.
 */
function renderHelp(): HelpSheet {
  document.body.innerHTML = `
    <button id="shortcutsBtn" aria-expanded="false"></button>
    <div id="shortcutsScrim"></div>
    <div id="shortcutsModal" aria-hidden="true">
      <button id="closeShortcuts"></button>
      <div id="shortcutRows"></div>
    </div>
    <div id="toastHost"><button id="toastAction" class="hidden"></button></div>
  `;
  return new HelpSheet();
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;

beforeEach(() => {
  document.body.className = 'shell';
});

afterEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
  delete document.body.dataset.shortcuts;
});

describe('HelpSheet rendering', () => {
  it('draws one row per documented shortcut', () => {
    renderHelp();

    const rows = $('shortcutRows').querySelectorAll('.shortcut-row');
    expect(rows.length).toBe(SHORTCUT_DOCS.length);
  });

  it('shows the keys and the description on each row', () => {
    renderHelp();

    const rows = [...$('shortcutRows').querySelectorAll('.shortcut-row')];
    SHORTCUT_DOCS.forEach((doc, i) => {
      const caps = [...rows[i].querySelectorAll('kbd')].map(
        (c) => c.textContent
      );
      expect(caps).toEqual(doc.keys.split('+'));
      expect(rows[i].querySelector('.shortcut-desc')?.textContent).toBe(
        doc.label
      );
    });
  });

  it('splits a chord into one key cap per key', () => {
    renderHelp();

    const rows = [...$('shortcutRows').querySelectorAll('.shortcut-row')];
    const shiftS = rows[SHORTCUT_DOCS.findIndex((d) => d.keys === 'Shift+S')];
    const caps = [...shiftS.querySelectorAll('kbd')].map((c) => c.textContent);
    expect(caps).toEqual(['Shift', 'S']);
  });
});

describe('HelpSheet open and close', () => {
  it('opens onto the body state, the aria state, and the close button', () => {
    const help = renderHelp();
    help.open();

    expect(document.body.dataset.shortcuts).toBe('open');
    expect(help.isOpen()).toBe(true);
    expect($('shortcutsModal').getAttribute('aria-hidden')).toBe('false');
    expect($('shortcutsBtn').getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe($('closeShortcuts'));
  });

  it('closes back to the invoker with the state reversed', () => {
    const help = renderHelp();
    const btn = $('shortcutsBtn') as HTMLButtonElement;
    btn.focus();
    help.open(btn);
    help.close();

    expect(document.body.dataset.shortcuts).toBe('closed');
    expect(help.isOpen()).toBe(false);
    expect($('shortcutsModal').getAttribute('aria-hidden')).toBe('true');
    expect($('shortcutsBtn').getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(btn);
  });

  it('toggles from the help button', () => {
    const help = renderHelp();
    help.bind();

    $('shortcutsBtn').click();
    expect(help.isOpen()).toBe(true);
    $('shortcutsBtn').click();
    expect(help.isOpen()).toBe(false);
  });

  it('closes from the close button and from a scrim click', () => {
    const help = renderHelp();
    help.bind();

    help.open();
    $('closeShortcuts').click();
    expect(help.isOpen()).toBe(false);

    help.open();
    $('shortcutsScrim').click();
    expect(help.isOpen()).toBe(false);
  });

  it('closes on Escape', () => {
    const help = renderHelp();
    help.bind();
    help.open();

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    expect(help.isOpen()).toBe(false);
  });

  it('keeps the sheet open on the Escape that cancels a countdown', () => {
    // One press must never do two things: while a 3-2-1 runs, Escape belongs
    // to it (the shortcuts layer cancels the count) and the sheet waits for
    // the next press - the same deference the drawer and preview give it.
    const help = renderHelp();
    help.bind();
    help.open();

    const countdown: CountdownHandle = runCountdown({
      seconds: 3,
      onDone: vi.fn(),
    });
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    expect(help.isOpen()).toBe(true);

    // The count is gone now (cancelled by whoever owns the shortcut), so the
    // next Escape belongs to the sheet.
    countdown.cancel();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    expect(help.isOpen()).toBe(false);
  });

  it('ignores Escape entirely while closed', () => {
    const help = renderHelp();
    help.bind();

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    // Nothing to close - and no throw from tearing down a trap that was
    // never set.
    expect(help.isOpen()).toBe(false);
  });
});
