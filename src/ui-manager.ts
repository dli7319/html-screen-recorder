import { RecordingFormat } from './types';

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
  private downloadLink = document.getElementById(
    'downloadLink'
  ) as HTMLAnchorElement;
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
  private errorDiv = document.getElementById('error') as HTMLDivElement;
  private formatSelect = document.getElementById(
    'formatSelect'
  ) as HTMLSelectElement;
  private systemAudioToggle = document.getElementById(
    'systemAudioToggle'
  ) as HTMLInputElement;
  private micAudioToggle = document.getElementById(
    'micAudioToggle'
  ) as HTMLInputElement;
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

  bindEvents(callbacks: {
    onShare: () => void;
    onRecord: () => void;
    onStop: () => void;
    onCropToggle: () => void;
    onPause: () => void;
  }) {
    this.shareBtn.addEventListener('click', callbacks.onShare);
    this.recordBtn.addEventListener('click', callbacks.onRecord);
    this.stopBtn.addEventListener('click', callbacks.onStop);
    this.cropCheckbox.addEventListener('change', callbacks.onCropToggle);
    this.pauseBtn.addEventListener('click', callbacks.onPause);
  }

  /**
   * Reflect a paused capture in the status row: the label, the button, and the
   * indicator (amber and still rather than red and pulsing).
   */
  setPausedState(isPaused: boolean) {
    this.statusText.textContent = isPaused ? 'Paused' : 'Recording...';
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
  }

  /**
   * Show the running length of the take and how much has been written so far.
   * Both are interim figures until the capture stops.
   */
  updateStats(duration: string, size: string) {
    this.statsText.textContent = `${duration} · ${size}`;
  }

  clearStats() {
    this.statsText.textContent = '';
  }

  populateFormats(formats: RecordingFormat[]) {
    formats.forEach((format) => {
      if (MediaRecorder.isTypeSupported(format.mimeType)) {
        const option = document.createElement('option');
        option.value = format.mimeType;
        option.textContent = format.name;
        option.dataset.ext = format.ext;
        this.formatSelect.appendChild(option);
      }
    });

    if (this.formatSelect.options.length === 0) {
      this.showError('No supported recording formats found in this browser.');
      this.disableShareBtn();
    }
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
      this.cropCheckbox.disabled = false;
      this.formatSelect.disabled = true;
      this.systemAudioToggle.disabled = true;
      this.micAudioToggle.disabled = true;

      this.downloadLink.classList.add('pointer-events-none', 'opacity-50');
      this.downloadLink.removeAttribute('href');
    } else {
      this.videoPreview.srcObject = null;
      this.resetPreviewAspect();
      toggle(this.placeholder, true);
      toggle(this.shareBtnStart, true);
      toggle(this.shareBtnStop, false);

      this.recordBtn.disabled = true;
      this.stopBtn.disabled = true;
      this.cropCheckbox.checked = false;
      this.cropCheckbox.disabled = true;
      toggle(this.cropContainer, false);
      this.cropBox.classList.remove('is-recording');
      this.formatSelect.disabled = false;
      this.systemAudioToggle.disabled = false;
      this.micAudioToggle.disabled = false;
    }
  }

  setRecordingState(isRecording: boolean) {
    const icon = this.recordBtn.querySelector('svg') as unknown as HTMLElement;

    if (isRecording) {
      this.statusDiv.classList.remove('hidden');
      this.setPausedState(false);
      this.stopBtn.disabled = false;
      this.recordBtn.disabled = true;
      this.shareBtn.disabled = true;
      this.cropCheckbox.disabled = true;
      if (this.cropCheckbox.checked) this.cropBox.classList.add('is-recording');
      if (icon) icon.style.display = 'none';
    } else {
      this.statusDiv.classList.add('hidden');
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
  }

  updateStopwatch(text: string) {
    this.recordBtnText.textContent = text;
  }

  setDownloadLink(url: string, filename: string) {
    this.downloadLink.href = url;
    this.downloadLink.download = filename;
    this.downloadLink.classList.remove('pointer-events-none', 'opacity-50');
  }

  getFormat(): RecordingFormat {
    const selected = this.formatSelect.options[this.formatSelect.selectedIndex];
    return {
      name: selected.textContent || '',
      mimeType: selected.value,
      ext: selected.dataset.ext!,
    };
  }

  getAudioConfig() {
    return {
      systemAudio: this.systemAudioToggle.checked,
      micAudio: this.micAudioToggle.checked,
    };
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
