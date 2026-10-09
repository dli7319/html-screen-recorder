import { afterEach, describe, expect, it, vi } from 'vitest';
import { UIManager } from './ui-manager';

/**
 * The exact element ids UIManager looks up in its constructor. Keeping the
 * fixture explicit means a renamed id fails here instead of silently turning
 * into `null` at runtime.
 *
 * Capture settings are deliberately absent: they belong to SettingsPanel and
 * are covered in settings-panel.test.ts.
 */
function renderUI(): UIManager {
  document.body.innerHTML = `
    <div id="videoContainer">
      <video id="videoPreview"></video>
      <div id="placeholder">
        <button id="emptyShareBtn">Share screen</button>
      </div>
    </div>
    <div id="cropBox"></div>
    <div id="cropTargetElement"></div>
    <div id="cropContainer" class="hidden"></div>
    <input type="checkbox" id="cropCheckbox" />
    <div id="transport" data-phase="idle">
      <button id="shareBtn">
        <span id="shareBtnStart"></span>
        <span id="shareBtnStop" class="hidden"></span>
      </button>
      <button id="recordBtn"><span id="recordBtnText">Start Recording</span></button>
      <button id="stopBtn"></button>
      <button id="screenshotBtn" disabled></button>
    </div>
    <div id="settingsScrim"></div>
    <aside id="settingsDrawer"></aside>
    <button id="openSettings"></button>
    <button id="settingsChip"></button>
    <button id="closeSettings"></button>
    <button id="advToggle"></button>
    <button id="pipBtn" disabled class="hidden">
      <span id="pipBtnText">Pop out</span>
    </button>
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
    <div id="countdownOverlay" class="hidden">
      <span id="countdownNumber"></span>
    </div>
    <div id="systemAudioVisualizer"></div>
    <div id="micAudioVisualizer"></div>
  `;
  return new UIManager();
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;

afterEach(() => {
  document.body.innerHTML = '';
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
  it('arms the record button and the crop opt-in', () => {
    const ui = renderUI();
    ui.setSharingState(true);

    expect(($('recordBtn') as HTMLButtonElement).disabled).toBe(false);
    expect(($('cropCheckbox') as HTMLInputElement).disabled).toBe(false);
    expect($('placeholder').classList.contains('hidden')).toBe(true);
    expect($('shareBtnStop').classList.contains('hidden')).toBe(false);
    expect($('shareBtnStart').classList.contains('hidden')).toBe(true);
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
  });
});

describe('UIManager.setRecordingState', () => {
  it('locks sharing and cropping while recording', () => {
    const ui = renderUI();
    const cropCheckbox = $('cropCheckbox') as HTMLInputElement;
    cropCheckbox.checked = true;

    ui.setRecordingState(true);

    expect($('status').classList.contains('hidden')).toBe(false);
    expect($('status').dataset.state).toBe('recording');
    expect($('transport').dataset.phase).toBe('recording');
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

    // The pill is no longer hidden when recording stops: it answers "what is
    // the app doing" precisely when nothing is happening, so it stays visible
    // and reports the phase it fell back to.
    expect($('status').classList.contains('hidden')).toBe(false);
    expect($('status').dataset.state).toBe('sharing');
    expect($('transport').dataset.phase).toBe('sharing');
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

  it('routes stopwatch text into the record button', () => {
    const ui = renderUI();
    ui.updateStopwatch('00:31');
    expect($('recordBtnText').textContent).toBe('00:31');
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

describe('UIManager errors', () => {
  it('shows and hides the error banner together with its message', () => {
    const ui = renderUI();
    ui.showError('boom');

    expect($('error').textContent).toBe('boom');
    expect($('error').classList.contains('hidden')).toBe(false);

    ui.hideError();
    expect($('error').textContent).toBe('');
    expect($('error').classList.contains('hidden')).toBe(true);
  });

  it('can disable sharing outright', () => {
    const ui = renderUI();
    ui.disableShareBtn();

    expect(($('shareBtn') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('UIManager.updateAudioLevel', () => {
  it('clamps audio levels into the visualizer range', () => {
    const ui = renderUI();
    ui.updateAudioLevel('system', 0.42);
    expect($('systemAudioVisualizer').style.width).toBe('42%');

    ui.updateAudioLevel('mic', 5);
    expect($('micAudioVisualizer').style.width).toBe('100%');

    ui.updateAudioLevel('mic', -1);
    expect($('micAudioVisualizer').style.width).toBe('0%');
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

describe('UIManager screenshot button', () => {
  it('stays disabled until something is shared', () => {
    renderUI();
    expect(($('screenshotBtn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('arms once there is a frame to capture', () => {
    const ui = renderUI();
    ui.setSharingState(true);

    expect(($('screenshotBtn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('disarms again when sharing stops', () => {
    const ui = renderUI();
    ui.setSharingState(true);
    ui.setSharingState(false);

    expect(($('screenshotBtn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('stays available while recording', () => {
    // Grabbing a still mid-take is exactly when you want it.
    const ui = renderUI();
    ui.setSharingState(true);
    ui.setRecordingState(true);

    expect(($('screenshotBtn') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('UIManager picture-in-picture button', () => {
  it('appears only once there is a preview to pop out', () => {
    const ui = renderUI();
    expect($('pipBtn').classList.contains('hidden')).toBe(true);

    ui.setSharingState(true);
    expect($('pipBtn').classList.contains('hidden')).toBe(false);
  });

  it('reads "Pop out" when nothing is floating', () => {
    const ui = renderUI();
    ui.setPipState(false);

    expect($('pipBtnText').textContent).toBe('Pop out');
    expect($('pipBtn').title).toContain('floating window');
  });

  it('reads "Close" while the preview is floating', () => {
    const ui = renderUI();
    ui.setPipState(true);

    expect($('pipBtnText').textContent).toBe('Close');
    expect($('pipBtn').title).toContain('Close');
  });

  it('goes away when sharing stops', () => {
    const ui = renderUI();
    ui.setSharingState(true);
    ui.setSharingState(false);

    expect($('pipBtn').classList.contains('hidden')).toBe(true);
    expect(($('pipBtn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('records whether the browser supports it', () => {
    const ui = renderUI();
    ui.setPipSupported(false);

    expect($('pipBtn').dataset.supported).toBe('false');
    ui.setPipSupported(true);
    expect($('pipBtn').dataset.supported).toBe('true');
  });
});

describe('UIManager countdown presentation', () => {
  it('shows the overlay and offers a way out', () => {
    const ui = renderUI();
    ui.setCountdownState(true);

    expect($('countdownOverlay').classList.contains('hidden')).toBe(false);
    expect($('recordBtnText').textContent).toBe('Cancel');
    expect(($('recordBtn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders the number being counted', () => {
    const ui = renderUI();
    ui.setCountdownState(true);
    ui.showCountdown(3);

    expect($('countdownNumber').textContent).toBe('3');
  });

  it('clears the overlay and restores the label when it ends', () => {
    const ui = renderUI();
    ui.setCountdownState(true);
    ui.showCountdown(2);
    ui.setCountdownState(false);
    ui.hideCountdown();

    expect($('countdownOverlay').classList.contains('hidden')).toBe(true);
    expect($('countdownNumber').textContent).toBe('');
    expect($('recordBtn').title).toContain('Start Recording');
  });

  it('is safe to hide when nothing is counting', () => {
    const ui = renderUI();
    expect(() => ui.hideCountdown()).not.toThrow();
  });
});

describe('UIManager.bindEvents', () => {
  it('binds its callbacks to the matching controls', () => {
    const ui = renderUI();
    const onShare = vi.fn();
    const onRecord = vi.fn();
    const onStop = vi.fn();
    const onCropToggle = vi.fn();
    const onPause = vi.fn();
    const onScreenshot = vi.fn();
    const onPip = vi.fn();
    ui.bindEvents({
      onShare,
      onRecord,
      onStop,
      onCropToggle,
      onPause,
      onScreenshot,
      onPip,
    });

    // Disabled buttons do not fire click in jsdom, matching real browsers.
    ($('screenshotBtn') as HTMLButtonElement).disabled = false;
    ($('pipBtn') as HTMLButtonElement).disabled = false;

    $('shareBtn').click();
    $('recordBtn').click();
    $('stopBtn').click();
    $('pauseBtn').click();
    $('screenshotBtn').click();
    $('pipBtn').click();
    $('cropCheckbox').dispatchEvent(new Event('change'));

    expect(onShare).toHaveBeenCalledOnce();
    expect(onRecord).toHaveBeenCalledOnce();
    expect(onStop).toHaveBeenCalledOnce();
    expect(onCropToggle).toHaveBeenCalledOnce();
    expect(onPause).toHaveBeenCalledOnce();
    expect(onScreenshot).toHaveBeenCalledOnce();
    expect(onPip).toHaveBeenCalledOnce();
  });
});

describe('UIManager tab title', () => {
  it('marks the tab while recording', () => {
    const ui = renderUI();
    ui.setRecordingState(true);
    expect(document.title).toContain('Recording');
    expect(document.title).toContain('Screen Recorder');
  });

  it('shows the running time in the tab', () => {
    const ui = renderUI();
    ui.setRecordingState(true);
    ui.updateStats('00:36', '1.2 MB');
    expect(document.title).toContain('Recording');
    expect(document.title).toContain('00:36');
  });

  it('marks the tab as paused', () => {
    const ui = renderUI();
    ui.setRecordingState(true);
    ui.setPausedState(true);
    expect(document.title).toContain('Paused');
    expect(document.title).toContain('Screen Recorder');
  });

  it('clears the marker once the take stops', () => {
    const ui = renderUI();
    ui.setRecordingState(true);
    ui.updateStats('00:10', '1 KB');
    ui.setRecordingState(false);
    expect(document.title).toBe('Screen Recorder');
  });
});
