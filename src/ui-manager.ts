import { trapFocus } from './focus-trap';

/**
 * The transport and status surface: the preview, the share/record/stop/pause
 * controls, and the status row.
 *
 * Capture *settings* live in SettingsPanel, and produced output lives in
 * GalleryView. What remains here is the state the user is in - idle, sharing,
 * recording, paused - and the controls that move between those states.
 */
export class UIManager {
  public videoPreview = document.getElementById(
    'videoPreview'
  ) as HTMLVideoElement;
  public videoContainer = document.getElementById(
    'videoContainer'
  ) as HTMLDivElement;
  public cropBox = document.getElementById('cropBox') as HTMLDivElement;
  public cropTargetElement = document.getElementById(
    'cropTargetElement'
  ) as HTMLDivElement;

  private shareBtn = document.getElementById('shareBtn') as HTMLButtonElement;
  /**
   * The Share action inside the empty preview state. It calls the same handler
   * as {@link shareBtn} rather than synthesising a click on it, so the two can
   * never drift apart.
   */
  private emptyShareBtn = document.getElementById(
    'emptyShareBtn'
  ) as HTMLButtonElement;
  private shareBtnStart = document.getElementById(
    'shareBtnStart'
  ) as HTMLSpanElement;
  private shareBtnStop = document.getElementById(
    'shareBtnStop'
  ) as HTMLSpanElement;
  private recordBtn = document.getElementById('recordBtn') as HTMLButtonElement;
  private recordBtnText = document.getElementById(
    'recordBtnText'
  ) as HTMLSpanElement;
  private stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
  private screenshotBtn = document.getElementById(
    'screenshotBtn'
  ) as HTMLButtonElement;
  private placeholder = document.getElementById(
    'placeholder'
  ) as HTMLDivElement;
  private statusDiv = document.getElementById('status') as HTMLDivElement;
  private statusText = document.getElementById('statusText') as HTMLSpanElement;
  private statusDot = document.getElementById('statusDot') as HTMLDivElement;
  private pauseBtn = document.getElementById('pauseBtn') as HTMLButtonElement;
  private pauseBtnText = document.getElementById(
    'pauseBtnText'
  ) as HTMLSpanElement;
  private pauseBtnIcon = document.getElementById(
    'pauseBtnIcon'
  ) as Element | null;
  private statsText = document.getElementById('statsText') as HTMLSpanElement;
  private countdownOverlay = document.getElementById(
    'countdownOverlay'
  ) as HTMLDivElement;
  private countdownNumber = document.getElementById(
    'countdownNumber'
  ) as HTMLSpanElement;
  private pipBtn = document.getElementById('pipBtn') as HTMLButtonElement;
  private pipBtnText = document.getElementById('pipBtnText') as HTMLSpanElement;
  private errorDiv = document.getElementById('error') as HTMLDivElement;
  public cropCheckbox = document.getElementById(
    'cropCheckbox'
  ) as HTMLInputElement;
  private cropContainer = document.getElementById(
    'cropContainer'
  ) as HTMLDivElement;
  private systemAudioVisualizer = document.getElementById(
    'systemAudioVisualizer'
  ) as HTMLDivElement;
  private micAudioVisualizer = document.getElementById(
    'micAudioVisualizer'
  ) as HTMLDivElement;
  private transport = document.getElementById('transport') as HTMLDivElement;

  /**
   * Drive the presentation state.
   *
   * `data-phase` on the transport container decides which of the four buttons
   * is currently the obvious next step, and `data-state` on the status pill
   * decides its colour. Neither touches the buttons' ids, their listeners or
   * their enabled flags - those are the state machine, and this is only how it
   * looks. Keeping the two apart is what let the UI go from four equally loud
   * buttons to one without destabilising the recording logic underneath.
   */
  private setPhase(phase: 'idle' | 'sharing' | 'recording') {
    this.transport.dataset.phase = phase;
    this.statusDiv.dataset.state = phase;
    // The pill is always visible now: it answers "what is the app doing" even
    // when nothing is happening, which is exactly when that is unclear.
    this.statusDiv.classList.remove('hidden');
    if (phase === 'idle') this.statusText.textContent = 'Ready';
    if (phase === 'sharing') this.statusText.textContent = 'Sharing';
    if (phase === 'recording') this.statusText.textContent = 'Recording';
  }

  // Live tab-title reflection (see syncTabTitle). Tracked separately from the
  // pill because the title has to keep saying "Recording" across a pause too.
  private recordingActive = false;
  private pausedActive = false;
  private runDuration = '';

  /**
   * Reflect a live capture in the tab title, so a backgrounded tab still shows
   * the recorder is running - the one cue that survives switching away. The
   * pill is only visible while you are looking at the app; the title is not.
   */
  private syncTabTitle() {
    const BASE = 'Screen Recorder';
    if (this.recordingActive && this.pausedActive) {
      document.title = `⏸ Paused — ${BASE}`;
    } else if (this.recordingActive) {
      const run = this.runDuration ? ` ${this.runDuration}` : '';
      document.title = `● Recording${run} — ${BASE}`;
    } else {
      document.title = BASE;
    }
  }

