import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureFrame,
  downloadBlob,
  frameSize,
  selectionToFrameRegion,
} from './screenshot';

describe('frameSize', () => {
  it("returns the frame's decoded dimensions", () => {
    expect(frameSize({ videoWidth: 3456, videoHeight: 2234 })).toEqual({
      width: 3456,
      height: 2234,
    });
  });

  it('returns null before a frame exists', () => {
    // videoWidth/videoHeight are 0 until metadata is decoded.
    expect(frameSize({ videoWidth: 0, videoHeight: 0 })).toBeNull();
  });

  it('returns null when only one dimension is known', () => {
    expect(frameSize({ videoWidth: 1920, videoHeight: 0 })).toBeNull();
    expect(frameSize({ videoWidth: 0, videoHeight: 1080 })).toBeNull();
  });

  it('treats non-finite dimensions as no frame at all', () => {
    expect(frameSize({ videoWidth: NaN, videoHeight: NaN })).toBeNull();
  });
});

describe('selectionToFrameRegion', () => {
  /** The preview element showing a 640x360 frame at its own size. */
  const element = { left: 0, top: 0, width: 640, height: 360 };

  it('maps a full-element selection onto the whole frame', () => {
    expect(selectionToFrameRegion(element, element, 640, 360)).toEqual({
      x: 0,
      y: 0,
      width: 640,
      height: 360,
    });
  });

  it('maps the default crop box (the middle 80%) onto its share of the frame', () => {
    // 10% inset on every side of the preview.
    const selection = { left: 64, top: 36, width: 512, height: 288 };
    expect(selectionToFrameRegion(selection, element, 640, 360)).toEqual({
      x: 64,
      y: 36,
      width: 512,
      height: 288,
    });
  });

  it('maps through a scaled-up preview unchanged', () => {
    // The same 80% box over a preview displayed at 2x.
    const big = { left: 0, top: 0, width: 1280, height: 720 };
    const selection = { left: 128, top: 72, width: 1024, height: 576 };
    expect(selectionToFrameRegion(selection, big, 640, 360)).toEqual({
      x: 64,
      y: 36,
      width: 512,
      height: 288,
    });
  });

  it('accounts for the letterbox bars inside the element', () => {
    // A 4:3 element containing a 16:9 frame: the picture is 800x450 centred
    // at y=75, and only the picture box may be sampled.
    const letterboxed = { left: 0, top: 0, width: 800, height: 600 };
    const picture = { left: 0, top: 75, width: 800, height: 450 };
    expect(selectionToFrameRegion(picture, letterboxed, 640, 360)).toEqual({
      x: 0,
      y: 0,
      width: 640,
      height: 360,
    });
  });

  it('drops a selection sitting only in a letterbox bar', () => {
    const letterboxed = { left: 0, top: 0, width: 800, height: 600 };
    const bar = { left: 0, top: 0, width: 800, height: 75 };
    expect(selectionToFrameRegion(bar, letterboxed, 640, 360)).toBeNull();
  });

  it('clamps a selection that overhangs the frame', () => {
    const selection = { left: 500, top: 300, width: 300, height: 200 };
    expect(selectionToFrameRegion(selection, element, 640, 360)).toEqual({
      x: 500,
      y: 300,
      width: 140,
      height: 60,
    });
  });

  it('rounds to whole pixels without letting the region drift', () => {
    // An exact 2x display of the frame with a fractional draw: both edges of
    // each axis are rounded together, so the size stays the drawn size.
    const scaled = { left: 0, top: 0, width: 1280, height: 720 };
    const selection = { left: 100.4, top: 50.3, width: 400.2, height: 200.1 };
    const region = selectionToFrameRegion(selection, scaled, 640, 360);
    expect(region).toEqual({ x: 50, y: 25, width: 200, height: 100 });
    for (const value of Object.values(region!)) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('returns null when there is no picture or no selection to map', () => {
    const selection = { left: 0, top: 0, width: 10, height: 10 };
    expect(selectionToFrameRegion(selection, element, 0, 360)).toBeNull();
    expect(selectionToFrameRegion(selection, element, 640, 0)).toBeNull();
    expect(selectionToFrameRegion(selection, element, NaN, 360)).toBeNull();
    expect(
      selectionToFrameRegion(selection, { ...element, width: 0 }, 640, 360)
    ).toBeNull();
    expect(
      selectionToFrameRegion({ ...selection, width: 0 }, element, 640, 360)
    ).toBeNull();
  });
});

describe('captureFrame', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing when there is no frame to capture', async () => {
    const video = {
      videoWidth: 0,
      videoHeight: 0,
    } as unknown as HTMLVideoElement;
    expect(await captureFrame(video)).toBeNull();
  });

  it('returns null when a 2d context is unavailable', async () => {
    const video = {
      videoWidth: 100,
      videoHeight: 50,
    } as unknown as HTMLVideoElement;

    vi.spyOn(document, 'createElement').mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => null,
    } as unknown as HTMLCanvasElement);

    expect(await captureFrame(video)).toBeNull();
  });

  it('draws the frame at its native size', async () => {
    const video = {
      videoWidth: 640,
      videoHeight: 480,
    } as unknown as HTMLVideoElement;

    const drawImage = vi.fn();
    const toBlob = vi.fn((cb: (b: Blob | null) => void) =>
      cb(new Blob(['png'], { type: 'image/png' }))
    );
    vi.spyOn(document, 'createElement').mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob,
    } as unknown as HTMLCanvasElement);

    const blob = await captureFrame(video);

    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 640, 480);
    expect(blob?.type).toBe('image/png');
    // the canvas must be sized to the frame before drawing
    const canvas = vi.mocked(document.createElement).mock.results[0].value;
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(480);
  });

  it('draws only the crop region when one is given', async () => {
    const video = {
      videoWidth: 640,
      videoHeight: 360,
    } as unknown as HTMLVideoElement;
    const drawImage = vi.fn();
    vi.spyOn(document, 'createElement').mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob: (cb: (b: Blob | null) => void) =>
        cb(new Blob(['png'], { type: 'image/png' })),
    } as unknown as HTMLCanvasElement);

    const blob = await captureFrame(video, {
      x: 64,
      y: 36,
      width: 512,
      height: 288,
    });

    // The region is read out of the frame and written 1:1 into a canvas sized
    // to it - the still's pixels are the region's pixels.
    expect(drawImage).toHaveBeenCalledWith(
      video,
      64,
      36,
      512,
      288,
      0,
      0,
      512,
      288
    );
    const canvas = vi.mocked(document.createElement).mock.results[0].value;
    expect(canvas.width).toBe(512);
    expect(canvas.height).toBe(288);
    expect(blob?.type).toBe('image/png');
  });

  it('refuses a degenerate region instead of emitting a blank still', async () => {
    const video = {
      videoWidth: 640,
      videoHeight: 360,
    } as unknown as HTMLVideoElement;
    const createElement = vi.spyOn(document, 'createElement');

    expect(
      await captureFrame(video, { x: 0, y: 0, width: 0, height: 10 })
    ).toBeNull();
    expect(createElement).not.toHaveBeenCalled();
  });

  it('resolves null when the canvas cannot be encoded', async () => {
    const video = {
      videoWidth: 10,
      videoHeight: 10,
    } as unknown as HTMLVideoElement;

    vi.spyOn(document, 'createElement').mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (cb: (b: Blob | null) => void) => cb(null),
    } as unknown as HTMLCanvasElement);

    expect(await captureFrame(video)).toBeNull();
  });
});

describe('downloadBlob', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('creates a link, clicks it, and cleans up after itself', () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });

    downloadBlob(new Blob(['x']), 'shot.png');

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    // the temporary anchor must not be left in the document
    expect(document.querySelector('a')).toBeNull();

    vi.unstubAllGlobals();
  });

  it('sets the filename on the link', () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => 'blob:mock',
      revokeObjectURL: () => {},
    });

    const spy = vi.spyOn(document, 'createElement');
    downloadBlob(new Blob(['x']), '20261004134507.png');

    const anchor = spy.mock.results[0].value as HTMLAnchorElement;
    expect(anchor.download).toBe('20261004134507.png');
    expect(click).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });
});
