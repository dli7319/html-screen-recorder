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

/** Records how each node was wired, so the audio graph can be asserted. */
function node(kind: string) {
  return {
    kind,
    fftSize: 0,
    gain: { value: 1 },
    connections: [] as string[],
    connect(target: { kind: string }) {
      this.connections.push(target.kind);
      return target;
    },
  };
}

function makeAudioContext() {
  const created: ReturnType<typeof node>[] = [];
  return {
    created,
    resume: vi.fn(async () => {}),
    createMediaStreamDestination: () => {
      const n = node('destination');
      created.push(n);
      return { ...n, stream: fakeStream(false, 1) };
    },
    createMediaStreamSource: () => {
      const n = node('source');
      created.push(n);
      return n;
    },
    createAnalyser: () => {
      const n = node('analyser');
      created.push(n);
      return n;
    },
    createGain: () => {
      const n = node('gain');
      created.push(n);
      return n;
    },
  };
}

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

describe('shareScreen capture quality', () => {
  it('forwards the capture constraints to getDisplayMedia', async () => {
    await shareScreen(false, mic(), { width: 1280, frameRate: 30 });

    const [constraints] = getDisplayMedia.mock.calls[0];
    expect(constraints.video.width).toEqual({ ideal: 1280 });
    expect(constraints.video.frameRate).toEqual({ ideal: 30 });
  });

  it('never sends a height, so the source keeps its aspect ratio', async () => {
    await shareScreen(false, mic(), { width: 1920 });
    const [constraints] = getDisplayMedia.mock.calls[0];
    expect(constraints.video).not.toHaveProperty('height');
  });

  it('sends only the cursor when quality is left on Auto', async () => {
    await shareScreen(false, mic());
    const [constraints] = getDisplayMedia.mock.calls[0];
    expect(constraints.video).toEqual({ cursor: 'always' });
  });

  it('defaults the capture constraints to empty when omitted', async () => {
    // Existing callers keep working unchanged.
    await shareScreen(false, mic());
    expect(getDisplayMedia).toHaveBeenCalled();
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

describe('shareScreen gain graph', () => {
  it('gives each source its own gain', async () => {
    // Both a system track and a microphone, so both paths are built. The
    // navigator stub captured the mocks in beforeEach, so they are retargeted
    // through mockResolvedValue rather than reassigned.
    getDisplayMedia.mockResolvedValue(fakeStream(true, 1));
    getUserMedia.mockResolvedValue(fakeStream(false, 1));
    const ctx = makeAudioContext();
    vi.stubGlobal('AudioContext', function () {
      return ctx;
    });

    const result = await shareScreen(true, mic({ enabled: true }));

    expect(result.gains.system).toBeDefined();
    expect(result.gains.mic).toBeDefined();
  });

  it('leaves the gains undefined when there is no audio at all', async () => {
    const ctx = makeAudioContext();
    vi.stubGlobal('AudioContext', function () {
      return ctx;
    });

    const result = await shareScreen(false, mic());

    expect(result.gains).toEqual({});
    expect(result.audioContext).toBeUndefined();
  });

  it('meters the raw input but puts the gain only on the recorded path', async () => {
    getDisplayMedia.mockResolvedValue(fakeStream(true, 1));
    getUserMedia.mockResolvedValue(fakeStream(false, 1));
    const ctx = makeAudioContext();
    vi.stubGlobal('AudioContext', function () {
      return ctx;
    });

    await shareScreen(true, mic({ enabled: true }));

    // A fader pulled to zero must not blank the level meter, so the analyser
    // taps the source directly and only the gain feeds the destination.
    for (const source of ctx.created.filter((n) => n.kind === 'source')) {
      expect(source.connections.sort()).toEqual(['analyser', 'gain']);
    }
    for (const gain of ctx.created.filter((n) => n.kind === 'gain')) {
      expect(gain.connections).toEqual(['destination']);
    }
    for (const analyser of ctx.created.filter((n) => n.kind === 'analyser')) {
      expect(analyser.connections).toEqual([]);
    }
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
