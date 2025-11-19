import { RecordingFormat } from './types';

export class Recorder {
    private mediaRecorder: MediaRecorder | null = null;
    private recordedChunks: Blob[] = [];

    constructor(private onStopCallback: (blob: Blob, ext: string) => void) { }

    start(stream: MediaStream, format: RecordingFormat) {
        this.recordedChunks = [];
        try {
            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType: format.mimeType,
            });
        } catch (err) {
            console.error("Failed to create MediaRecorder:", err);
            throw new Error(`Failed to start recording. Unsupported format: ${format.mimeType}`);
        }

        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) this.recordedChunks.push(event.data);
        };

        this.mediaRecorder.onstop = () => {
            const mimeTypeBlob = format.mimeType.split(";")[0];
            const blob = new Blob(this.recordedChunks, { type: mimeTypeBlob });
            this.onStopCallback(blob, format.ext);
        };

        this.mediaRecorder.start();
    }

    stop() {
        if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
            this.mediaRecorder.stop();
        }
    }

    isRecording(): boolean {
        return this.mediaRecorder?.state === "recording";
    }
}
