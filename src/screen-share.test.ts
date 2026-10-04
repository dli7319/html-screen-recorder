import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MIC_OPTIONS,
  shareScreen,
  type MicOptions,
} from './screen-share';

/** jsdom has neither MediaStream nor AudioContext, so stub the minimum. */
class FakeMediaStream {
  private tracks: unknown[] = [];
  constructor(tracks: unknown[] = []) {
    this.tracks = [...tracks];
  }
  addTrack(track: unknown) {
    this.tracks.push(track);
  }
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks.filter((t) => (t as { kind?: string }).kind === 'video');
  }
  getAudioTracks() {
    return this.tracks.filter((t) => (t as { kind?: string }).kind === 'audio');
  }
}

function fakeStream(video = true, audio = 0): MediaStream {
  const tracks = [
    ...(video ? [{ kind: 'video' }] : []),
    ...Array.from({ length: audio }, () => ({ kind: 'audio' })),
  ];
  return new FakeMediaStream(tracks) as unknown as MediaStream;
}

let getUserMedia: ReturnType<typeof vi.fn>;
let getDisplayMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // No audio tracks: this suite is about the constraints sent to getUserMedia,
  // and any real audio track would make shareScreen build an AudioContext,
  // which jsdom does not implement.
  getUserMedia = vi.fn(async () => fakeStream(false, 0));
  getDisplayMedia = vi.fn(async () => fakeStream(true, 0));
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia, getDisplayMedia },
  });
  vi.stubGlobal('MediaStream', FakeMediaStream);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const mic = (over: Partial<MicOptions> = {}): MicOptions => ({
  ...DEFAULT_MIC_OPTIONS,
  ...over,
});

describe('shareScreen microphone constraints', () => {
  it('does not touch the microphone when it is not requested', async () => {
    await shareScreen(false, mic({ enabled: false }));
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('requests the microphone with the chosen conditioning', async () => {
    await shareScreen(
      false,
      mic({ enabled: true, noiseSuppression: false, autoGainControl: false })
    );

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        noiseSuppression: false,
        echoCancellation: true,
        autoGainControl: false,
      },
    });
  });

  it('asks for all three when everything is enabled', async () => {
    await shareScreen(false, mic({ enabled: true }));

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: true,
      },
    });
  });

  it('always sends explicit booleans rather than leaving them to the browser', async () => {
    // Unset constraints would let the browser pick its own defaults,
    // silently ignoring the user's choice.
    await shareScreen(false, mic({ enabled: true, noiseSuppression: false }));

    const [constraints] = getUserMedia.mock.calls[0];
    const audio = constraints.audio;
    expect(Object.keys(audio).sort()).toEqual([
      'autoGainControl',
      'echoCancellation',
      'noiseSuppression',
    ]);
    for (const value of Object.values(audio)) {
      expect(typeof value).toBe('boolean');
    }
  });
});

describe('shareScreen display constraints', () => {
  it('always keeps the cursor visible', async () => {
    await shareScreen(false, mic());
    expect(getDisplayMedia).toHaveBeenCalledWith({
      video: { cursor: 'always' },
      audio: false,
    });
  });

  it('requests system audio only when asked', async () => {
    await shareScreen(true, mic());
    expect(getDisplayMedia).toHaveBeenCalledWith({
      video: { cursor: 'always' },
      audio: true,
    });
  });

  it('reports a friendly error when the microphone is denied', async () => {
    getUserMedia.mockRejectedValueOnce(
      Object.assign(new Error('denied'), {
        name: 'NotAllowedError',
      })
    );

    await expect(shareScreen(false, mic({ enabled: true }))).rejects.toThrow(
      /Could not access microphone/
    );
  });
});

describe('DEFAULT_MIC_OPTIONS', () => {
  it('turns every conditioner on as the out-of-the-box setting', () => {
    expect(DEFAULT_MIC_OPTIONS).toEqual({
      enabled: false,
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
    });
  });

  it('leaves the microphone off until the user opts in', () => {
    expect(DEFAULT_MIC_OPTIONS.enabled).toBe(false);
  });
});
