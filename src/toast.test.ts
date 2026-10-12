import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showToast, hideToast } from './toast';

const MARKUP = `
  <div id="toastHost"><span id="toastText"></span><button id="toastAction"></button></div>
`;

const host = () => document.getElementById('toastHost') as HTMLElement;
const text = () => document.getElementById('toastText') as HTMLElement;
const action = () =>
  document.getElementById('toastAction') as HTMLButtonElement;
const visible = () => host().classList.contains('is-visible');

/** jsdom lays every element out at a zero rect; give the pill a real one. */
function stubHostRect(): void {
  host().getBoundingClientRect = () =>
    ({
      left: 100,
      right: 300,
      top: 400,
      bottom: 450,
      width: 200,
      height: 50,
      x: 100,
      y: 400,
      toJSON: () => ({}),
    }) as DOMRect;
}

/** Move the (real) pointer; the hold listens on window and hit-tests the pill. */
function movePointer(x: number, y: number): void {
  window.dispatchEvent(
    new MouseEvent('pointermove', { clientX: x, clientY: y })
  );
}

/** Pretend the tab is hidden/shown; jsdom's document.hidden is read-only. */
function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  document.body.innerHTML = MARKUP;
  vi.useFakeTimers();
});

afterEach(() => {
  hideToast();
  vi.useRealTimers();
  // Undo the document.hidden mock from the visibility tests.
  Reflect.deleteProperty(document, 'hidden');
  document.body.innerHTML = '';
});

describe('showToast', () => {
  it('reveals the host and sets the message', () => {
    showToast('Removed one.webm');

    expect(host().classList.contains('is-visible')).toBe(true);
    expect(text().textContent).toBe('Removed one.webm');
  });

  it('hides itself after a few seconds', () => {
    showToast('Downloaded 2 takes');
    expect(host().classList.contains('is-visible')).toBe(true);

    vi.advanceTimersByTime(3200);
    expect(host().classList.contains('is-visible')).toBe(false);
  });

  it('replaces an in-flight message rather than stacking toasts', () => {
    showToast('Removed one.webm');
    showToast('Removed two.webm');

    expect(text().textContent).toBe('Removed two.webm');
    expect(document.querySelectorAll('#toastText').length).toBe(1);
  });

  it('re-times the hide when a new message lands mid-life', () => {
    showToast('first');
    vi.advanceTimersByTime(2000);
    showToast('second');

    // The first message's 3.2s timer must not cut short the fresh one.
    vi.advanceTimersByTime(3000);
    expect(host().classList.contains('is-visible')).toBe(true);
    expect(text().textContent).toBe('second');

    vi.advanceTimersByTime(300);
    expect(host().classList.contains('is-visible')).toBe(false);
  });

  it('no-ops when the toast markup is absent', () => {
    document.body.innerHTML = '';
    expect(() => showToast('gone')).not.toThrow();
  });
});

describe('hideToast', () => {
  it('drops the toast immediately', () => {
    showToast('stays');
    hideToast();

    expect(host().classList.contains('is-visible')).toBe(false);
  });
});

describe('showToast action', () => {
  it('shows the action button with its label', () => {
    showToast('Removed clip.webm', { label: 'Undo', onClick: () => {} });

    expect(action().classList.contains('hidden')).toBe(false);
    expect(action().textContent).toBe('Undo');
  });

  it('runs the callback and dismisses on click', () => {
    const onClick = vi.fn();
    showToast('Removed clip.webm', { label: 'Undo', onClick });

    action().click();
    expect(onClick).toHaveBeenCalledOnce();
    expect(host().classList.contains('is-visible')).toBe(false);
  });

  it('hides the button for a plain message', () => {
    showToast('Downloaded 2 takes');
    expect(action().classList.contains('hidden')).toBe(true);
  });

  it('disarms a stale action when a plain message replaces it', () => {
    const onClick = vi.fn();
    showToast('Removed clip.webm', { label: 'Undo', onClick });
    showToast('Downloaded 2 takes');

    action().click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('lingers longer than a plain confirmation', () => {
    showToast('Removed clip.webm', { label: 'Undo', onClick: () => {} });
    vi.advanceTimersByTime(3200);
    // A plain toast would be gone by now; the action needs time to be reached.
    expect(host().classList.contains('is-visible')).toBe(true);
    vi.advanceTimersByTime(2100);
    expect(host().classList.contains('is-visible')).toBe(false);
  });
});

describe('toast hold', () => {
  it('holds the countdown while the pointer is over the pill', () => {
    stubHostRect();
    showToast('Removed clip.webm', { label: 'Undo', onClick: () => {} });

    vi.advanceTimersByTime(3000);
    movePointer(150, 420); // over the pill
    vi.advanceTimersByTime(10000); // well past the 5.2s deadline

    expect(visible()).toBe(true);
  });

  it('resumes with the time that was left when the pointer leaves', () => {
    stubHostRect();
    showToast('Removed clip.webm', { label: 'Undo', onClick: () => {} });

    vi.advanceTimersByTime(3000); // 2.2s left
    movePointer(150, 420); // hold
    vi.advanceTimersByTime(5000);
    movePointer(10, 10); // off the pill

    vi.advanceTimersByTime(2100);
    expect(visible()).toBe(true);
    vi.advanceTimersByTime(200);
    expect(visible()).toBe(false);
  });

  it('holds while keyboard focus is inside the toast', () => {
    showToast('Removed clip.webm', { label: 'Undo', onClick: () => {} });

    action().dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    vi.advanceTimersByTime(10000);
    expect(visible()).toBe(true);

    action().dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    vi.advanceTimersByTime(5200);
    expect(visible()).toBe(false);
  });

  it('holds while the tab is hidden and resumes on return', () => {
    showToast('Downloaded 2 takes');

    vi.advanceTimersByTime(1000); // 2.2s left of the 3.2s plain clock
    setHidden(true);
    vi.advanceTimersByTime(60000);
    expect(visible()).toBe(true);

    setHidden(false);
    vi.advanceTimersByTime(2100);
    expect(visible()).toBe(true);
    vi.advanceTimersByTime(200);
    expect(visible()).toBe(false);
  });

  it('starts a fresh clock for a new message even mid-hold', () => {
    stubHostRect();
    showToast('first', { label: 'Undo', onClick: () => {} });

    vi.advanceTimersByTime(4000); // 1.2s left
    movePointer(150, 420); // hold
    showToast('second'); // replaces, re-times
    movePointer(10, 10); // release: the fresh 3.2s clock runs

    vi.advanceTimersByTime(3100);
    expect(visible()).toBe(true);
    expect(text().textContent).toBe('second');
    vi.advanceTimersByTime(200);
    expect(visible()).toBe(false);
  });

  it('a click on the action still dismisses while held', () => {
    stubHostRect();
    const onClick = vi.fn();
    showToast('Removed clip.webm', { label: 'Undo', onClick });

    movePointer(150, 420); // hold
    action().click();

    expect(onClick).toHaveBeenCalledOnce();
    expect(visible()).toBe(false);
  });
});
