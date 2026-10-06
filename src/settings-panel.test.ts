import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from './settings-panel';

/**
 * The exact element ids SettingsPanel looks up in its constructor. Keeping the
 * fixture explicit means a renamed id fails here instead of silently turning
 * into `null` at runtime.
 */
function renderSettings(): SettingsPanel {
  document.body.innerHTML = `
    <select id="formatSelect"></select>
    <select id="resolutionSelect"></select>
    <select id="frameRateSelect"></select>
    <select id="bitrateSelect"></select>
    <p id="qualitySummary"></p>
    <select id="countdownSelect">
      <option value="0">Off</option>
      <option value="3" selected>3 seconds</option>
      <option value="5">5 seconds</option>
    </select>
    <div class="source">
      <input type="checkbox" id="systemAudioToggle" />
      <input type="range" id="systemVolume" min="0" max="100" value="100" />
      <span id="systemVolumeValue"></span>
    </div>
    <input type="checkbox" id="micAudioToggle" />
    <input type="checkbox" id="micNoiseSuppression" checked />
    <input type="checkbox" id="micEchoCancellation" checked />
    <input type="checkbox" id="micAutoGain" checked />
    <input type="range" id="micVolume" min="0" max="100" value="100" />
    <span id="micVolumeValue"></span>
  `;
  return new SettingsPanel();
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;

beforeEach(() => {
  // jsdom has no MediaRecorder; populateFormats consults it to filter the list.
  vi.stubGlobal('MediaRecorder', {
    isTypeSupported: vi.fn().mockReturnValue(true),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('SettingsPanel.populateFormats', () => {
  const FORMATS = [
    { name: 'VP9', mimeType: 'video/webm; codecs=vp9', ext: 'webm' },
    { name: 'H264', mimeType: 'video/mp4; codecs=avc1', ext: 'mp4' },
  ];

  it('offers every format the browser supports', () => {
    const settings = renderSettings();
    expect(settings.populateFormats(FORMATS)).toBe(true);

    const select = $('formatSelect') as HTMLSelectElement;
    expect(select.options.length).toBe(2);
    expect(select.options[0].textContent).toBe('VP9');
  });

  it('skips formats the browser does not support', () => {
    (
      MediaRecorder.isTypeSupported as ReturnType<typeof vi.fn>
    ).mockImplementation((mime: string) => mime.includes('webm'));
    const settings = renderSettings();
    settings.populateFormats(FORMATS);

    const select = $('formatSelect') as HTMLSelectElement;
    expect(select.options.length).toBe(1);
    expect(select.options[0].textContent).toBe('VP9');
  });

  it('reports failure when nothing is supported, so the caller can bail', () => {
    (MediaRecorder.isTypeSupported as ReturnType<typeof vi.fn>).mockReturnValue(
      false
    );
    const settings = renderSettings();

    expect(settings.populateFormats(FORMATS)).toBe(false);
  });

  it('keeps the extension on the option so the filename matches the container', () => {
    const settings = renderSettings();
    settings.populateFormats(FORMATS);

    const select = $('formatSelect') as HTMLSelectElement;
    expect(select.options[0].dataset.ext).toBe('webm');
    expect(select.options[1].dataset.ext).toBe('mp4');
  });
});

describe('SettingsPanel.getFormat', () => {
  const FORMATS = [
    { name: 'VP9', mimeType: 'video/webm; codecs=vp9', ext: 'webm' },
  ];

  it('reads the selected format back', () => {
    const settings = renderSettings();
    settings.populateFormats(FORMATS);

    expect(settings.getFormat()).toEqual(FORMATS[0]);
  });
});

describe('SettingsPanel quality settings', () => {
  it('starts on Auto for all three', () => {
    const settings = renderSettings();
    settings.populateQuality();

    expect(settings.getQuality()).toEqual({
      width: undefined,
      frameRate: undefined,
      videoBitsPerSecond: undefined,
    });
  });

  it('reads each preset back as its value', () => {
    const settings = renderSettings();
    settings.populateQuality();
    ($('resolutionSelect') as HTMLSelectElement).value = '720p';
    ($('frameRateSelect') as HTMLSelectElement).value = '30';
    ($('bitrateSelect') as HTMLSelectElement).value = 'medium';

    expect(settings.getQuality()).toEqual({
      width: 1280,
      frameRate: 30,
      videoBitsPerSecond: 6_000_000,
    });
  });

  it('summarises the settings in plain language', () => {
    const settings = renderSettings();
    settings.populateQuality();

    expect($('qualitySummary').textContent).toBe('Source · Auto');
  });

  it('refreshes the summary when a preset changes', () => {
    // populateQuality binds its own change handling - a populate/bind pair that
    // must be called in order is exactly how the pauseBtnIcon bug happened.
    const settings = renderSettings();
    settings.populateQuality();
    ($('resolutionSelect') as HTMLSelectElement).value = '480p';
    $('resolutionSelect').dispatchEvent(new Event('change'));

    expect($('qualitySummary').textContent).toContain('854w');
  });

  it('offers every preset as an option', () => {
    const settings = renderSettings();
    settings.populateQuality();

    const count = (id: string) => ($(id) as HTMLSelectElement).options.length;
    expect(count('resolutionSelect')).toBe(4);
    expect(count('frameRateSelect')).toBe(4);
    expect(count('bitrateSelect')).toBe(4);
  });

  it('can be populated more than once without duplicating options', () => {
    const settings = renderSettings();
    settings.populateQuality();
    settings.populateQuality();

    const select = $('resolutionSelect') as HTMLSelectElement;
    expect(select.options.length).toBe(4);
  });
});

describe('SettingsPanel countdown', () => {
  it('defaults to three seconds', () => {
    expect(renderSettings().getCountdownSeconds()).toBe(3);
  });

  it('reads the chosen length', () => {
    const settings = renderSettings();
    ($('countdownSelect') as HTMLSelectElement).value = '5';

    expect(settings.getCountdownSeconds()).toBe(5);
  });

  it('reports zero for the Off setting', () => {
    const settings = renderSettings();
    ($('countdownSelect') as HTMLSelectElement).value = '0';

    expect(settings.getCountdownSeconds()).toBe(0);
  });

  it('stays live while sharing', () => {
    // It governs the next take, not the shared stream - exactly like bitrate.
    const settings = renderSettings();
    settings.setLocked(true);

    expect(($('countdownSelect') as HTMLSelectElement).disabled).toBe(false);
  });
});

describe('SettingsPanel lock rules', () => {
  it('locks resolution and frame rate while sharing', () => {
    // These live in the track, so changing them mid-share would silently do
    // nothing - locking is what stops the UI lying about that.
    const settings = renderSettings();
    settings.populateQuality();
    settings.setLocked(true);

    expect(($('resolutionSelect') as HTMLSelectElement).disabled).toBe(true);
    expect(($('frameRateSelect') as HTMLSelectElement).disabled).toBe(true);
  });

  it('leaves the bitrate live while sharing', () => {
    // The opposite of the capture settings: the bitrate is an encoder setting
    // and can take effect on the next take without re-sharing.
    const settings = renderSettings();
    settings.populateQuality();
    settings.setLocked(true);

    expect(($('bitrateSelect') as HTMLSelectElement).disabled).toBe(false);
  });

  it('locks the audio inputs and the mic conditioning too', () => {
    const settings = renderSettings();
    settings.setLocked(true);

    for (const id of [
      'systemAudioToggle',
      'micAudioToggle',
      'micNoiseSuppression',
      'micEchoCancellation',
      'micAutoGain',
    ]) {
      expect(($(id) as HTMLInputElement).disabled).toBe(true);
    }
  });

  it('unlocks everything again when sharing stops', () => {
    const settings = renderSettings();
    settings.setLocked(true);
    settings.setLocked(false);

    for (const id of ['formatSelect', 'resolutionSelect', 'frameRateSelect']) {
      expect(($(id) as HTMLSelectElement).disabled).toBe(false);
    }
  });
});

describe('SettingsPanel audio', () => {
  it('reads the audio source selection', () => {
    const settings = renderSettings();
    ($('systemAudioToggle') as HTMLInputElement).checked = true;
    ($('micAudioToggle') as HTMLInputElement).checked = true;

    expect(settings.getAudioConfig()).toEqual({
      systemAudio: true,
      micAudio: true,
    });
  });

  it('defaults to every mic conditioner on', () => {
    expect(renderSettings().getMicOptions()).toEqual({
      enabled: false,
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
    });
  });

  it('follows the microphone toggle and each conditioner', () => {
    const settings = renderSettings();
    ($('micAudioToggle') as HTMLInputElement).checked = true;
    ($('micNoiseSuppression') as HTMLInputElement).checked = false;
    ($('micAutoGain') as HTMLInputElement).checked = false;

    expect(settings.getMicOptions()).toEqual({
      enabled: true,
      noiseSuppression: false,
      echoCancellation: true,
      autoGainControl: false,
    });
  });

  it('reads each fader as a gain multiplier', () => {
    const settings = renderSettings();
    ($('systemVolume') as HTMLInputElement).value = '50';
    ($('micVolume') as HTMLInputElement).value = '25';

    expect(settings.getVolume('system')).toBe(0.5);
    expect(settings.getVolume('mic')).toBe(0.25);
  });

  it('treats a fader at full as unity gain and the bottom as silence', () => {
    const settings = renderSettings();
    expect(settings.getVolume('system')).toBe(1);

    ($('systemVolume') as HTMLInputElement).value = '0';
    expect(settings.getVolume('system')).toBe(0);
  });

  it('mirrors the fader value as a percentage', () => {
    const settings = renderSettings();
    settings.bindVolumeControls(() => {});

    expect($('systemVolumeValue').textContent).toBe('100%');

    ($('systemVolume') as HTMLInputElement).value = '37';
    $('systemVolume').dispatchEvent(new Event('input'));

    expect($('systemVolumeValue').textContent).toBe('37%');
  });

  it('reports which source moved', () => {
    const settings = renderSettings();
    const seen: string[] = [];
    settings.bindVolumeControls((source) => seen.push(source));

    expect(seen).toEqual(['system', 'mic']);

    $('micVolume').dispatchEvent(new Event('input'));
    expect(seen.at(-1)).toBe('mic');
  });
});

describe('SettingsPanel system audio availability', () => {
  it('disables the chip when the share came back without system audio', () => {
    const settings = renderSettings();
    settings.setSystemAudioAvailable(false);

    expect(($('systemAudioToggle') as HTMLInputElement).disabled).toBe(true);
    expect(($('systemVolume') as HTMLInputElement).disabled).toBe(true);

    const chip = $('systemAudioToggle').closest('.source') as HTMLElement;
    expect(chip.hasAttribute('data-unavailable')).toBe(true);
    expect(chip.title).toContain('not part of this share');
  });

  it('restores the chip when system audio is there', () => {
    const settings = renderSettings();
    settings.setSystemAudioAvailable(false);
    settings.setSystemAudioAvailable(true);

    expect(($('systemAudioToggle') as HTMLInputElement).disabled).toBe(false);
    expect(($('systemVolume') as HTMLInputElement).disabled).toBe(false);

    const chip = $('systemAudioToggle').closest('.source') as HTMLElement;
    expect(chip.hasAttribute('data-unavailable')).toBe(false);
    expect(chip.hasAttribute('title')).toBe(false);
  });

  it('keeps the toggle disabled after the lock lifts if the share is silent', () => {
    // Two independent reasons to disable: the lock (a share is live) and the
    // missing track (this share has no system audio). Lifting one must not
    // re-enable the control while the other still stands.
    const settings = renderSettings();
    settings.setSystemAudioAvailable(false);
    settings.setLocked(true);
    settings.setLocked(false);

    expect(($('systemAudioToggle') as HTMLInputElement).disabled).toBe(true);
  });

  it('stays locked when the audio is back but the share is live', () => {
    const settings = renderSettings();
    settings.setLocked(true);
    settings.setSystemAudioAvailable(true);

    expect(($('systemAudioToggle') as HTMLInputElement).disabled).toBe(true);
    // The fader is deliberately outside the lock - it drives live gains - so
    // only the missing track can disable it.
    expect(($('systemVolume') as HTMLInputElement).disabled).toBe(false);
  });
});