  bindEvents(callbacks: {
    onShare: () => void;
    onRecord: () => void;
    onStop: () => void;
    onCropToggle: () => void;
    onPause: () => void;
    onScreenshot: () => void;
    onPip: () => void;
  }) {
    this.shareBtn.addEventListener('click', callbacks.onShare);
    this.emptyShareBtn.addEventListener('click', callbacks.onShare);
    this.recordBtn.addEventListener('click', callbacks.onRecord);
    this.stopBtn.addEventListener('click', callbacks.onStop);
    this.cropCheckbox.addEventListener('change', callbacks.onCropToggle);
    this.pauseBtn.addEventListener('click', callbacks.onPause);
    this.screenshotBtn.addEventListener('click', callbacks.onScreenshot);
    this.pipBtn.addEventListener('click', callbacks.onPip);

    // Settings drawer + the microphone-processing disclosure. Pure presentation:
    // state lives on <body> so the CSS in styles.css can react to it.
    const shell = document.body;
    const drawer = document.getElementById('settingsDrawer') as HTMLElement;
    const scrim = document.getElementById('settingsScrim') as HTMLElement;
    const openBtn = document.getElementById(
      'openSettings'
    ) as HTMLButtonElement;
    const chip = document.getElementById('settingsChip') as HTMLButtonElement;
    const closeBtn = document.getElementById(
      'closeSettings'
    ) as HTMLButtonElement;
    const advBtn = document.getElementById('advToggle') as HTMLButtonElement;

    // The settings drawer is a modal dialog: while open, Tab must stay inside
    // it, and closing must put focus back on whatever opened it (the header
    // button or the session-bar chip - not always the button).
    let releaseTrap: (() => void) | null = null;
    let invoker: HTMLElement = openBtn;

    const setPanel = (open: boolean, source?: HTMLElement) => {
      shell.dataset.panel = open ? 'open' : 'closed';
      drawer.setAttribute('aria-hidden', String(!open));
      openBtn.setAttribute('aria-expanded', String(open));
      if (open) {
        invoker = source ?? openBtn;
        releaseTrap?.();
        releaseTrap = trapFocus(drawer);
        closeBtn.focus();
      } else {
        releaseTrap?.();
        releaseTrap = null;
        invoker.focus();
      }
    };

    openBtn.addEventListener('click', () =>
      setPanel(shell.dataset.panel !== 'open', openBtn)
    );
    chip.addEventListener('click', () => setPanel(true, chip));
    closeBtn.addEventListener('click', () => setPanel(false));
    scrim.addEventListener('click', () => setPanel(false));
    document.addEventListener('keydown', (e) => {
      // Escape is already used to cancel a countdown; only close when one is
      // not running and the drawer is open.
      if (e.key === 'Escape' && shell.dataset.panel === 'open') setPanel(false);
    });

    advBtn.addEventListener('click', () => {
      const open = shell.dataset.adv !== 'open';
      shell.dataset.adv = open ? 'open' : 'closed';
      advBtn.setAttribute('aria-expanded', String(open));
    });
  }

  /**
   * Reflect whether the preview is currently floating. The label changes
   * rather than the button disappearing, so the control stays put and its
   * state is readable at a glance.
   */
  setPipState(active: boolean) {
    this.pipBtnText.textContent = active ? 'Close' : 'Pop out';
    this.pipBtn.title = active
      ? 'Close the floating preview'
      : 'Show the preview in a floating window';
    this.pipBtn.classList.toggle('bg-teal-600', active);
  }

  /** Whether the browser can do PiP at all; hides the control if not. */
  setPipSupported(supported: boolean) {
    this.pipBtn.dataset.supported = supported ? 'true' : 'false';
  }

  /**
   * Reflect a paused capture in the status row: the label, the button, and the
   * indicator (amber and still rather than red and pulsing).
   */
  setPausedState(isPaused: boolean) {
    this.pausedActive = isPaused;
    // Only claim a recording while one is live. When nothing is capturing, the
    // label belongs to setPhase() (Ready / Sharing) - writing here would
    // overwrite it, which is how the pill came to read "Recording..." while it
    // was styled as the blue sharing state.
    if (isPaused) {
      this.statusText.textContent = 'Paused';
    } else if (this.recordingActive) {
      this.statusText.textContent = 'Recording...';
    }
    this.pauseBtnText.textContent = isPaused ? 'Resume' : 'Pause';
    this.pauseBtn.title = isPaused
      ? 'Resume recording (P)'
      : 'Pause recording (P)';
    if (this.pauseBtnIcon) {
      this.pauseBtnIcon.setAttribute(
        'href',
        isPaused ? './icons.svg#icon-record' : './icons.svg#icon-pause'
      );
    }
    this.statusDot.classList.toggle('is-paused', isPaused);
    this.syncTabTitle();
  }

