import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GalleryView, downloadAll } from './gallery-view';
import { TakeStore } from './takes';
import { TAKE_TTL_MS } from './take-cache';

const GALLERY_MARKUP = `
  <main>
    <div id="takeList"></div>
    <p id="takesEmpty"></p>
    <span id="takeCount"></span>
    <button id="downloadAllBtn" disabled></button>
    <button id="clearTakesBtn" disabled></button>
  </main>
`;

let store: TakeStore;
let view: GalleryView;

function render() {
  document.body.innerHTML = GALLERY_MARKUP;
  store = new TakeStore();
  view = new GalleryView(document.querySelector('main') as HTMLElement, store);
  view.bind();
  return { root: document.querySelector('main') as HTMLElement };
}

beforeEach(() => {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => `blob:test/${Math.random()}`),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  view?.unbind();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const $ = (id: string) => document.getElementById(id) as HTMLElement;

describe('GalleryView empty state', () => {
  it('shows the empty message and disables the bulk actions', () => {
    render();

    expect($('takesEmpty').classList.contains('hidden')).toBe(false);
    expect(($('downloadAllBtn') as HTMLButtonElement).disabled).toBe(true);
    expect(($('clearTakesBtn') as HTMLButtonElement).disabled).toBe(true);
    expect($('takeCount').textContent).toBe('');
  });

  it('rejects markup that is missing a piece rather than half-rendering', () => {
    document.body.innerHTML = '<main><div id="takeList"></div></main>';

    expect(
      () =>
        new GalleryView(document.querySelector('main') as HTMLElement, store)
    ).toThrow(/missing #takesEmpty/);
  });
});

describe('GalleryView with takes', () => {
  it('lists a row per take', () => {
    render();
    store.add({
      kind: 'recording',
      blob: new Blob(['a']),
      filename: 'one.webm',
      formatName: 'VP9',
    });
    store.add({
      kind: 'screenshot',
      blob: new Blob(['b']),
      filename: 'two.png',
      formatName: 'PNG',
    });

    const rows = $('takeList').querySelectorAll('[data-take-id]');
    expect(rows.length).toBe(2);
  });

  it('hides the empty message and enables the bulk actions', () => {
    render();
    store.add({
      kind: 'recording',
      blob: new Blob(['a']),
      filename: 'one.webm',
      formatName: 'VP9',
    });

    expect($('takesEmpty').classList.contains('hidden')).toBe(true);
    expect(($('downloadAllBtn') as HTMLButtonElement).disabled).toBe(false);
    expect(($('clearTakesBtn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('summarises the take count and total size', () => {
    render();
    store.add({
      kind: 'recording',
      blob: new Blob(['a']),
      filename: 'one.webm',
      formatName: 'VP9',
    });
    store.add({
      kind: 'screenshot',
      blob: new Blob(['bcd']),
      filename: 'two.png',
      formatName: 'PNG',
    });

    expect($('takeCount').textContent).toBe('2 · 4 B');
  });

  it('shows a recording with its length but a screenshot with only size', () => {
    render();
    store.add({
      kind: 'recording',
      blob: new Blob(['a']),
      filename: 'one.webm',
      formatName: 'VP9',
      durationMs: 65_000,
    });
    store.add({
      kind: 'screenshot',
      blob: new Blob(['b']),
      filename: 'two.png',
      formatName: 'PNG',
    });

    const rows = $('takeList').querySelectorAll('[data-take-id]');
    const text = [...rows].map((r) => r.textContent ?? '');
    expect(text.some((t) => t.includes('01:05'))).toBe(true);
    expect(text.some((t) => t.includes('two.png'))).toBe(true);
  });

  it('rebuilds when a take is removed', () => {
    render();
    const keep = store.add({
      kind: 'recording',
      blob: new Blob(['a']),
      filename: 'keep.webm',
      formatName: 'VP9',
    });
    const gone = store.add({
      kind: 'recording',
      blob: new Blob(['b']),
      filename: 'gone.webm',
      formatName: 'VP9',
    });

    store.remove(gone.id);

    const rows = $('takeList').querySelectorAll('[data-take-id]');
    expect(rows.length).toBe(1);
    expect(rows[0].getAttribute('data-take-id')).toBe(keep.id);
  });

  it('wires the Clear button to emptying the store', () => {
    render();
    store.add({
      kind: 'recording',
      blob: new Blob(['a']),
      filename: 'one.webm',
      formatName: 'VP9',
    });

    $('clearTakesBtn').click();

    expect(store.count()).toBe(0);
    expect($('takeList').children.length).toBe(0);
    expect($('takesEmpty').classList.contains('hidden')).toBe(false);
  });

  it('stops listening once unbound', () => {
    render();
    view.unbind();

    store.add({
      kind: 'recording',
      blob: new Blob(['a']),
      filename: 'one.webm',
      formatName: 'VP9',
    });
    expect($('takeList').children.length).toBe(0);
  });

  it('labels each take with when it expires', () => {
    render();
    store.add({
      kind: 'recording',
      blob: new Blob(['a']),
      filename: 'one.webm',
      formatName: 'VP9',
    });

    const rows = $('takeList').querySelectorAll('[data-take-id]');
    expect(rows[0].textContent).toContain('Expires in 30 days');
  });

  it('shows an older take with less time left', () => {
    render();
    store.add({
      kind: 'recording',
      blob: new Blob(['a']),
      filename: 'one.webm',
      formatName: 'VP9',
      // 25 days old with a 30-day window: 5 days remain.
      createdAt: Date.now() - 25 * 24 * 60 * 60 * 1000,
    });

    const rows = $('takeList').querySelectorAll('[data-take-id]');
    expect(rows[0].textContent).toContain('Expires in 5 days');
  });

  it('re-times expiry labels on the minute without rebuilding rows', () => {
    // A label is only honest if it keeps up: "Expires in 2 minutes" is a lie
    // within the hour if nothing re-times it. The tick must rewrite text in
    // place - replacing rows would steal focus from anyone reading them.
    vi.useFakeTimers();
    try {
      render();
      store.add({
        kind: 'recording',
        blob: new Blob(['a']),
        filename: 'one.webm',
        formatName: 'VP9',
        // 2 minutes of window left.
        createdAt: Date.now() - (TAKE_TTL_MS - 2 * 60_000),
      });

      const row = $('takeList').querySelector('[data-take-id]');
      expect(row?.textContent).toContain('Expires in 2 minutes');

      vi.advanceTimersByTime(60_000);

      expect($('takeList').querySelector('[data-take-id]')).toBe(row);
      expect(row?.textContent).toContain('Expires in 1 minute');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops re-timing once unbound', () => {
    vi.useFakeTimers();
    try {
      render();
      store.add({
        kind: 'recording',
        blob: new Blob(['a']),
        filename: 'one.webm',
        formatName: 'VP9',
        createdAt: Date.now() - (TAKE_TTL_MS - 2 * 60_000),
      });
      view.unbind();

      // Nothing to re-time - the tick must not throw over the emptied list.
      expect(() => vi.advanceTimersByTime(120_000)).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('downloadAll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('queues every take and reports how many', () => {
    const store = new TakeStore();
    for (let i = 0; i < 3; i++) {
      store.add({
        kind: 'recording',
        blob: new Blob(['x']),
        filename: `take-${i}.webm`,
        formatName: 'VP9',
      });
    }

    expect(downloadAll(store.list())).toBe(3);
  });

  it('spaces the downloads out rather than firing them together', () => {
    // Browsers throttle parallel downloads from a single gesture, so the first
    // goes immediately and the rest are staggered behind it.
    const clicks = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    const store = new TakeStore();
    for (let i = 0; i < 3; i++) {
      store.add({
        kind: 'recording',
        blob: new Blob(['x']),
        filename: `take-${i}.webm`,
        formatName: 'VP9',
      });
    }

    downloadAll(store.list(), 250);

    vi.advanceTimersByTime(0);
    expect(clicks).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(250);
    expect(clicks).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(250);
    expect(clicks).toHaveBeenCalledTimes(3);

    clicks.mockRestore();
  });

  it('reports zero for an empty list', () => {
    expect(downloadAll([])).toBe(0);
  });
});
