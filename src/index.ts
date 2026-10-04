import { ShareResult, shareScreen } from './screen-share';
import { Recorder } from './recorder';
import { Cropper } from './cropper';
import { FORMATS_TO_CHECK } from './constants';
import { timestampFilename } from './filename';
import { bindShortcuts } from './shortcuts';
import { captureFrame, downloadBlob } from './screenshot';
import { Stopwatch } from './stopwatch';
import { fixWebmDuration } from './webm-duration';
import { UIManager } from './ui-manager';

const ui = new UIManager();
const stopwatch = new Stopwatch();
const cropper = new Cropper(
  ui.cropBox,
  ui.cropTargetElement,
  ui.videoContainer,
  ui.videoPreview
);
const recorder = new Recorder(onRecordingStop);

let stream: MediaStream | null = null;
let audioContext: AudioContext | null | undefined = null;
let analysers: ShareResult['analysers'] | null = null;
let visualizationAnimationFrame: number | null = null;

// --- Initialization ---
// Keep the preview matched to the shared surface as it changes shape.
ui.videoPreview.addEventListener('resize', syncPreviewAspect);

window.addEventListener('load', () => {
  ui.populateFormats(FORMATS_TO_CHECK);
  if (!window.MediaRecorder) {
    ui.showError(
      'Your browser does not support the MediaRecorder API. Please try a different browser like Chrome or Firefox.'
    );
    ui.disableShareBtn();
  }
});

// --- Event Listeners ---
ui.bindEvents({
  onShare: () => {
    if (stream) stopSharing();
    else handleShareScreen();
  },
  onRecord: startRecording,
  onStop: stopRecording,
  onCropToggle: toggleCropping,
  onPause: togglePause,
});

// R / P / S / Shift+S drive the same actions as the buttons.
bindShortcuts({
  onRecord: () => {
    if (!recorder.isActive()) startRecording();
  },
  onPause: togglePause,
  onStop: () => {
    if (recorder.isActive()) stopRecording();
  },
  onScreenshot: captureScreenshot,
});

/**
 * Save the preview's current frame as a PNG. Silent when there is nothing to
 * capture - a shortcut should never throw up an error banner mid-take.
 */
async function captureScreenshot() {
  const blob = await captureFrame(ui.videoPreview);
  if (!blob) return;
  downloadBlob(blob, timestampFilename('png'));
}

/**
 * Pause/resume the in-flight capture. The stopwatch is paused alongside the
 * recorder so the timer keeps reporting the time actually captured.
 */
function togglePause() {
  if (!recorder.isActive()) return;

  if (recorder.isPaused()) {
    recorder.resume();
    stopwatch.resume();
    ui.setPausedState(false);
  } else {
    recorder.pause();
    stopwatch.pause();
    ui.setPausedState(true);
  }
}

// --- Functions ---

async function handleShareScreen() {
  ui.hideError();

  try {
    const audioConfig = ui.getAudioConfig();
    const shareResult = await shareScreen(
      audioConfig.systemAudio,
      audioConfig.micAudio
    );

    stream = shareResult.stream;
    analysers = shareResult.analysers;
    audioContext = shareResult.audioContext;

    ui.videoPreview.srcObject = stream;
    await ui.videoPreview.play();

    ui.setSharingState(true);

    const [videoTrack] = stream.getVideoTracks();
    syncPreviewAspect();
    videoTrack.addEventListener('ended', stopSharing);

    visualizeAudio();
  } catch (err: unknown) {
    console.error('Error sharing screen:', err);
    let errorMsg =
      'Could not start screen sharing. Please grant permission and try again.';
    const error = err as Error;
    if (error.name === 'NotAllowedError')
      errorMsg =
        'Screen sharing permission was denied. Please allow permission and try again.';
    else if (error.name === 'NotFoundError')
      errorMsg =
        'No screen sharing sources found. This can happen if your browser is misconfigured.';
    else if (error.name === 'InvalidStateError')
      errorMsg = 'An invalid state occurred. Please reload the page.';

    ui.showError(errorMsg);
    stopSharing();
  }
}

/**
 * Size the preview container to the shared screen's real aspect ratio.
 *
 * This reads the <video> element's own decoded frame size rather than
 * MediaTrack.getSettings(), because the two can disagree: the element is what
 * `object-contain` actually fits, so matching it is what keeps the preview
 * letterbox-free. It is kept in sync from the element's `resize` event, which
 * fires whenever the shared surface changes shape (e.g. the recorded window is
 * resized).
 *
 * The markup defaults to `aspect-video` (16:9) purely as an empty-state
 * placeholder.
 */
function syncPreviewAspect() {
  const w = ui.videoPreview.videoWidth;
  const h = ui.videoPreview.videoHeight;
  if (w && h) ui.setPreviewAspect(w, h);
}

async function startRecording() {
  if (!stream) {
    ui.showError('Please share your screen first.');
    return;
  }
  ui.hideError();

  const format = ui.getFormat();
  let streamToRecord = stream;

  if (ui.cropCheckbox.checked) {
    streamToRecord = await cropper.startCrop(stream);
  }

  try {
    recorder.start(streamToRecord, format);
  } catch (err: unknown) {
    ui.showError((err as Error).message);
    stopSharing();
    return;
  }

  ui.setRecordingState(true);
  stopwatch.start((time) => ui.updateStopwatch(time));
}

async function onRecordingStop(blob: Blob, ext: string) {
  // Read the duration before the stopwatch is reset - MediaRecorder's WebM
  // output has no Duration element, so players otherwise report Infinity.
  const durationMs = stopwatch.elapsed();
  stopwatch.stop();

  const fixedBlob = await fixWebmDuration(blob, durationMs);

  const filename = timestampFilename(ext);
  const url = URL.createObjectURL(fixedBlob);

  ui.setDownloadLink(url, filename);
  ui.setRecordingState(false);
}

async function stopRecording() {
  await cropper.stopCrop(stream);
  if (recorder.isActive()) {
    recorder.stop();
  }
}

async function stopSharing() {
  await cropper.stopCrop(stream);
  if (recorder.isActive()) {
    recorder.stop();
  }

  if (visualizationAnimationFrame) {
    cancelAnimationFrame(visualizationAnimationFrame);
    visualizationAnimationFrame = null;
  }

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  analysers = null;

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  ui.setSharingState(false);
  cropper.hide();
}

function visualizeAudio() {
  if (!analysers) return;

  const bufferLength = 256;
  const dataArray = new Uint8Array(bufferLength);

  if (analysers.system) {
    analysers.system.getByteFrequencyData(dataArray);
    const average = dataArray.reduce((src, a) => src + a, 0) / bufferLength;
    ui.updateAudioLevel('system', average / 128); // Normalize somewhat
  } else {
    ui.updateAudioLevel('system', 0);
  }

  if (analysers.mic) {
    analysers.mic.getByteFrequencyData(dataArray);
    const average = dataArray.reduce((src, a) => src + a, 0) / bufferLength;
    ui.updateAudioLevel('mic', average / 128);
  } else {
    ui.updateAudioLevel('mic', 0);
  }

  visualizationAnimationFrame = requestAnimationFrame(visualizeAudio);
}

function toggleCropping() {
  if (ui.cropCheckbox.checked) {
    ui.toggleCropping(true);
    cropper.show();
  } else {
    ui.toggleCropping(false);
    cropper.hide();
  }
}
