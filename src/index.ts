import { ShareResult, shareScreen } from './screen-share';
import { Recorder } from './recorder';
import { Cropper } from './cropper';
import { FORMATS_TO_CHECK } from './constants';
import { timestampFilename } from './filename';
import { formatBytes, formatDuration } from './format';
import { bindShortcuts } from './shortcuts';
import { captureFrame } from './screenshot';
import { CountdownHandle, runCountdown } from './countdown';
import { PictureInPicture } from './pip';
import { Stopwatch } from './stopwatch';
import { fixWebmDuration } from './webm-duration';
import { UIManager } from './ui-manager';
import { SettingsPanel } from './settings-panel';
import { Take, TakeStore } from './takes';
import { TakeCache } from './take-cache';
import { GalleryView } from './gallery-view';
import { downscaleImage, extractVideoThumbnail } from './thumbnail';
import { registerServiceWorker } from './pwa';

const ui = new UIManager();
const settings = new SettingsPanel();
// Takes are cached so a refresh does not lose them; the store writes through
// to IndexedDB on every add/remove/clear and restores on load.
const takes = new TakeStore(new TakeCache());
// The gallery mounts on an explicit id, not a tag name. It used to use
// `document.querySelector('main')`, which meant a layout rewrite that dropped
// the <main> element killed the whole boot silently - the page rendered and
// looked correct while nothing was wired. GalleryView.require() reports a
// missing element, but only if it gets as far as being constructed.
const galleryRoot = document.getElementById('takesRoot');
if (!galleryRoot) throw new Error('Gallery markup is missing #takesRoot');
const gallery = new GalleryView(galleryRoot, takes);
const stopwatch = new Stopwatch();
const cropper = new Cropper(
  ui.cropBox,
  ui.cropTargetElement,
  ui.videoContainer,
  ui.videoPreview
);
const recorder = new Recorder(onRecordingStop);
const pip = new PictureInPicture(
  document.getElementById('videoPreview') as HTMLVideoElement,
  {
    // The floating window has its own close button, entirely outside this page,
    // so state has to follow the browser rather than what enter() returned.
    onChange: (active) => ui.setPipState(active),
  }
);

let stream: MediaStream | null = null;
let audioContext: AudioContext | null | undefined = null;
let analysers: ShareResult['analysers'] | null = null;
let visualizationAnimationFrame: number | null = null;

/**
 * Per-source gains from the current capture, so the faders can drive them.
 * They are replaced wholesale when a new share starts, since a new capture
 * builds a fresh audio graph.
 */
let currentGains: { system?: GainNode; mic?: GainNode } = {};

/**
 * The countdown in flight, if any. Kept at module level so the button and the
 * Escape key can both reach it and so a new capture cannot start underneath
 * one that is still counting.
 */
let activeCountdown: CountdownHandle | null = null;

function applyVolume(source: 'system' | 'mic') {
  const gain = source === 'system' ? currentGains.system : currentGains.mic;
  if (!gain) return;
  gain.gain.value = settings.getVolume(source);
}

// Faders stay live while recording; balancing the two inputs is exactly the
// sort of thing you discover you need mid-take.
settings.bindVolumeControls(applyVolume);

// --- Initialization ---
// Keep the preview matched to the shared surface as it changes shape.
ui.videoPreview.addEventListener('resize', syncPreviewAspect);

window.addEventListener('load', () => {
  gallery.bind();
  // Takes made before a refresh come back from the cache. Fire and forget:
  // the gallery re-renders when the restore lands, and a capture made in the
  // meantime is merged in rather than racing it.
  void takes.restore().then(backfillThumbnails);
  ui.setPipSupported(pip.isSupported());
  settings.populateQuality();

  if (!window.MediaRecorder) {
    ui.showError(
      'Your browser does not support the MediaRecorder API. Please try a different browser like Chrome or Firefox.'
    );
    ui.disableShareBtn();
    return;
  }

  if (!settings.populateFormats(FORMATS_TO_CHECK)) {
    ui.showError('No supported recording formats found in this browser.');
    ui.disableShareBtn();
  }
});

