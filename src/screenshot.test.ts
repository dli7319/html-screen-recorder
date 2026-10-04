import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureFrame, downloadBlob, frameSize } from './screenshot';

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
