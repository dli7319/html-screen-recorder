import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Recorder } from './recorder';
import { RecordingFormat } from './types';

/**
 * jsdom has no MediaRecorder. This stands in for it, tracking the state machine
 * the real one exposes ('inactive' | 'recording' | 'paused').
 */
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  state = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(
    public stream: MediaStream,
    public options: { mimeType: string }
  ) {
    FakeMediaRecorder.instances.push(this);
    if (FakeMediaRecorder.failOnCreate) {
      throw new Error('not supported');
    }
  }

  static failOnCreate = false;

  timeslice: number | undefined;

  start(timeslice?: number) {
    this.timeslice = timeslice;
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.onstop?.();
  }
  pause() {
    this.state = 'paused';
  }
  resume() {
    this.state = 'recording';
  }

  emit(data: Blob) {
    this.ondataavailable?.({ data });
  }
}

const FORMAT: RecordingFormat = {
  name: 'VP9 (WebM)',
  mimeType: 'video/webm; codecs=vp9',
  ext: 'webm',
};

let stream: MediaStream;
let recorder: Recorder;
let onStop: ReturnType<typeof vi.fn>;

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.failOnCreate = false;
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  stream = {
    getVideoTracks: () => [],
    getAudioTracks: () => [],
  } as unknown as MediaStream;
  onStop = vi.fn();
  recorder = new Recorder(
    onStop as unknown as (blob: Blob, ext: string) => void
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Recorder.start', () => {
  it('starts capturing with the chosen format', () => {
    recorder.start(stream, FORMAT);

    expect(FakeMediaRecorder.instances).toHaveLength(1);
    expect(FakeMediaRecorder.instances[0].options.mimeType).toBe(
      FORMAT.mimeType
    );
    expect(recorder.isRecording()).toBe(true);
    expect(recorder.isActive()).toBe(true);
    expect(recorder.isPaused()).toBe(false);
  });

  it('reports a friendly error when the format is unsupported', () => {
    FakeMediaRecorder.failOnCreate = true;

    expect(() => recorder.start(stream, FORMAT)).toThrowError(
      /Unsupported format: video\/webm; codecs=vp9/
    );
    expect(recorder.isActive()).toBe(false);
  });

  it('discards chunks from a previous recording', () => {
    recorder.start(stream, FORMAT);
    FakeMediaRecorder.instances[0].emit(new Blob(['old-chunk']));
    recorder.stop();

    recorder.start(stream, FORMAT);
    FakeMediaRecorder.instances[1].emit(new Blob(['only-this']));
    recorder.stop();

    const [blob] = onStop.mock.calls[1];
    expect(blob.size).toBe('only-this'.length);
  });

  it('drops empty chunks rather than padding the output', () => {
    recorder.start(stream, FORMAT);
    const mr = FakeMediaRecorder.instances[0];
    mr.emit(new Blob([]));
    mr.emit(new Blob(['real']));
    mr.emit(new Blob([]));
    recorder.stop();

    const [blob] = onStop.mock.calls[0];
    expect(blob.size).toBe('real'.length);
  });

  it('merges every chunk into one blob and reports the container type', () => {
    recorder.start(stream, FORMAT);
    const mr = FakeMediaRecorder.instances[0];
    mr.emit(new Blob(['aa']));
    mr.emit(new Blob(['bb']));
    recorder.stop();

    const [blob, ext] = onStop.mock.calls[0];
    expect(blob.size).toBe(4);
    expect(blob.type).toBe('video/webm');
    expect(ext).toBe('webm');
  });

  it('strips the codec parameters when deriving the blob type', () => {
    recorder.start(stream, {
      name: 'AV1',
      mimeType: 'video/mp4; codecs=av01.0.05M.08,opus',
      ext: 'mp4',
    });
    recorder.stop();

    const [blob, ext] = onStop.mock.calls[0];
    expect(blob.type).toBe('video/mp4');
    expect(ext).toBe('mp4');
  });
});