// --- Event Listeners ---
ui.bindEvents({
  onShare: () => {
    if (stream) stopSharing();
    else handleShareScreen();
  },
  onRecord: toggleRecord,
  onStop: stopRecording,
  onCropToggle: toggleCropping,
  onPause: togglePause,
  onScreenshot: captureScreenshot,
  onPip: () => {
    void pip.toggle();
  },
});

// R / P / S / Shift+S drive the same actions as the buttons.
bindShortcuts({
  onRecord: toggleRecord,
  onPause: togglePause,
  onStop: () => {
    if (recorder.isActive()) stopRecording();
  },
  onScreenshot: captureScreenshot,
  onCancel: cancelCountdown,
});

/*
 * Offline support and installability.
 *
 * An update is surfaced, never applied. `apply` is only called when the user
 * clicks Refresh, and even then the page reloads once the new worker has
 * actually taken control - see pwa.ts. Takes are in-memory blob URLs, so
 * reloading on our own would destroy whatever they had not downloaded yet.
 */
const updateBanner = document.getElementById('updateBanner');
const updateReloadBtn = document.getElementById('updateReloadBtn');
const updateDismissBtn = document.getElementById('updateDismissBtn');
let applyPendingUpdate: (() => void) | null = null;

void registerServiceWorker({
  onUpdate: (apply) => {
    applyPendingUpdate = apply;
    if (updateBanner) updateBanner.hidden = false;
  },
});

updateReloadBtn?.addEventListener('click', () => applyPendingUpdate?.());
updateDismissBtn?.addEventListener('click', () => {
  if (updateBanner) updateBanner.hidden = true;
  // "Later" means later, not "never": the apply function stays so the update
  // can still be taken. Clearing it here silently retired the update - the
  // banner came back on the next deploy but Refresh would then do nothing.
  // It was cleared while the comment above it promised the opposite.
});

/**
 * The Record button does two jobs: it starts a take, and it aborts a countdown
 * that is already running. Having one control that reverses itself keeps there
 * from being a second button that only exists for a few seconds.
 */
function toggleRecord() {
  if (activeCountdown) {
    cancelCountdown();
    return;
  }
  if (recorder.isActive()) return;
  startRecording();
}

function cancelCountdown() {
  activeCountdown?.cancel();
}

/**
 * Capture the preview's current frame as a PNG and file it as a take.
 *
 * Silent when there is nothing to capture - a shortcut should never throw up
 * an error banner mid-take - but when it does land it goes to the gallery like
 * a recording, so a screenshot cannot be lost by taking the next one.
 */
async function captureScreenshot() {
  const blob = await captureFrame(ui.videoPreview);
  if (!blob) return;

  const take = takes.add({
    kind: 'screenshot',
    blob,
    filename: timestampFilename('png'),
    formatName: 'PNG',
  });
  // A screenshot is already an image, so its thumbnail is just a shrunk copy.
  void attachThumbnail(take, () => downscaleImage(blob));
}

/**
 * Make a take's thumbnail and attach it, best-effort. Fired from the capture
 * paths without awaiting: decoding must never delay the stop feedback. `make`
 * is a function so the store can have moved on by the time it resolves -
 * setThumbnail() is then a no-op rather than an error.
 */
function attachThumbnail(
  take: Take,
  make: () => Promise<Blob | null>
): Promise<void> {
  return make().then((thumbnail) => {
    if (thumbnail) takes.setThumbnail(take.id, thumbnail);
  });
}

/**
 * Give restored takes that never got a thumbnail one.
 *
 * Rows cached before this feature existed have none, and one may have failed
 * mid-decode on a previous run. Two workers: a dozen simultaneous video
 * decodes at startup is a jank source, and there is no user-visible rush -
 * rows show their glyph until each picture lands.
 */
function backfillThumbnails(): void {
  const queue = takes.list().filter((take) => !take.thumbnail);

  const worker = async (): Promise<void> => {
    for (let take = queue.shift(); take; take = queue.shift()) {
      await attachThumbnail(take, () => makeThumbnail(take));
    }
  };
  void Promise.all([worker(), worker()]);
}

