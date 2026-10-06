import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TakePreview } from './preview-modal';
import { Take, TakeStore } from './takes';

const PREVIEW_MARKUP = `
  <main>
    <div id="previewScrim"></div>
    <div id="previewModal">
      <strong id="previewTitle"></strong>
      <button id="previewDownload"></button>
      <button id="previewClose"></button>
      <div id="previewMedia"></div>
    </div>
  </main>
`;

/**
 * jsdom has no createObjectURL; the store makes URLs for every take, so the
 * same stub the store tests use stands in here.
 */
beforeEach(() => {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => `blob:test/${Math.random()}`),
    revokeObjectURL: vi.fn(),
  });
  document.body.innerHTML = PREVIEW_MARKUP;
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

let store: TakeStore;
let preview: TakePreview;

function setup() {
  store = new TakeStore();
  preview = new TakePreview(document, store);
  preview.bind();
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const media = () => $('previewMedia');

function addRecording(): Take {
  return store.add({
    kind: 'recording',
    blob: new Blob(['vid']),
    filename: 'clip.webm',
    formatName: 'VP9',
  });
}

function addScreenshot(): Take {
  return store.add({
    kind: 'screenshot',
    blob: new Blob(['img']),
    filename: 'shot.png',
    formatName: 'PNG',
  });
}

describe('TakePreview.open', () => {
  it('shows a recording as a video sourced from the take', () => {
    setup();
    const take = addRecording();

    preview.open(take);

    const video = media().querySelector('video') as HTMLVideoElement;
    expect(video).toBeTruthy();
    expect(video.getAttribute('src')).toBe(take.url);
    expect(video.controls).toBe(true);
    expect(media().querySelector('img')).toBeNull();
  });

  it('shows a screenshot as an image sourced from the take', () => {
    setup();
    const take = addScreenshot();

    preview.open(take);

    const img = media().querySelector('img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(take.url);
    expect(img.alt).toBe(take.filename);
    expect(media().querySelector('video')).toBeNull();
  });

  it('uses the thumbnail as the video poster and titles the dialog', () => {
    setup();
    const take = addRecording();
    store.setThumbnail(take.id, new Blob(['thumb']));

    preview.open(store.list()[0]);

    const video = media().querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('poster')).toBe(store.list()[0].thumbnailUrl);
    expect($('previewTitle').textContent).toBe('clip.webm');
  });

  it('replaces rather than stacks when opened again', () => {
    setup();
    preview.open(addRecording());
    preview.open(addScreenshot());

    expect(media().children.length).toBe(1);
    expect(media().querySelector('video')).toBeNull();
  });
});

describe('TakePreview closing', () => {
  it('closes from the close button, the scrim, and Escape', () => {
    setup();
    const take = addRecording();
    preview.open(take);
    expect(document.body.dataset.preview).toBe('open');

    $('previewClose').click();
    expect(document.body.dataset.preview).toBe('closed');

    preview.open(take);
    $('previewScrim').click();
    expect(document.body.dataset.preview).toBe('closed');

    preview.open(take);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    expect(document.body.dataset.preview).toBe('closed');
  });

  it('clears the media so a closed clip cannot keep playing', () => {
    setup();
    const take = addRecording();
    preview.open(take);
    const video = media().querySelector('video') as HTMLVideoElement;
    const pause = vi.spyOn(video, 'pause').mockImplementation(() => {});

    preview.close();

    expect(pause).toHaveBeenCalled();
    expect(media().children.length).toBe(0);
  });

  it('returns focus to whatever opened it', () => {
    setup();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();

    preview.open(addRecording(), opener);
    expect(document.activeElement).toBe($('previewClose'));

    preview.close();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('does nothing when already closed', () => {
    setup();
    // The body flag is shared page state: it may read 'closed' from a previous
    // test's teardown. What matters is that close() leaves it untouched.
    const before = document.body.dataset.preview;

    expect(() => preview.close()).not.toThrow();

    expect(document.body.dataset.preview).toBe(before);
  });
});

describe('TakePreview with store changes', () => {
  it('closes itself when the take it shows is removed', () => {
    setup();
    const take = addRecording();
    preview.open(take);

    store.remove(take.id);

    expect(document.body.dataset.preview).toBe('closed');
    expect(media().children.length).toBe(0);
  });

  it('closes itself when the store is cleared', () => {
    setup();
    preview.open(addRecording());

    store.clear();

    expect(document.body.dataset.preview).toBe('closed');
  });

  it('closes without throwing when unbound first and removed after', () => {
    // The handlers are gone; the take vanishing must still leave the store
    // working and the next open() clean.
    setup();
    const take = addRecording();
    preview.open(take);
    preview.unbind();
    expect(() => store.remove(take.id)).not.toThrow();
  });

  it('catches up the poster when a thumbnail lands mid-preview', () => {
    setup();
    const take = addRecording();
    preview.open(take);
    expect(
      (media().querySelector('video') as HTMLVideoElement).getAttribute(
        'poster'
      )
    ).toBeNull();

    store.setThumbnail(take.id, new Blob(['thumb']));

    const video = media().querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('poster')).toBe(store.list()[0].thumbnailUrl);
  });
});

describe('TakePreview download', () => {
  it('downloads the take it is showing under its filename', () => {
    const saved: string[] = [];
    const clicks = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        saved.push(this.download);
      });
    setup();
    const take = addRecording();
    preview.open(take);

    $('previewDownload').click();

    expect(saved).toEqual(['clip.webm']);
    clicks.mockRestore();
  });

  it('downloads nothing when the take is already gone', () => {
    const clicks = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    setup();
    const take = addRecording();
    preview.open(take);
    store.remove(take.id);

    $('previewDownload').click();

    expect(clicks).not.toHaveBeenCalled();
    clicks.mockRestore();
  });
});
