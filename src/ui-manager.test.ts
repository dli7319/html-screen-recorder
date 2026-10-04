import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UIManager } from './ui-manager';

/**
 * The exact element ids UIManager looks up in its constructor. Keeping the
 * fixture explicit means a renamed id fails here instead of silently turning
 * into `null` at runtime.
 */
function renderUI(): UIManager {
  document.body.innerHTML = `
    <div id="videoContainer">
      <video id="videoPreview"></video>
      <div id="placeholder"></div>
    </div>
    <div id="cropBox"></div>
    <div id="cropTargetElement"></div>
    <div id="cropContainer" class="hidden"></div>
    <input type="checkbox" id="cropCheckbox" />
    <button id="shareBtn">
      <span id="shareBtnStart"></span>
      <span id="shareBtnStop" class="hidden"></span>
    </button>
    <button id="recordBtn"><span id="recordBtnText">Start Recording</span></button>
    <button id="stopBtn"></button>
    <a id="downloadLink"></a>
    <div id="status" class="hidden">
      <div id="statusDot" class="status-dot"></div>
      <span id="statusText">Recording...</span>
      <span id="statsText"></span>
      <button id="pauseBtn">
        <svg><use id="pauseBtnIcon" href="./icons.svg#icon-pause"></use></svg>
        <span id="pauseBtnText">Pause</span>
      </button>
    </div>
    <div id="error" class="hidden"></div>
    <select id="formatSelect"></select>
    <select id="resolutionSelect"></select>
    <select id="frameRateSelect"></select>
    <select id="bitrateSelect"></select>
    <p id="qualitySummary"></p>
    <input type="checkbox" id="systemAudioToggle" />
    <input type="checkbox" id="micAudioToggle" />
    <input type="checkbox" id="micNoiseSuppression" checked />
    <input type="checkbox" id="micEchoCancellation" checked />
    <input type="checkbox" id="micAutoGain" checked />
    <input type="range" id="systemVolume" min="0" max="100" value="100" />
    <input type="range" id="micVolume" min="0" max="100" value="100" />
    <span id="systemVolumeValue"></span>
    <span id="micVolumeValue"></span>
    <div id="systemAudioVisualizer"></div>
    <div id="micAudioVisualizer"></div>
  `;
  return new UIManager();
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

describe('UIManager.populateFormats', () => {
  const formats = [
    { name: 'AV1', mimeType: 'video/mp4; codecs=av01', ext: 'mp4' },
    { name: 'VP9', mimeType: 'video/webm; codecs=vp9', ext: 'webm' },
    { name: 'H264', mimeType: 'video/mp4; codecs=avc1', ext: 'mp4' },
  ];

  it('offers every format the browser supports', () => {
    const ui = renderUI();
    ui.populateFormats(formats);

    const options = [...$('formatSelect').querySelectorAll('option')];
    expect(options.map((o) => o.value)).toEqual(formats.map((f) => f.mimeType));
    expect(options.map((o) => o.textContent)).toEqual(['AV1', 'VP9', 'H264']);
  });

  it('records the container extension on each option', () => {
    const ui = renderUI();
    ui.populateFormats(formats);

    const options = [...$('formatSelect').querySelectorAll('option')];
    expect(options.map((o) => (o as HTMLOptionElement).dataset.ext)).toEqual([
      'mp4',
      'webm',
      'mp4',
    ]);
  });

  it('skips formats the browser cannot record', () => {
    (
      MediaRecorder.isTypeSupported as ReturnType<typeof vi.fn>
    ).mockImplementation((mime: string) => !mime.includes('vp9'));
    const ui = renderUI();
    ui.populateFormats(formats);

    const options = [...$('formatSelect').querySelectorAll('option')];
    expect(options.map((o) => o.value)).toEqual([
      'video/mp4; codecs=av01',
      'video/mp4; codecs=avc1',
    ]);
  });

  it('reports an error and blocks sharing when nothing is supported', () => {
    (MediaRecorder.isTypeSupported as ReturnType<typeof vi.fn>).mockReturnValue(
      false
    );
    const ui = renderUI();
    ui.populateFormats(formats);

    expect($('error').classList.contains('hidden')).toBe(false);
    expect($('error').textContent).toMatch(/no supported recording formats/i);
    expect(($('shareBtn') as HTMLButtonElement).disabled).toBe(true);
    expect($('formatSelect').querySelectorAll('option')).toHaveLength(0);
  });

  it('leaves the error hidden when at least one format works', () => {
    const ui = renderUI();
    ui.populateFormats(formats);

    expect($('error').classList.contains('hidden')).toBe(true);
    expect(($('shareBtn') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('UIManager preview aspect ratio', () => {
  it('matches the container to the shared surface', () => {
    const ui = renderUI();
    ui.setPreviewAspect(3456, 2234);

    expect(ui.videoContainer.style.aspectRatio).toBe('3456 / 2234');
  });

  it('ignores degenerate dimensions instead of corrupting the ratio', () => {
    const ui = renderUI();
    ui.setPreviewAspect(0, 2234);
    ui.setPreviewAspect(3456, 0);
    ui.setPreviewAspect(NaN, NaN);

    expect(ui.videoContainer.style.aspectRatio).toBe('');
  });

  it('falls back to the markup default when sharing stops', () => {
    const ui = renderUI();
    ui.setPreviewAspect(900, 1600);
    expect(ui.videoContainer.style.aspectRatio).toBe('900 / 1600');

    ui.resetPreviewAspect();
    // Removing the inline property lets `aspect-video` take over again.
    expect(ui.videoContainer.style.aspectRatio).toBe('');
  });
});

describe('UIManager.setSharingState', () => {
  it('arms the record button and locks the capture settings', () => {
    const ui = renderUI();
    ui.setSharingState(true);

    expect(($('recordBtn') as HTMLButtonElement).disabled).toBe(false);
    expect(($('cropCheckbox') as HTMLInputElement).disabled).toBe(false);
    expect($('placeholder').classList.contains('hidden')).toBe(true);
    expect($('shareBtnStop').classList.contains('hidden')).toBe(false);
    expect($('shareBtnStart').classList.contains('hidden')).toBe(true);

    expect(($('formatSelect') as HTMLSelectElement).disabled).toBe(true);
    expect(($('systemAudioToggle') as HTMLInputElement).disabled).toBe(true);
    expect(($('micAudioToggle') as HTMLInputElement).disabled).toBe(true);
  });

  it('disables the download link while a share is live', () => {
    const ui = renderUI();
    ui.setDownloadLink('blob:example', 'take.mp4');
    ui.setSharingState(true);

    const link = $('downloadLink');
    expect(link.classList.contains('pointer-events-none')).toBe(true);
    expect(link.classList.contains('opacity-50')).toBe(true);
    expect(link.hasAttribute('href')).toBe(false);
  });

  it('tears the whole capture state back down when sharing stops', () => {
    const ui = renderUI();
    const cropCheckbox = $('cropCheckbox') as HTMLInputElement;
    cropCheckbox.checked = true;

    ui.setSharingState(true);
    ui.toggleCropping(true);
    ui.setSharingState(false);

    expect(ui.videoPreview.srcObject).toBeNull();
    expect(ui.videoContainer.style.aspectRatio).toBe('');
    expect($('placeholder').classList.contains('hidden')).toBe(false);
    expect(($('recordBtn') as HTMLButtonElement).disabled).toBe(true);
    expect(($('stopBtn') as HTMLButtonElement).disabled).toBe(true);
    expect(cropCheckbox.checked).toBe(false);
    expect(cropCheckbox.disabled).toBe(true);
    expect($('cropContainer').classList.contains('hidden')).toBe(true);
    expect(ui.cropBox.classList.contains('is-recording')).toBe(false);
    expect(($('formatSelect') as HTMLSelectElement).disabled).toBe(false);
  });
});

describe('UIManager.setRecordingState', () => {
  it('locks sharing and cropping while recording', () => {
    const ui = renderUI();
    const cropCheckbox = $('cropCheckbox') as HTMLInputElement;
    cropCheckbox.checked = true;

    ui.setRecordingState(true);

    expect($('status').classList.contains('hidden')).toBe(false);
    expect(($('stopBtn') as HTMLButtonElement).disabled).toBe(false);
    expect(($('recordBtn') as HTMLButtonElement).disabled).toBe(true);
    expect(($('shareBtn') as HTMLButtonElement).disabled).toBe(true);
    expect(cropCheckbox.disabled).toBe(true);
    expect(ui.cropBox.classList.contains('is-recording')).toBe(true);
  });

  it('restores every control and the button label afterwards', () => {
    const ui = renderUI();
    ui.updateStopwatch('02:11');
    ui.setRecordingState(true);
    ui.setRecordingState(false);

    expect($('status').classList.contains('hidden')).toBe(true);
    expect(($('stopBtn') as HTMLButtonElement).disabled).toBe(true);
    expect(($('recordBtn') as HTMLButtonElement).disabled).toBe(false);
    expect(($('shareBtn') as HTMLButtonElement).disabled).toBe(false);
    expect($('recordBtnText').textContent).toBe('Start Recording');
    expect(ui.cropBox.classList.contains('is-recording')).toBe(false);
  });

  it('only marks the crop box while cropping is on', () => {
    const ui = renderUI();
    ui.setRecordingState(true);

    expect(ui.cropBox.classList.contains('is-recording')).toBe(false);
  });
});

describe('UIManager read/write helpers', () => {
  it('reports the selected format with its container extension', () => {
    const ui = renderUI();
    ui.populateFormats([
      { name: 'VP9', mimeType: 'video/webm; codecs=vp9', ext: 'webm' },
      { name: 'H264', mimeType: 'video/mp4; codecs=avc1', ext: 'mp4' },
    ]);

    const select = $('formatSelect') as HTMLSelectElement;
    select.selectedIndex = 1;
    expect(ui.getFormat()).toEqual({
      name: 'H264',
      mimeType: 'video/mp4; codecs=avc1',
      ext: 'mp4',
    });
  });

  it('reads which audio sources are enabled', () => {
    const ui = renderUI();
    expect(ui.getAudioConfig()).toEqual({
      systemAudio: false,
      micAudio: false,
    });

    ($('systemAudioToggle') as HTMLInputElement).checked = true;
    expect(ui.getAudioConfig()).toEqual({
      systemAudio: true,
      micAudio: false,
    });
  });

  it('arms the download link with the recording filename', () => {
    const ui = renderUI();
    ui.setDownloadLink('blob:example', '20261004123000.mp4');

    const link = $('downloadLink') as HTMLAnchorElement;
    expect(link.href).toContain('blob:example');
    expect(link.download).toBe('20261004123000.mp4');
    expect(link.classList.contains('pointer-events-none')).toBe(false);
    expect(link.classList.contains('opacity-50')).toBe(false);
  });

  it('clamps audio levels into the visualizer range', () => {
    const ui = renderUI();
    ui.updateAudioLevel('system', 0.42);
    expect($('systemAudioVisualizer').style.width).toBe('42%');

    ui.updateAudioLevel('mic', 5);
    expect($('micAudioVisualizer').style.width).toBe('100%');

    ui.updateAudioLevel('mic', -1);
    expect($('micAudioVisualizer').style.width).toBe('0%');
  });

  it('shows and hides the error banner together with its message', () => {
    const ui = renderUI();
    ui.showError('boom');

    expect($('error').textContent).toBe('boom');
    expect($('error').classList.contains('hidden')).toBe(false);

    ui.hideError();
    expect($('error').textContent).toBe('');
    expect($('error').classList.contains('hidden')).toBe(true);
  });

  it('routes stopwatch text into the record button', () => {
    const ui = renderUI();
    ui.updateStopwatch('00:31');
    expect($('recordBtnText').textContent).toBe('00:31');
  });

  it('binds its callbacks to the matching controls', () => {
    const ui = renderUI();
    const onShare = vi.fn();
    const onRecord = vi.fn();
    const onStop = vi.fn();
    const onCropToggle = vi.fn();
    const onPause = vi.fn();
    ui.bindEvents({ onShare, onRecord, onStop, onCropToggle, onPause });

    $('shareBtn').click();
    $('recordBtn').click();
    $('stopBtn').click();
    $('pauseBtn').click();
    $('cropCheckbox').dispatchEvent(new Event('change'));

    expect(onShare).toHaveBeenCalledOnce();
    expect(onRecord).toHaveBeenCalledOnce();
    expect(onStop).toHaveBeenCalledOnce();
    expect(onCropToggle).toHaveBeenCalledOnce();
    expect(onPause).toHaveBeenCalledOnce();
  });
});

describe('UIManager.setPausedState', () => {
  it('presents Pause while capturing', () => {
    const ui = renderUI();
    ui.setRecordingState(true);
    ui.setPausedState(false);

    expect($('statusText').textContent).toBe('Recording...');
    expect($('pauseBtnText').textContent).toBe('Pause');
    expect($('pauseBtn').title).toContain('Pause');
    expect($('statusDot').classList.contains('is-paused')).toBe(false);
  });

  it('presents Resume and marks the indicator while paused', () => {
    const ui = renderUI();
    ui.setRecordingState(true);
    ui.setPausedState(true);

    expect($('statusText').textContent).toBe('Paused');
    expect($('pauseBtnText').textContent).toBe('Resume');
    expect($('pauseBtn').title).toContain('Resume');
    expect($('statusDot').classList.contains('is-paused')).toBe(true);
  });

  it('swaps the button glyph between pause and resume', () => {
    const ui = renderUI();
    ui.setRecordingState(true);

    const icon = document.getElementById('pauseBtnIcon')!;
    ui.setPausedState(true);
    expect(icon.getAttribute('href')).toBe('./icons.svg#icon-record');
    ui.setPausedState(false);
    expect(icon.getAttribute('href')).toBe('./icons.svg#icon-pause');
  });

  it('clears the paused presentation when recording stops', () => {
    const ui = renderUI();
    ui.setRecordingState(true);
    ui.setPausedState(true);
    ui.setRecordingState(false);

    expect($('statusDot').classList.contains('is-paused')).toBe(false);
    expect($('pauseBtnText').textContent).toBe('Pause');
  });

  it('clears the paused presentation when a new recording starts', () => {
    const ui = renderUI();
    ui.setRecordingState(true);
    ui.setPausedState(true);
    ui.setRecordingState(false);
    ui.setRecordingState(true);

    expect($('statusDot').classList.contains('is-paused')).toBe(false);
    expect($('statusText').textContent).toBe('Recording...');
  });
});

describe('UIManager quality settings', () => {
  it('starts on Auto for all three', () => {
    const ui = renderUI();
    ui.populateQuality();

    expect(ui.getQuality()).toEqual({
      width: undefined,
      frameRate: undefined,
      videoBitsPerSecond: undefined,
    });
  });

  it('reads each preset back as its value', () => {
    const ui = renderUI();
    ui.populateQuality();
    ($('resolutionSelect') as HTMLSelectElement).value = '720p';
    ($('frameRateSelect') as HTMLSelectElement).value = '30';
    ($('bitrateSelect') as HTMLSelectElement).value = 'medium';

    expect(ui.getQuality()).toEqual({
      width: 1280,
      frameRate: 30,
      videoBitsPerSecond: 6_000_000,
    });
  });

  it('summarises the settings in plain language', () => {
    const ui = renderUI();
    ui.populateQuality();

    expect($('qualitySummary').textContent).toBe(
      'source res · source fps · auto bitrate'
    );
  });

  it('refreshes the summary when a preset changes', () => {
    const ui = renderUI();
    ui.populateQuality();
    ($('resolutionSelect') as HTMLSelectElement).value = '480p';
    $('resolutionSelect').dispatchEvent(new Event('change'));

    expect($('qualitySummary').textContent).toContain('854w');
  });

  it('locks resolution and frame rate while sharing', () => {
    // These live in the track, so changing them mid-share would silently do
    // nothing - locking is what stops the UI lying about that.
    const ui = renderUI();
    ui.populateQuality();
    ui.setSharingState(true);

    expect(($('resolutionSelect') as HTMLSelectElement).disabled).toBe(true);
    expect(($('frameRateSelect') as HTMLSelectElement).disabled).toBe(true);
  });

  it('leaves the bitrate live while sharing', () => {
    // The opposite of the capture settings: the bitrate is an encoder setting
    // and can take effect on the next take without re-sharing.
    const ui = renderUI();
    ui.populateQuality();
    ui.setSharingState(true);

    expect(($('bitrateSelect') as HTMLSelectElement).disabled).toBe(false);
  });

  it('unlocks the capture settings again when sharing stops', () => {
    const ui = renderUI();
    ui.populateQuality();
    ui.setSharingState(true);
    ui.setSharingState(false);

    expect(($('resolutionSelect') as HTMLSelectElement).disabled).toBe(false);
    expect(($('frameRateSelect') as HTMLSelectElement).disabled).toBe(false);
  });

  it('offers every preset as an option', () => {
    const ui = renderUI();
    ui.populateQuality();

    const count = (id: string) => ($(id) as HTMLSelectElement).options.length;
    expect(count('resolutionSelect')).toBe(4);
    expect(count('frameRateSelect')).toBe(4);
    expect(count('bitrateSelect')).toBe(4);
  });
});

describe('UIManager volume faders', () => {
  it('reads each fader as a gain multiplier', () => {
    const ui = renderUI();
    ($('systemVolume') as HTMLInputElement).value = '50';
    ($('micVolume') as HTMLInputElement).value = '25';

    expect(ui.getVolume('system')).toBe(0.5);
    expect(ui.getVolume('mic')).toBe(0.25);
  });

  it('treats a fader at full as unity gain', () => {
    expect(renderUI().getVolume('system')).toBe(1);
  });

  it('exposes silence at the bottom of the travel', () => {
    const ui = renderUI();
    ($('systemVolume') as HTMLInputElement).value = '0';
    expect(ui.getVolume('system')).toBe(0);
  });

  it('mirrors the fader value as a percentage', () => {
    const ui = renderUI();
    ui.bindVolumeControls(() => {});

    expect($('systemVolumeValue').textContent).toBe('100%');
    expect($('micVolumeValue').textContent).toBe('100%');

    ($('systemVolume') as HTMLInputElement).value = '37';
    $('systemVolume').dispatchEvent(new Event('input'));

    expect($('systemVolumeValue').textContent).toBe('37%');
  });

  it('reports which source moved', () => {
    const ui = renderUI();
    const seen: string[] = [];
    ui.bindVolumeControls((source) => seen.push(source));

    // The initial sync fires once per source, then only the moved one.
    expect(seen).toEqual(['system', 'mic']);

    $('micVolume').dispatchEvent(new Event('input'));
    expect(seen.at(-1)).toBe('mic');

    $('systemVolume').dispatchEvent(new Event('input'));
    expect(seen.at(-1)).toBe('system');
  });

  it('does not confuse the two faders', () => {
    const ui = renderUI();
    ($('micVolume') as HTMLInputElement).value = '10';

    expect(ui.getVolume('system')).toBe(1);
    expect(ui.getVolume('mic')).toBe(0.1);
  });
});

describe('UIManager.getMicOptions', () => {
  it('defaults to every conditioner on', () => {
    // jsdom preserves the `checked` attribute the fixture sets.
    const ui = renderUI();

    expect(ui.getMicOptions()).toEqual({
      enabled: false,
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
    });
  });

  it('follows the microphone toggle and each conditioner', () => {
    const ui = renderUI();
    ($('micAudioToggle') as HTMLInputElement).checked = true;
    ($('micNoiseSuppression') as HTMLInputElement).checked = false;
    ($('micEchoCancellation') as HTMLInputElement).checked = true;
    ($('micAutoGain') as HTMLInputElement).checked = false;

    expect(ui.getMicOptions()).toEqual({
      enabled: true,
      noiseSuppression: false,
      echoCancellation: true,
      autoGainControl: false,
    });
  });

  it('locks the conditioners while a capture is live', () => {
    const ui = renderUI();
    ui.setSharingState(true);

    for (const id of [
      'micNoiseSuppression',
      'micEchoCancellation',
      'micAutoGain',
    ]) {
      expect(($(id) as HTMLInputElement).disabled).toBe(true);
    }
  });

  it('unlocks them again when sharing stops', () => {
    const ui = renderUI();
    ui.setSharingState(true);
    ui.setSharingState(false);

    for (const id of [
      'micNoiseSuppression',
      'micEchoCancellation',
      'micAutoGain',
    ]) {
      expect(($(id) as HTMLInputElement).disabled).toBe(false);
    }
  });
});

describe('UIManager recording stats', () => {
  it('shows the running length and size together', () => {
    const ui = renderUI();
    ui.updateStats('00:42', '12.5 MB');

    expect($('statsText').textContent).toBe('00:42 · 12.5 MB');
  });

  it('clears the stats when recording stops', () => {
    const ui = renderUI();
    ui.updateStats('00:42', '12.5 MB');
    ui.setRecordingState(false);

    expect($('statsText').textContent).toBe('');
  });

  it('clears stale stats before a new take starts', () => {
    const ui = renderUI();
    ui.setRecordingState(true);
    ui.updateStats('05:00', '900 MB');
    ui.setRecordingState(false);
    ui.setRecordingState(true);

    expect($('statsText').textContent).toBe('');
  });

  it('overwrites rather than appends as the recording grows', () => {
    const ui = renderUI();
    ui.updateStats('00:01', '1.0 KB');
    ui.updateStats('00:02', '2.0 KB');

    expect($('statsText').textContent).toBe('00:02 · 2.0 KB');
  });
});

describe('UIManager.toggleCropping', () => {
  it('reveals and hides the crop overlay pieces together', () => {
    const ui = renderUI();

    ui.toggleCropping(true);
    expect($('cropContainer').classList.contains('hidden')).toBe(false);
    expect($('cropTargetElement').classList.contains('hidden')).toBe(false);

    ui.toggleCropping(false);
    expect($('cropContainer').classList.contains('hidden')).toBe(true);
    expect($('cropTargetElement').classList.contains('hidden')).toBe(true);
  });
});
