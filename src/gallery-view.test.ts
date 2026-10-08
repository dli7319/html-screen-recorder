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
    <div id="previewScrim"></div>
    <div id="previewModal">
      <strong id="previewTitle"></strong>
      <button id="previewDownload"></button>
      <button id="previewClose"></button>
      <button id="previewPrev"></button>
      <button id="previewNext"></button>
      <p id="previewCounter"></p>
      <div id="previewMedia"></div>
    </div>
    <div id="toastHost"><span id="toastText"></span></div>
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

    // Two-step: first click arms, second empties.
    $('clearTakesBtn').click();
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

describe('GalleryView thumbnails', () => {
  it('shows the thumbnail picture when the take has one', () => {
    render();
    const added = store.add({
      kind: 'recording',
      blob: new Blob(['a']),
      filename: 'one.webm',
      formatName: 'VP9',
    });
    store.setThumbnail(added.id, new Blob(['thumb']));

    const img = $('takeList').querySelector(
      '.take-thumb img'
    ) as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(store.list()[0].thumbnailUrl);
    // The picture is decorative; the button carries the name.
    expect(img.alt).toBe('');
    expect(
      ($('takeList').querySelector('.take-thumb') as HTMLElement).getAttribute(
        'aria-label'
      )
    ).toBe('Preview one.webm');
  });

  it('keeps the glyph when there is no thumbnail yet', () => {
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

    const thumbs = $('takeList').querySelectorAll('.take-thumb');
    // Newest first, so the screenshot (added second) leads.
    expect(thumbs[0].textContent).toBe('📷');
    expect(thumbs[1].textContent).toBe('🎬');
    expect($('takeList').querySelector('.take-thumb img')).toBeNull();
  });

  it('updates the row when a thumbnail lands after rendering', () => {
    // Extraction is async: the row is drawn first, the picture fills in.
    render();
    const added = store.add({
      kind: 'recording',
      blob: new Blob(['a']),
      filename: 'one.webm',
      formatName: 'VP9',
    });

    store.setThumbnail(added.id, new Blob(['thumb']));

    expect($('takeList').querySelector('.take-thumb img')).toBeTruthy();
    expect($('takeList').querySelector('.take-thumb')?.textContent).toBe('');
  });

  it('opens the preview on click and puts the take in it', () => {
    render();
    store.add({
      kind: 'screenshot',
      blob: new Blob(['b']),
      filename: 'two.png',
      formatName: 'PNG',
    });

    ($('takeList').querySelector('.take-thumb') as HTMLButtonElement).click();

    expect(document.body.dataset.preview).toBe('open');
    expect($('previewTitle').textContent).toBe('two.png');
    expect($('previewMedia').querySelector('img')).toBeTruthy();
  });

  it('is a real button, so Enter opens the preview too', () => {
    render();
    store.add({
      kind: 'recording',
      blob: new Blob(['a']),
      filename: 'one.webm',
      formatName: 'VP9',
    });

    const thumb = $('takeList').querySelector(
      '.take-thumb'
    ) as HTMLButtonElement;
    expect(thumb.tagName).toBe('BUTTON');
    expect(thumb.type).toBe('button');

    thumb.click();
    expect(document.body.dataset.preview).toBe('open');
  });
});

describe('GalleryView hover playback', () => {
  it('plays the clip inside the thumbnail on hover, muted and without controls', () => {
    render();
    const added = store.add({
      kind: 'recording',
      blob: new Blob(['a']),
      filename: 'one.webm',
      formatName: 'VP9',
    });

    const thumb = $('takeList').querySelector('.take-thumb') as HTMLElement;
    thumb.dispatchEvent(new MouseEvent('mouseenter'));

    const video = thumb.querySelector('video') as HTMLVideoElement;
    expect(video).toBeTruthy();
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.controls).toBe(false);
    expect(video.hasAttribute('controls')).toBe(false);
    expect(video.getAttribute('src')).toBe(added.url);
  });

  it('takes the hover video back out on leave', () => {
    render();
    const added = store.add({
      kind: 'recording',
      blob: new Blob(['a']),
      filename: 'one.webm',
      formatName: 'VP9',
    });
    store.setThumbnail(added.id, new Blob(['thumb']));

    const thumb = $('takeList').querySelector('.take-thumb') as HTMLElement;
    thumb.dispatchEvent(new MouseEvent('mouseenter'));
    thumb.dispatchEvent(new MouseEvent('mouseleave'));

    expect(thumb.querySelector('video')).toBeNull();
    // The still underneath is undisturbed, so the next hover starts clean.
    expect(thumb.querySelector('img')).toBeTruthy();
  });

  it('does not stack a second video when the pointer fusses in and out', () => {
    render();
    store.add({
      kind: 'recording',
      blob: new Blob(['a']),
      filename: 'one.webm',
      formatName: 'VP9',
    });

    const thumb = $('takeList').querySelector('.take-thumb') as HTMLElement;
    thumb.dispatchEvent(new MouseEvent('mouseenter'));
    thumb.dispatchEvent(new MouseEvent('mouseenter'));

    expect(thumb.querySelectorAll('video').length).toBe(1);
  });

  it('gives screenshots nothing to play', () => {
    render();
    store.add({
      kind: 'screenshot',
      blob: new Blob(['b']),
      filename: 'two.png',
      formatName: 'PNG',
    });

    const thumb = $('takeList').querySelector('.take-thumb') as HTMLElement;
    thumb.dispatchEvent(new MouseEvent('mouseenter'));

    expect(thumb.querySelector('video')).toBeNull();
  });
});