describe('Recorder progress', () => {
  it('asks MediaRecorder for a chunk periodically, so progress is observable', () => {
    // Without a timeslice ondataavailable fires only at stop, and the live byte
    // count would stay at zero for the whole take.
    recorder.start(stream, FORMAT);
    expect(FakeMediaRecorder.instances[0].timeslice).toBeGreaterThan(0);
  });

  it('reports bytes handed back so far', () => {
    recorder.start(stream, FORMAT);
    const mr = FakeMediaRecorder.instances[0];

    expect(recorder.bytesCaptured()).toBe(0);
    mr.emit(new Blob(['abc']));
    expect(recorder.bytesCaptured()).toBe(3);
    mr.emit(new Blob(['de']));
    expect(recorder.bytesCaptured()).toBe(5);
  });

  it('ignores empty chunks when counting', () => {
    recorder.start(stream, FORMAT);
    const mr = FakeMediaRecorder.instances[0];
    mr.emit(new Blob([]));
    mr.emit(new Blob(['four']));

    expect(recorder.bytesCaptured()).toBe(4);
  });

  it('starts a new take from zero bytes', () => {
    recorder.start(stream, FORMAT);
    FakeMediaRecorder.instances[0].emit(new Blob(['old']));
    recorder.stop();

    recorder.start(stream, FORMAT);
    expect(recorder.bytesCaptured()).toBe(0);
  });
});

describe('Recorder pause and resume', () => {
  it('pauses an active capture', () => {
    recorder.start(stream, FORMAT);
    recorder.pause();

    expect(recorder.isPaused()).toBe(true);
    expect(recorder.isRecording()).toBe(false);
    expect(recorder.isActive()).toBe(true);
  });

  it('resumes a paused capture', () => {
    recorder.start(stream, FORMAT);
    recorder.pause();
    recorder.resume();

    expect(recorder.isPaused()).toBe(false);
    expect(recorder.isRecording()).toBe(true);
    expect(recorder.isActive()).toBe(true);
  });

  it('ignores pause and resume when nothing is capturing', () => {
    expect(() => {
      recorder.pause();
      recorder.resume();
    }).not.toThrow();
    expect(recorder.isActive()).toBe(false);
  });

  it('ignores pause when already paused and resume while recording', () => {
    recorder.start(stream, FORMAT);
    recorder.pause();
    recorder.pause();
    expect(recorder.isPaused()).toBe(true);

    recorder.resume();
    recorder.resume();
    expect(recorder.isRecording()).toBe(true);
  });

  it('keeps collecting chunks across a pause', () => {
    recorder.start(stream, FORMAT);
    const mr = FakeMediaRecorder.instances[0];
    mr.emit(new Blob(['before']));
    recorder.pause();
    mr.emit(new Blob(['during']));
    recorder.resume();
    mr.emit(new Blob(['after']));
    recorder.stop();

    const [blob] = onStop.mock.calls[0];
    expect(blob.size).toBe('before'.length + 'during'.length + 'after'.length);
  });
});

describe('Recorder.stop', () => {
  it('stops an active capture', () => {
    recorder.start(stream, FORMAT);
    recorder.stop();

    expect(recorder.isActive()).toBe(false);
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('stops a PAUSED capture - stop() used to silently no-op here', () => {
    recorder.start(stream, FORMAT);
    recorder.pause();
    recorder.stop();

    expect(recorder.isActive()).toBe(false);
    expect(onStop).toHaveBeenCalledOnce();
    expect(FakeMediaRecorder.instances[0].state).toBe('inactive');
  });

  it('does nothing when nothing is capturing', () => {
    recorder.stop();
    expect(onStop).not.toHaveBeenCalled();
  });

  it('fires onStop only once even if called repeatedly', () => {
    recorder.start(stream, FORMAT);
    recorder.stop();
    recorder.stop();

    expect(onStop).toHaveBeenCalledOnce();
  });
});