/** The thumbnail generator that fits a take's kind. */
function makeThumbnail(take: Take): Promise<Blob | null> {
  return take.kind === 'recording'
    ? extractVideoThumbnail(take.blob, take.durationMs)
    : downscaleImage(take.blob);
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
    const audioConfig = settings.getAudioConfig();
    // Capture constraints can only take effect here, so the settings are read
    // at share time rather than at record time.
    const shareResult = await shareScreen(
      audioConfig.systemAudio,
      settings.getMicOptions(),
      settings.getQuality()
    );
    currentGains = shareResult.gains;
    applyVolume('system');
    applyVolume('mic');

    stream = shareResult.stream;
    analysers = shareResult.analysers;
    audioContext = shareResult.audioContext;
    // The picker can hand back a silent share; the chip must not pretend to
    // control audio the capture does not carry.
    settings.setSystemAudioAvailable(shareResult.hasSystemAudio);

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

/**
 * Begin a take: count down first if one is configured, then capture.
 *
 * The countdown runs before any capture setup so nothing is recorded during
 * it - the stopwatch in particular must not start until the take actually
 * does, or the reported length would include the countdown.
 */
function startRecording() {
  if (!stream) {
    ui.showError('Please share your screen first.');
    return;
  }
  ui.hideError();

  const seconds = settings.getCountdownSeconds();
  if (seconds <= 0) {
    startCapture();
    return;
  }

  ui.setCountdownState(true);
  activeCountdown = runCountdown({
    seconds,
    onTick: (remaining) => ui.showCountdown(remaining),
    onDone: () => {
      activeCountdown = null;
      ui.setCountdownState(false);
      ui.hideCountdown();
      startCapture();
    },
    onCancel: () => {
      activeCountdown = null;
      ui.setCountdownState(false);
      ui.hideCountdown();
    },
  });
}

/** Start capturing now. Called once the countdown has finished, or at once. */
async function startCapture() {
  // Re-checked rather than trusted from startRecording: sharing can be stopped
  // while the countdown runs, and starting a capture on a dead stream would
  // fail somewhere far less obvious than here.
  if (!stream) return;

  const format = settings.getFormat();
  let streamToRecord = stream;

  if (ui.cropCheckbox.checked) {
    streamToRecord = await cropper.startCrop(stream);
  }

  try {
    // Re-read the encoder settings here: unlike the capture constraints these
    // can change between takes, so the current selection is what applies.
    const quality = settings.getQuality();
    recorder.start(streamToRecord, format, {
      videoBitsPerSecond: quality.videoBitsPerSecond,
    });
  } catch (err: unknown) {
    ui.showError((err as Error).message);
    stopSharing();
    return;
  }

  ui.setRecordingState(true);
  ui.clearStats();
  stopwatch.start((time) => {
    ui.updateStopwatch(time);
    // Length and size are refreshed together so the readout never shows one
    // figure from a moment the other does not correspond to.
    ui.updateStats(
      formatDuration(stopwatch.elapsed()),
      formatBytes(recorder.bytesCaptured())
    );
  });
}

async function onRecordingStop(blob: Blob, ext: string) {
  // Read the duration before the stopwatch is reset - MediaRecorder's WebM
  // output has no Duration element, so players otherwise report Infinity.
  const durationMs = stopwatch.elapsed();
  stopwatch.stop();

  const fixedBlob = await fixWebmDuration(blob, durationMs);

  // The take is added to the gallery rather than written to a single download
  // link, so making the next one cannot lose this one.
  const take = takes.add({
    kind: 'recording',
    blob: fixedBlob,
    filename: timestampFilename(ext),
    formatName: settings.getFormat().name,
    durationMs,
  });
  // A frame from the clip becomes its gallery thumbnail. Off the stop path:
  // the seek + decode takes real time and the feedback must not wait for it.
  void attachThumbnail(take, () =>
    extractVideoThumbnail(fixedBlob, durationMs)
  );

  ui.setRecordingState(false);
}

async function stopRecording() {
  await cropper.stopCrop(stream);
  if (recorder.isActive()) {
    recorder.stop();
  }
}

async function stopSharing() {
  cancelCountdown();
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
  settings.setSystemAudioAvailable(true);
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
