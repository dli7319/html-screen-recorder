import { afterEach, describe, expect, it, vi } from 'vitest';
import { PictureInPicture } from './pip';

/**
 * jsdom has no picture-in-picture. The tricky part is not the calls but the
 * state: the floating window has its own close button, so `enter()` resolving
 * is not proof that PiP is still active a moment later.
 */
function fakeVideo() {
  return {
    requestPictureInPicture: vi.fn(async () => {}),
  } as unknown as HTMLVideoElement;
}

let onChange: ReturnType<typeof vi.fn<(active: boolean) => void>>;
let video: HTMLVideoElement;
let pip: PictureInPicture;

function setup(supported = true) {
  video = fakeVideo();
  onChange = vi.fn<(active: boolean) => void>();
  pip = new PictureInPicture(video, { onChange });

  Object.defineProperty(document, 'pictureInPictureEnabled', {
    value: supported,
    configurable: true,
  });
  Object.defineProperty(document, 'pictureInPictureElement', {
    value: undefined,
    writable: true,
    configurable: true,
  });
  document.exitPictureInPicture = vi.fn(async () => {
    (
      document as { pictureInPictureElement?: Element | null }
    ).pictureInPictureElement = null;
    document.dispatchEvent(new Event('leavepictureinpicture'));
  });

  return pip;
}

afterEach(() => {
  pip?.destroy();
  vi.restoreAllMocks();
});

describe('PictureInPicture.isSupported', () => {
  it('reports support when the document allows it', () => {
    expect(setup(true).isSupported()).toBe(true);
  });

  it('reports no support when the document disables it', () => {
    // A button that silently does nothing is worse than no button at all.
    expect(setup(false).isSupported()).toBe(false);
  });

  it('falls back to the video element when the document flag is absent', () => {
    const v = fakeVideo();
    const p = new PictureInPicture(v);
    Object.defineProperty(document, 'pictureInPictureEnabled', {
      value: undefined,
      configurable: true,
    });

    expect(p.isSupported()).toBe(true);
    p.destroy();
  });
});

describe('PictureInPicture.enter', () => {
  it('opens the floating window and reports it', async () => {
    const p = setup();
    expect(await p.enter()).toBe(true);

    expect(video.requestPictureInPicture).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(true);
    expect(p.isActive()).toBe(true);
  });

  it('does nothing when already floating', async () => {
    const p = setup();
    await p.enter();
    onChange.mockClear();

    expect(await p.enter()).toBe(false);
    expect(video.requestPictureInPicture).toHaveBeenCalledOnce();
  });

  it('refuses without support rather than throwing', async () => {
    const p = setup(false);
    expect(await p.enter()).toBe(false);
    expect(video.requestPictureInPicture).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports failure instead of throwing when the browser refuses', async () => {
    // NotAllowedError is the missing-user-gesture case; it must not take down
    // the page.
    const p = setup();
    (
      video.requestPictureInPicture as ReturnType<typeof vi.fn>
    ).mockRejectedValue(
      Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    );

    expect(await p.enter()).toBe(false);
    expect(p.isActive()).toBe(false);
  });
});

describe('PictureInPicture state tracking', () => {
  it('follows the browser when the user closes the floating window', async () => {
    // This is the whole reason the class listens for leavepictureinpicture:
    // the window's own close button is outside this page's control.
    const p = setup();
    await p.enter();
    onChange.mockClear();

    (
      document as { pictureInPictureElement?: Element | null }
    ).pictureInPictureElement = null;
    document.dispatchEvent(new Event('leavepictureinpicture'));

    expect(p.isActive()).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('ignores a leave event when nothing was active', () => {
    setup();
    document.dispatchEvent(new Event('leavepictureinpicture'));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('stops listening after destroy', async () => {
    const p = setup();
    await p.enter();
    p.destroy();

    document.dispatchEvent(new Event('leavepictureinpicture'));
    expect(p.isActive()).toBe(true);
    expect(onChange).not.toHaveBeenCalledWith(false);
  });
});

describe('PictureInPicture.exit', () => {
  it('closes the window and reports it', async () => {
    const p = setup();
    await p.enter();
    (
      document as { pictureInPictureElement?: Element | null }
    ).pictureInPictureElement = video;

    await p.exit();

    expect(document.exitPictureInPicture).toHaveBeenCalledOnce();
    expect(p.isActive()).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('is safe when nothing is floating', async () => {
    const p = setup();
    await expect(p.exit()).resolves.toBeUndefined();
    expect(document.exitPictureInPicture).not.toHaveBeenCalled();
  });
});

describe('PictureInPicture.toggle', () => {
  it('enters then leaves', async () => {
    const p = setup();
    await p.toggle();
    expect(p.isActive()).toBe(true);

    (
      document as { pictureInPictureElement?: Element | null }
    ).pictureInPictureElement = video;
    await p.toggle();
    expect(p.isActive()).toBe(false);
  });

  it('leaves when already floating', async () => {
    const p = setup();
    await p.enter();
    (
      document as { pictureInPictureElement?: Element | null }
    ).pictureInPictureElement = video;

    await p.toggle();
    expect(document.exitPictureInPicture).toHaveBeenCalledOnce();
  });
});
