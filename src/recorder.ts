import { RecordingFormat } from './types';
import { EncoderConfig, buildRecorderOptions } from './quality';

/**
 * How often MediaRecorder hands back a chunk.
 *
 * Without a timeslice `ondataavailable` fires exactly once, at stop - fine for
 * assembling the file, useless for showing progress. Asking for a chunk every
 * second keeps the live byte count honest. Both containers are built for this:
 * WebM emits complete clusters per chunk and MP4 is fragmented, so
 * concatenating the chunks is exactly what the single-chunk path already did.
 */
const TIMESLICE_MS = 1000;

export class Recorder {
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];

  constructor(private onStopCallback: (blob: Blob, ext: string) => void) {}

  start(
    stream: MediaStream,
    format: RecordingFormat,
    encoder: EncoderConfig = {}
  ) {
    this.recordedChunks = [];
    try {
      // Bitrate is an encoder setting, not a track setting: it can change
      // between takes without the user re-picking a window.
      this.mediaRecorder = new MediaRecorder(
        stream,
        buildRecorderOptions(format, encoder)
      );
    } catch (err) {
      console.error('Failed to create MediaRecorder:', err);
      throw new Error(
        `Failed to start recording. Unsupported format: ${format.mimeType}`
      );
    }

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.recordedChunks.push(event.data);
    };

    this.mediaRecorder.onstop = () => {
      const mimeTypeBlob = format.mimeType.split(';')[0];
      const blob = new Blob(this.recordedChunks, { type: mimeTypeBlob });
      this.onStopCallback(blob, format.ext);
    };

    this.mediaRecorder.start(TIMESLICE_MS);
  }

  /**
   * Bytes handed back so far. The total is an interim figure while recording
   * and exact once the capture has stopped.
   */
  bytesCaptured(): number {
    return this.recordedChunks.reduce((total, chunk) => total + chunk.size, 0);
  }

  stop() {
    // Guard on "not inactive" rather than "recording": MediaRecorder moves to a
    // distinct 'paused' state while paused, and stop() has to work from there.
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
  }

  pause() {
    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.pause();
    }
  }

  resume() {
    if (this.mediaRecorder?.state === 'paused') {
      this.mediaRecorder.resume();
    }
  }

  isRecording(): boolean {
    return this.mediaRecorder?.state === 'recording';
  }

  isPaused(): boolean {
    return this.mediaRecorder?.state === 'paused';
  }

  /** True while a capture is in flight, including while it is paused. */
  isActive(): boolean {
    return this.isRecording() || this.isPaused();
  }
}
