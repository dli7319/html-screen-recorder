import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showToast, hideToast } from './toast';

const MARKUP = `
  <div id="toastHost"><span id="toastText"></span></div>
`;

const host = () => document.getElementById('toastHost') as HTMLElement;
const text = () => document.getElementById('toastText') as HTMLElement;

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
