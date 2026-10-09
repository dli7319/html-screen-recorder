import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TakePreview } from './preview-modal';
import { Take, TakeStore } from './takes';

const PREVIEW_MARKUP = `
  <main>
    <div id="previewScrim"></div>
    <div id="previewModal">
      <strong id="previewTitle"></strong>
      <button id="previewDownload"></button>
      <button id="previewRemove"></button>
      <button id="previewClose"></button>
      <button id="previewPrev"></button>
      <button id="previewNext"></button>
      <p id="previewCounter"></p>
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

  it('sizes the media box from the clip itself, not the video default', () => {
    // The bug this guards: a <video> is 300x150 until its metadata arrives -
    // which for MediaRecorder MP4s can be at play time - so a dialog sized
    // from content opened tiny and jumped on play. The box is sized from the
    // aspect instead, so it must be set from whatever knows the shape.
    setup();
    const take = addRecording();
    preview.open(take);

    const video = media().querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'videoWidth', { value: 1280 });
    Object.defineProperty(video, 'videoHeight', { value: 720 });
    video.dispatchEvent(new Event('loadedmetadata'));

    expect(video.style.getPropertyValue('--preview-ar')).toBe('1280 / 720');
    expect(video.style.getPropertyValue('--preview-ar-k')).toBe(
      String(1280 / 720)
    );
  });

  it('takes the aspect from the thumbnail before any metadata lands', () => {
    // The thumbnail is cut from the clip, so its shape is the clip's shape -
    // available the moment the dialog opens, far ahead of video metadata.
    const probes: FakeImage[] = [];
    class FakeImage {
      naturalWidth = 0;
      naturalHeight = 0;
      private listeners: Record<string, () => void> = {};
      addEventListener(type: string, fn: () => void) {
        this.listeners[type] = fn;
      }
      set src(_value: string) {
        probes.push(this);
      }
      load(width: number, height: number) {
        this.naturalWidth = width;
        this.naturalHeight = height;
        this.listeners['load']?.();
      }
    }
    vi.stubGlobal('Image', FakeImage);

    setup();
    const take = addRecording();
    store.setThumbnail(take.id, new Blob(['thumb']));
    preview.open(store.list()[0]);

    expect(probes.length).toBe(1);
    probes[0].load(640, 360);

    const video = media().querySelector('video') as HTMLVideoElement;
    expect(video.style.getPropertyValue('--preview-ar')).toBe('640 / 360');
    vi.unstubAllGlobals();
  });

  it('ignores a thumbnail probe that answers for a take already replaced', () => {
    const probes: FakeImage[] = [];
    class FakeImage {
      naturalWidth = 0;
      naturalHeight = 0;
      private listeners: Record<string, () => void> = {};
      addEventListener(type: string, fn: () => void) {
        this.listeners[type] = fn;
      }
      set src(_value: string) {
        probes.push(this);
      }
      load(width: number, height: number) {
        this.naturalWidth = width;
        this.naturalHeight = height;
        this.listeners['load']?.();
      }
    }
    vi.stubGlobal('Image', FakeImage);

    setup();
    const first = addRecording();
    store.setThumbnail(first.id, new Blob(['thumb']));
    preview.open(store.list()[0]);
    preview.open(addScreenshot());

    // The stale probe must not touch the screenshot now on screen.
    probes[0].load(640, 360);
    expect(media().querySelector('video')).toBeNull();
    vi.unstubAllGlobals();
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

describe('TakePreview navigation', () => {
  it('hides the nav and shows no count for a single take', () => {
    setup();
    preview.open(addRecording());

    expect($('previewCounter').textContent).toBe('');
    expect($('previewPrev').classList.contains('hidden')).toBe(true);
    expect($('previewNext').classList.contains('hidden')).toBe(true);
  });

  it('shows position and steps forward with the next button', () => {
    setup();
    addRecording();
    addScreenshot();
    preview.open(store.list()[0]);

    expect($('previewCounter').textContent).toBe('1 / 2');
    expect(($('previewPrev') as HTMLButtonElement).disabled).toBe(true);
    expect(($('previewNext') as HTMLButtonElement).disabled).toBe(false);

    ($('previewNext') as HTMLButtonElement).click();
    expect($('previewCounter').textContent).toBe('2 / 2');
    expect(($('previewPrev') as HTMLButtonElement).disabled).toBe(false);
    expect(($('previewNext') as HTMLButtonElement).disabled).toBe(true);
  });

  it('steps with the arrow keys', () => {
    setup();
    addRecording();
    addScreenshot();
    preview.open(store.list()[0]);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
    );
    expect($('previewCounter').textContent).toBe('2 / 2');

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })
    );
    expect($('previewCounter').textContent).toBe('1 / 2');
  });

  it('reports the open take at its own position', () => {
    setup();
    addRecording();
    addScreenshot();
    preview.open(store.list()[1]);

    expect($('previewCounter').textContent).toBe('2 / 2');
    expect(($('previewPrev') as HTMLButtonElement).disabled).toBe(false);
    expect(($('previewNext') as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the media in step with the position', () => {
    setup();
    addRecording();
    const shot = addScreenshot();
    preview.open(store.list()[0]);
    expect($('previewTitle').textContent).toBe(shot.filename);

    ($('previewNext') as HTMLButtonElement).click();
    expect($('previewTitle').textContent).toBe('clip.webm');
  });
});

describe('TakePreview remove', () => {
  it('steps to the next take after removing one', () => {
    setup();
    addRecording();
    const shot = addScreenshot();
    preview.open(store.list()[0]); // the screenshot is newest
    expect($('previewTitle').textContent).toBe(shot.filename);

    ($('previewRemove') as HTMLButtonElement).click();

    expect(store.count()).toBe(1);
    // Curate flow: still open, now showing the remaining take.
    expect(document.body.dataset.preview).toBe('open');
    expect($('previewTitle').textContent).toBe('clip.webm');
  });

  it('closes the dialog when the last take is removed', () => {
    setup();
    preview.open(addRecording());

    ($('previewRemove') as HTMLButtonElement).click();

    expect(store.count()).toBe(0);
    expect(document.body.dataset.preview).toBe('closed');
  });
});
