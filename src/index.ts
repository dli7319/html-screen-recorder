import { shareScreen } from './screen-share';
import { Recorder } from './recorder';
import { Cropper } from './cropper';
import { FORMATS_TO_CHECK } from './constants';
import { Stopwatch } from './stopwatch';
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

// --- Initialization ---
window.addEventListener('load', () => {
  ui.populateFormats(FORMATS_TO_CHECK);
  if (!window.MediaRecorder) {
    ui.showError(
      'Your browser does not support the MediaRecorder API. Please try a different browser like Chrome or Firefox.'
    );
    ui.shareBtn.disabled = true;
  }
});

// --- Event Listeners ---
ui.shareBtn.addEventListener('click', () => {
  if (stream) stopSharing();
  else handleShareScreen();
});
ui.recordBtn.addEventListener('click', startRecording);
ui.stopBtn.addEventListener('click', stopRecording);
ui.cropCheckbox.addEventListener('change', toggleCropping);

// --- Functions ---

async function handleShareScreen() {
  ui.hideError();

  try {
    const audioConfig = ui.getAudioConfig();
    stream = await shareScreen(audioConfig.systemAudio, audioConfig.micAudio);

    ui.videoPreview.srcObject = stream;
    await ui.videoPreview.play();

    ui.setSharingState(true);

    stream.getVideoTracks()[0].addEventListener('ended', stopSharing);
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

function onRecordingStop(blob: Blob, ext: string) {
  const now = new Date();
  const timestamp = now
    .toISOString()
    .replace(/[-:T.]/g, '')
    .slice(0, 14);
  const filename = `${timestamp}.${ext}`;
  const url = URL.createObjectURL(blob);

  ui.setDownloadLink(url, filename);
  ui.setRecordingState(false);
  stopwatch.stop();
}

async function stopRecording() {
  await cropper.stopCrop(stream);
  if (recorder.isRecording()) {
    recorder.stop();
  }
}

async function stopSharing() {
  await cropper.stopCrop(stream);
  if (recorder.isRecording()) {
    recorder.stop();
  }

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  ui.setSharingState(false);
  cropper.hide();
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
