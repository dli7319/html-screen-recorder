import { RecordingFormat } from './types';

export class UIManager {
  public videoPreview: HTMLVideoElement;
  public videoContainer: HTMLDivElement;
  public shareBtn: HTMLButtonElement;
  private shareBtnStart: HTMLSpanElement;
  private shareBtnStop: HTMLSpanElement;
  public recordBtn: HTMLButtonElement;
  private recordBtnText: HTMLSpanElement;
  public stopBtn: HTMLButtonElement;
  private downloadLink: HTMLAnchorElement;
  private placeholder: HTMLDivElement;
  private statusDiv: HTMLDivElement;
  private errorDiv: HTMLDivElement;
  private formatSelect: HTMLSelectElement;
  private systemAudioToggle: HTMLInputElement;
  private micAudioToggle: HTMLInputElement;
  public cropCheckbox: HTMLInputElement;
  private cropContainer: HTMLDivElement;
  public cropTargetElement: HTMLDivElement;
  public cropBox: HTMLDivElement;

  constructor() {
    this.videoPreview = document.getElementById(
      'videoPreview'
    ) as HTMLVideoElement;
    this.videoContainer = document.getElementById(
      'videoContainer'
    ) as HTMLDivElement;
    this.shareBtn = document.getElementById('shareBtn') as HTMLButtonElement;
    this.shareBtnStart = document.getElementById(
      'shareBtnStart'
    ) as HTMLSpanElement;
    this.shareBtnStop = document.getElementById(
      'shareBtnStop'
    ) as HTMLSpanElement;
    this.recordBtn = document.getElementById('recordBtn') as HTMLButtonElement;
    this.recordBtnText = document.getElementById(
      'recordBtnText'
    ) as HTMLSpanElement;
    this.stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
    this.downloadLink = document.getElementById(
      'downloadLink'
    ) as HTMLAnchorElement;
    this.placeholder = document.getElementById('placeholder') as HTMLDivElement;
    this.statusDiv = document.getElementById('status') as HTMLDivElement;
    this.errorDiv = document.getElementById('error') as HTMLDivElement;
    this.formatSelect = document.getElementById(
      'formatSelect'
    ) as HTMLSelectElement;
    this.systemAudioToggle = document.getElementById(
      'systemAudioToggle'
    ) as HTMLInputElement;
    this.micAudioToggle = document.getElementById(
      'micAudioToggle'
    ) as HTMLInputElement;
    this.cropCheckbox = document.getElementById(
      'cropCheckbox'
    ) as HTMLInputElement;
    this.cropContainer = document.getElementById(
      'cropContainer'
    ) as HTMLDivElement;
    this.cropTargetElement = document.getElementById(
      'cropTargetElement'
    ) as HTMLDivElement;
    this.cropBox = document.getElementById('cropBox') as HTMLDivElement;
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
      this.shareBtn.disabled = true;
    }
  }

  showError(message: string) {
    this.errorDiv.textContent = message;
    this.errorDiv.classList.remove('hidden');
  }

  hideError() {
    this.errorDiv.textContent = '';
    this.errorDiv.classList.add('hidden');
  }

  setSharingState(isSharing: boolean) {
    if (isSharing) {
      this.placeholder.classList.add('hidden');
      this.shareBtnStart.classList.add('hidden');
      this.shareBtnStop.classList.remove('hidden');
      this.recordBtn.disabled = false;
      this.cropCheckbox.disabled = false;
      this.formatSelect.disabled = true;
      this.systemAudioToggle.disabled = true;
      this.micAudioToggle.disabled = true;

      this.downloadLink.classList.add('pointer-events-none', 'opacity-50');
      this.downloadLink.removeAttribute('href');
    } else {
      this.videoPreview.srcObject = null;
      this.placeholder.classList.remove('hidden');
      this.shareBtnStart.classList.remove('hidden');
      this.shareBtnStop.classList.add('hidden');
      this.recordBtn.disabled = true;
      this.stopBtn.disabled = true;
      this.cropCheckbox.checked = false;
      this.cropCheckbox.disabled = true;
      this.cropContainer.classList.add('hidden');
      this.cropBox.classList.remove('is-recording');
      this.formatSelect.disabled = false;
      this.systemAudioToggle.disabled = false;
      this.micAudioToggle.disabled = false;
    }
  }

  setRecordingState(isRecording: boolean) {
    if (isRecording) {
      this.statusDiv.classList.remove('hidden');
      this.stopBtn.disabled = false;
      this.recordBtn.disabled = true;
      this.shareBtn.disabled = true;
      this.cropCheckbox.disabled = true;
      if (this.cropCheckbox.checked) {
        this.cropBox.classList.add('is-recording');
      }
      const icon = this.recordBtn.querySelector('svg');
      if (icon) (icon as unknown as HTMLElement).style.display = 'none';
    } else {
      this.statusDiv.classList.add('hidden');
      this.stopBtn.disabled = true;
      if (this.cropCheckbox.checked) {
        this.cropBox.classList.remove('is-recording');
      }
      this.recordBtnText.textContent = 'Start Recording';
      const icon = this.recordBtn.querySelector('svg');
      if (icon) (icon as unknown as HTMLElement).style.display = 'inline-block';

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
    if (show) {
      this.cropContainer.classList.remove('hidden');
      this.cropTargetElement.classList.remove('hidden');
    } else {
      this.cropContainer.classList.add('hidden');
      this.cropTargetElement.classList.add('hidden');
    }
  }
}