describe('GalleryView action feedback', () => {
  function addOne() {
    store.add({
      kind: 'recording',
      blob: new Blob(['a']),
      filename: 'one.webm',
      formatName: 'VP9',
    });
  }

  it('Clear is two-step: first click arms, second clears', () => {
    render();
    addOne();
    const clear = $('clearTakesBtn') as HTMLButtonElement;

    clear.click();
    expect(clear.textContent).toBe('Confirm clear?');
    expect(clear.classList.contains('is-armed')).toBe(true);
    expect($('takeList').children.length).toBe(1); // armed, not yet cleared

    clear.click();
    expect($('takeList').children.length).toBe(0);
    expect(clear.textContent).toBe('Clear');
    expect(clear.classList.contains('is-armed')).toBe(false);
    expect($('toastText').textContent).toBe('Cleared 1 take');
  });

  it('an armed Clear reverts after a beat, never stranded', () => {
    vi.useFakeTimers();
    render();
    addOne();
    const clear = $('clearTakesBtn') as HTMLButtonElement;

    clear.click();
    expect(clear.textContent).toBe('Confirm clear?');
    vi.advanceTimersByTime(4000);
    expect(clear.textContent).toBe('Clear');
    expect(clear.classList.contains('is-armed')).toBe(false);
    vi.useRealTimers();
  });

  it('removing a take reports it in the toast', () => {
    render();
    addOne();

    const remove = [...$('takeList').querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Remove'
    ) as HTMLButtonElement;
    remove.click();

    expect($('takeList').children.length).toBe(0);
    expect($('toastText').textContent).toBe('Removed one.webm');
  });

  it('Download all announces what it is doing', () => {
    render();
    addOne();
    store.add({
      kind: 'screenshot',
      blob: new Blob(['b']),
      filename: 'two.png',
      formatName: 'PNG',
    });

    ($('downloadAllBtn') as HTMLButtonElement).click();
    expect($('toastText').textContent).toBe('Downloading 2 takes');
  });
});

describe('GalleryView thumbnail polish', () => {
  it('gives a recording with a still a play badge for the hover clip', () => {
    render();
    const added = store.add({
      kind: 'recording',
      blob: new Blob(['a']),
      filename: 'one.webm',
      formatName: 'VP9',
    });
    store.setThumbnail(added.id, new Blob(['t']));

    const thumb = $('takeList').querySelector('.take-thumb') as HTMLElement;
    expect(thumb.querySelector('.thumb-cue')).toBeTruthy();
    expect(thumb.classList.contains('is-loading')).toBe(false);
  });

  it('gives a screenshot no play badge - it has no motion', () => {
    render();
    const added = store.add({
      kind: 'screenshot',
      blob: new Blob(['b']),
      filename: 'two.png',
      formatName: 'PNG',
    });
    store.setThumbnail(added.id, new Blob(['t']));

    const thumb = $('takeList').querySelector('.take-thumb') as HTMLElement;
    expect(thumb.querySelector('.thumb-cue')).toBeNull();
  });

  it('shimmers the box while a still is pending, and drops it once it lands', () => {
    render();
    const added = store.add({
      kind: 'screenshot',
      blob: new Blob(['b']),
      filename: 'two.png',
      formatName: 'PNG',
    });

    // No thumbnail yet -> loading shimmer over the glyph.
    let thumb = $('takeList').querySelector('.take-thumb') as HTMLElement;
    expect(thumb.classList.contains('is-loading')).toBe(true);
    expect(thumb.textContent).toBe('📷');

    store.setThumbnail(added.id, new Blob(['t']));
    thumb = $('takeList').querySelector('.take-thumb') as HTMLElement;
    expect(thumb.classList.contains('is-loading')).toBe(false);
    expect(thumb.querySelector('img')).toBeTruthy();
  });
});

describe('GalleryView expiry tone', () => {
  const MIN = 60_000;
  const HOUR = 60 * MIN;

  function addAt(createdAt: number) {
    return store.add({
      kind: 'recording',
      blob: new Blob(['a']),
      filename: 'one.webm',
      formatName: 'VP9',
      createdAt,
    });
  }

  const expiryLabel = () =>
    $('takeList').querySelector('[data-expires-at]') as HTMLElement;

  it('keeps a take with weeks left calm', () => {
    render();
    addAt(Date.now());
    const label = expiryLabel();
    expect(label.classList.contains('take-expiry')).toBe(true);
    expect(label.classList.contains('is-soon')).toBe(false);
    expect(label.classList.contains('is-urgent')).toBe(false);
  });

  it('flags a take with hours left as soon', () => {
    render();
    addAt(Date.now() - (TAKE_TTL_MS - 3 * HOUR));
    expect(expiryLabel().classList.contains('is-soon')).toBe(true);
  });

  it('flags a take about to vanish as urgent', () => {
    render();
    addAt(Date.now() - (TAKE_TTL_MS - 30 * MIN));
    expect(expiryLabel().classList.contains('is-urgent')).toBe(true);
  });

  it('groups expiry and the actions so they wrap together on a narrow row', () => {
    render();
    addAt(Date.now());

    const row = $('takeList').querySelector('.take-row') as HTMLElement;
    const actions = row.querySelector('.take-actions') as HTMLElement;
    expect(actions).toBeTruthy();
    expect(actions.querySelector('[data-expires-at]')).toBeTruthy();
    expect(
      [...actions.querySelectorAll('button')].map((b) => b.textContent.trim())
    ).toEqual(['Download', 'Remove']);
  });
});
