import { RecordingFormat } from './types';
import {
  BITRATE_PRESETS,
  CaptureConstraints,
  EncoderConfig,
  FRAME_RATE_PRESETS,
  RESOLUTION_PRESETS,
  describeQuality,
  resolvePreset,
} from './quality';

/**
 * Everything the user configures before capturing: format, capture quality,
 * and the audio inputs.
 *
 * Split out of UIManager because this is a coherent block of settings with its
 * own locking rules, and because leaving it merged meant every feature added
 * more fields to a class that also owns the preview, the transport buttons and
 * the status row.
 */
export class SettingsPanel {
  private formatSelect = document.getElementById(
    'formatSelect'
  ) as HTMLSelectElement;
  private resolutionSelect = document.getElementById(
    'resolutionSelect'
  ) as HTMLSelectElement;
  private frameRateSelect = document.getElementById(
    'frameRateSelect'
  ) as HTMLSelectElement;
  private bitrateSelect = document.getElementById(
    'bitrateSelect'
  ) as HTMLSelectElement;
  private qualitySummary = document.getElementById(
    'qualitySummary'
  ) as HTMLParagraphElement;
  private countdownSelect = document.getElementById(
    'countdownSelect'
  ) as HTMLSelectElement;
  private systemAudioToggle = document.getElementById(
    'systemAudioToggle'
  ) as HTMLInputElement;
  private micAudioToggle = document.getElementById(
    'micAudioToggle'
  ) as HTMLInputElement;
  private micNoiseSuppression = document.getElementById(
    'micNoiseSuppression'
  ) as HTMLInputElement;
  private micEchoCancellation = document.getElementById(
    'micEchoCancellation'
  ) as HTMLInputElement;
  private micAutoGain = document.getElementById(
    'micAutoGain'
  ) as HTMLInputElement;
  private systemVolume = document.getElementById(
    'systemVolume'
  ) as HTMLInputElement;
  private micVolume = document.getElementById('micVolume') as HTMLInputElement;
  private systemVolumeValue = document.getElementById(
    'systemVolumeValue'
  ) as HTMLSpanElement;
  private micVolumeValue = document.getElementById(
    'micVolumeValue'
  ) as HTMLSpanElement;

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

    return this.formatSelect.options.length > 0;
  }

  /**
   * Populate the quality selects and wire their change handling in one call.
   *
   * Deliberately one method rather than a populate/bind pair that must be
   * called in the right order - a summary that silently stops updating is the
   * kind of bug nobody reports.
   */
  populateQuality() {
    const fill = (
      select: HTMLSelectElement,
      presets: { id: string; label: string }[]
    ) => {
      select.innerHTML = '';
      presets.forEach((preset) => {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = preset.label;
        select.appendChild(option);
      });
    };

    fill(this.resolutionSelect, RESOLUTION_PRESETS);
    fill(this.frameRateSelect, FRAME_RATE_PRESETS);
    fill(this.bitrateSelect, BITRATE_PRESETS);

    const sync = () => this.syncQualitySummary();
    this.resolutionSelect.addEventListener('change', sync);
    this.frameRateSelect.addEventListener('change', sync);
    this.bitrateSelect.addEventListener('change', sync);

    this.syncQualitySummary();
  }

  getFormat(): RecordingFormat {
    const selected = this.formatSelect.options[this.formatSelect.selectedIndex];
    return {
      name: selected.textContent || '',
      mimeType: selected.value,
      ext: selected.dataset.ext!,
    };
  }

  /**
   * The quality settings in effect.
   *
   * Split across the two half-interfaces because they have different
   * lifetimes: capture constraints are fixed once sharing starts, encoder
   * settings can change between takes.
   */
  getQuality(): CaptureConstraints & EncoderConfig {
    const resolution = resolvePreset(
      RESOLUTION_PRESETS,
      this.resolutionSelect.value
    );
    const frameRate = resolvePreset(
      FRAME_RATE_PRESETS,
      this.frameRateSelect.value
    );
    const bitrate = resolvePreset(BITRATE_PRESETS, this.bitrateSelect.value);

    return {
      width: resolution.width,
      frameRate: frameRate.frameRate,
      videoBitsPerSecond: bitrate.videoBitsPerSecond,
    };
  }

  syncQualitySummary() {
    const q = this.getQuality();
    this.qualitySummary.textContent = describeQuality(q, q);
  }

  /**
   * Seconds to count down before capturing. Zero means start straight away -
   * the off setting is a value, not an absence.
   */
  getCountdownSeconds(): number {
    const value = Number(this.countdownSelect.value);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  getAudioConfig() {
    return {
      systemAudio: this.systemAudioToggle.checked,
      micAudio: this.micAudioToggle.checked,
    };
  }

  /**
   * Microphone conditioning. These are hints the browser may ignore, but they
   * must still be read at share time - once the stream exists the constraints
   * are fixed.
   */
  getMicOptions() {
    return {
      enabled: this.micAudioToggle.checked,
      noiseSuppression: this.micNoiseSuppression.checked,
      echoCancellation: this.micEchoCancellation.checked,
      autoGainControl: this.micAutoGain.checked,
    };
  }

  /**
   * Level for one source, as a gain multiplier. The faders stay live while
   * recording - balancing the two inputs is exactly the sort of thing you
   * discover you need mid-take.
   */
  getVolume(source: 'system' | 'mic'): number {
    const slider = source === 'system' ? this.systemVolume : this.micVolume;
    return Number(slider.value) / 100;
  }

  /** Wire the faders to a callback and keep the percentage readout in step. */
  bindVolumeControls(onChange: (source: 'system' | 'mic') => void) {
    const wire = (
      slider: HTMLInputElement,
      readout: HTMLSpanElement,
      source: 'system' | 'mic'
    ) => {
      const sync = () => {
        readout.textContent = `${slider.value}%`;
        onChange(source);
      };
      slider.addEventListener('input', sync);
      sync();
    };
    wire(this.systemVolume, this.systemVolumeValue, 'system');
    wire(this.micVolume, this.micVolumeValue, 'mic');
  }

  /**
   * Lock the settings that cannot change while a share is live.
   *
   * Only the capture-time settings lock. The bitrate is an encoder setting and
   * deliberately stays live, since it can take effect on the next take without
   * re-sharing - graying it out would imply the opposite.
   */
  setLocked(locked: boolean) {
    // The countdown select is not here on purpose: it governs the next take,
    // not the shared stream, so it stays live exactly like the bitrate.
    this.formatSelect.disabled = locked;
    this.resolutionSelect.disabled = locked;
    this.frameRateSelect.disabled = locked;
    this.systemAudioToggle.disabled = locked;
    this.micAudioToggle.disabled = locked;
    this.micNoiseSuppression.disabled = locked;
    this.micEchoCancellation.disabled = locked;
    this.micAutoGain.disabled = locked;
  }
}