  /**
   * Show the running length of the take and how much has been written so far.
   * Both are interim figures until the capture stops.
   */
  updateStats(duration: string, size: string) {
    this.runDuration = duration;
    this.statsText.textContent = `${duration} · ${size}`;
    this.syncTabTitle();
  }

  clearStats() {
    this.statsText.textContent = '';
  }

  disableShareBtn() {
    this.shareBtn.disabled = true;
  }

  showError(message: string) {
    this.errorDiv.textContent = message;
    this.errorDiv.classList.remove('hidden');
  }

  hideError() {
    this.errorDiv.textContent = '';
    this.errorDiv.classList.add('hidden');
  }

  /**
   * Match the preview container's aspect ratio to the shared screen so the
   * preview is never cropped or letterboxed. The container is `aspect-video`
   * (16:9) by default, which is wrong for any screen that is not 16:9.
   */
  setPreviewAspect(width: number, height: number) {
    if (!width || !height) return;
    this.videoContainer.style.aspectRatio = `${width} / ${height}`;
  }

  resetPreviewAspect() {
    this.videoContainer.style.removeProperty('aspect-ratio');
  }

  setSharingState(isSharing: boolean) {
    const toggle = (el: HTMLElement, show: boolean) =>
      el.classList.toggle('hidden', !show);

    if (isSharing) {
      toggle(this.placeholder, false);
      toggle(this.shareBtnStart, false);
      toggle(this.shareBtnStop, true);

      this.recordBtn.disabled = false;
      this.screenshotBtn.disabled = false;
      this.pipBtn.disabled = false;
      this.pipBtn.classList.remove('hidden');
      this.pipBtn.classList.add('flex');
      this.cropCheckbox.disabled = false;
    } else {
      this.videoPreview.srcObject = null;
      this.resetPreviewAspect();
      toggle(this.placeholder, true);
      toggle(this.shareBtnStart, true);
      toggle(this.shareBtnStop, false);

      this.recordBtn.disabled = true;
      this.screenshotBtn.disabled = true;
      this.pipBtn.disabled = true;
      this.pipBtn.classList.add('hidden');
      this.pipBtn.classList.remove('flex');
      this.stopBtn.disabled = true;
      this.cropCheckbox.checked = false;
      this.cropCheckbox.disabled = true;
      toggle(this.cropContainer, false);
      this.cropBox.classList.remove('is-recording');
      this.setPhase('idle');
    }
    if (isSharing) this.setPhase('sharing');
  }

  setRecordingState(isRecording: boolean) {
    const icon = this.recordBtn.querySelector('svg') as unknown as HTMLElement;
    this.recordingActive = isRecording;
    this.videoPreview.classList.toggle('is-recording', isRecording);
    if (!isRecording) this.runDuration = '';

    if (isRecording) {
      this.setPhase('recording');
      this.setPausedState(false);
      this.stopBtn.disabled = false;
      this.recordBtn.disabled = true;
      this.shareBtn.disabled = true;
      this.cropCheckbox.disabled = true;
      if (this.cropCheckbox.checked) this.cropBox.classList.add('is-recording');
      if (icon) icon.style.display = 'none';
    } else {
      // Still sharing - the pill and the primary action go back to that phase.
      this.setPhase('sharing');
      this.setPausedState(false);
      this.clearStats();
      this.stopBtn.disabled = true;
      if (this.cropCheckbox.checked)
        this.cropBox.classList.remove('is-recording');
      this.recordBtnText.textContent = 'Start Recording';
      if (icon) icon.style.display = 'inline-block';

      this.recordBtn.disabled = false;
      this.shareBtn.disabled = false;
      this.cropCheckbox.disabled = false;
    }
    this.syncTabTitle();
  }

  updateStopwatch(text: string) {
    this.recordBtnText.textContent = text;
  }

  /**
   * Present the countdown.
   *
   * The Record button stays armed and reads "Cancel", so the countdown can be
   * called off from the control that started it rather than hunting for an
   * escape hatch.
   */
  setCountdownState(active: boolean) {
    this.countdownOverlay.classList.toggle('hidden', !active);
    if (active) {
      this.recordBtn.disabled = false;
      this.recordBtnText.textContent = 'Cancel';
      this.recordBtn.title = 'Cancel the countdown (Esc)';
    } else {
      this.countdownNumber.textContent = '';
      this.recordBtn.title = 'Start Recording (R)';
    }
  }

  showCountdown(remaining: number) {
    this.countdownNumber.textContent = String(remaining);
  }

  hideCountdown() {
    this.countdownOverlay.classList.add('hidden');
    this.countdownNumber.textContent = '';
  }

  toggleCropping(show: boolean) {
    this.cropContainer.classList.toggle('hidden', !show);
    this.cropTargetElement.classList.toggle('hidden', !show);
  }

  updateAudioLevel(source: 'system' | 'mic', level: number) {
    const visualizer =
      source === 'system'
        ? this.systemAudioVisualizer
        : this.micAudioVisualizer;
    if (visualizer) {
      visualizer.style.width = `${Math.min(100, Math.max(0, level * 100))}%`;
    }
  }
}
