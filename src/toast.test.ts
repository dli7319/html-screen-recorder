import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showToast, hideToast } from './toast';

const MARKUP = `
  <div id="toastHost"><span id="toastText"></span><button id="toastAction"></button></div>
`;

const host = () => document.getElementById('toastHost') as HTMLElement;
const text = () => document.getElementById('toastText') as HTMLElement;
const action = () =>
  document.getElementById('toastAction') as HTMLButtonElement;

beforeEach(() => {
  document.body.innerHTML = MARKUP;
  vi.useFakeTimers();
});

afterEach(() => {
  hideToast();
  vi.useRealTimers();
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
