import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end flows in a real browser.
 *
 * `getDisplayMedia` cannot be automated headlessly (it needs a real screen-share
 * prompt), so we stub it to an animated canvas stream. That makes MediaRecorder
 * record a *real* clip from a deterministic source, so the whole Share → Record
 * → Stop → gallery path runs for real - including the IndexedDB persistence the
 * jsdom unit tests can't exercise.
 */
async function stubDisplayMedia(
  page: Page,
  recordOnShare = false
): Promise<void> {
  // Pin the record-on-share preference so runs are deterministic: the manual
  // Share -> Record tests get it OFF, and the auto-record tests below flip it ON.
  await page.addInitScript((on: boolean) => {
    localStorage.setItem(
      'html-screen-recorder:recordOnShare',
      on ? 'true' : 'false'
    );
  }, recordOnShare);
  await page.addInitScript(() => {
    const install = (): void => {
      if (!navigator.mediaDevices) return;
      navigator.mediaDevices.getDisplayMedia =
        async (): Promise<MediaStream> => {
          const canvas = document.createElement('canvas');
          canvas.width = 640;
          canvas.height = 360;
          const ctx = canvas.getContext('2d');
          let t = 0;
          const draw = (): void => {
            if (ctx) {
              ctx.fillStyle = `hsl(${t++ % 360}, 70%, 50%)`;
              ctx.fillRect(0, 0, 640, 360);
            }
            requestAnimationFrame(draw);
          };
          draw();
          return canvas.captureStream(30);
        };
    };
    install();
  });
}

test('records a clip into the gallery and it survives a reload', async ({
  page,
}) => {
  await stubDisplayMedia(page);
  await page.goto('/');

  await page.click('#shareBtn');
  await page.click('#recordBtn');
  // Give MediaRecorder a moment to capture before stopping.
  await page.waitForTimeout(1500);
  await page.click('#stopBtn');

  const rows = page.locator('#takeList [data-take-id]');
  await expect(rows).toHaveCount(1);
  await expect(page.locator('#takeCount')).toContainText('1');

  // The take is cached on-device: it must still be here after a full reload.
  await page.reload();
  await expect(page.locator('#takeList [data-take-id]')).toHaveCount(1);
});

test('starts recording on share by default, without a second click', async ({
  page,
}) => {
  await stubDisplayMedia(page, true); // record-on-share ON
  await page.goto('/');

  // Share alone - never touch Record - and capture is already under way.
  await page.click('#shareBtn');
  await expect(page.locator('#recordBtn')).toBeDisabled();

  await page.waitForTimeout(1200);
  await page.click('#stopBtn');
  // A clip landed without a manual Record click.
  await expect(page.locator('#takeList [data-take-id]')).toHaveCount(1);
});

test('leaves recording manual when record-on-share is off', async ({
  page,
}) => {
  await stubDisplayMedia(page, false);
  await page.goto('/');

  await page.click('#shareBtn');
  // Share alone did not start capture: Record is still there to press by hand.
  await expect(page.locator('#recordBtn')).toBeEnabled();
  await page.click('#recordBtn');
  await expect(page.locator('#recordBtn')).toBeDisabled();
  await page.click('#stopBtn');
  await expect(page.locator('#takeList [data-take-id]')).toHaveCount(1);
});

test('captures a screenshot into the gallery', async ({ page }) => {
  await stubDisplayMedia(page);
  await page.goto('/');

  await page.click('#shareBtn');
  await page.click('#screenshotBtn');

  const rows = page.locator('#takeList [data-take-id]');
  await expect(rows).toHaveCount(1);
  // A screenshot row carries its size, not a duration.
  await expect(rows.first()).toContainText('PNG');
});

test('opens a take in the preview modal', async ({ page }) => {
  await stubDisplayMedia(page);
  await page.goto('/');

  await page.click('#shareBtn');
  await page.click('#screenshotBtn');
  await expect(page.locator('#takeList [data-take-id]')).toHaveCount(1);

  await page.click('#takeList .take-thumb');
  await expect(page.locator('#previewModal')).toBeVisible();
  await expect(page.locator('#previewClose')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-preview', 'open');
});

/** Arm a 3-second countdown through the settings drawer. */
async function armCountdown(page: Page): Promise<void> {
  await page.click('#openSettings');
  await page.selectOption('#countdownSelect', '3');
  await page.click('#closeSettings');
}

test('counts down before a recording and cancels from the Record button', async ({
  page,
}) => {
  await stubDisplayMedia(page);
  await page.goto('/');
  await armCountdown(page);

  await page.click('#shareBtn');
  await page.click('#recordBtn');

  // The count is on screen where the capture will land, and the button that
  // started it becomes the way to call it off.
  await expect(page.locator('#countdownOverlay')).toBeVisible();
  await expect(page.locator('#countdownNumber')).toHaveText('3');
  await expect(page.locator('#recordBtnText')).toHaveText('Cancel');
  await expect(page.locator('#countdownNumber')).toHaveText('2', {
    timeout: 2500,
  });

  // Cancel mid-count: the overlay clears, the button reads as Record again,
  // and the state a cancel leaves behind is clean.
  await page.click('#recordBtn');
  await expect(page.locator('#countdownOverlay')).toBeHidden();
  await expect(page.locator('#recordBtnText')).toHaveText('Start Recording');

  // Nothing was captured: no take lands now, and none lands late - waiting
  // past the abandoned count must not resurrect it into a recording.
  await page.waitForTimeout(3500);
  await expect(page.locator('#takeList [data-take-id]')).toHaveCount(0);
  await expect(page.locator('#statusText')).toHaveText('Sharing');
});

test('Escape during a countdown cancels the count and leaves the dialog for the next press', async ({
  page,
}) => {
  await stubDisplayMedia(page);
  await page.goto('/');
  await armCountdown(page);

  await page.click('#shareBtn');
  await page.click('#recordBtn');
  await expect(page.locator('#countdownNumber')).toHaveText('3');

  // A dialog is up while the count runs - exactly when one Escape used to do
  // two jobs at once, closing the drawer and killing the 3-2-1 as collateral.
  await page.click('#openSettings');
  await expect(page.locator('body')).toHaveAttribute('data-panel', 'open');

  await page.keyboard.press('Escape');
  // The first press belongs to the countdown...
  await expect(page.locator('#countdownOverlay')).toBeHidden();
  await expect(page.locator('#recordBtnText')).toHaveText('Start Recording');
  // ...and the drawer waits for the next one.
  await expect(page.locator('body')).toHaveAttribute('data-panel', 'open');

  // The cancelled count never turns into a recording.
  await page.waitForTimeout(3500);
  await expect(page.locator('#takeList [data-take-id]')).toHaveCount(0);
  await expect(page.locator('#statusText')).toHaveText('Sharing');

  // The second press closes the drawer.
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveAttribute('data-panel', 'open');
});

test('a finished countdown starts the recording with the count left out of its length', async ({
  page,
}) => {
  await stubDisplayMedia(page);
  await page.goto('/');
  await armCountdown(page);

  await page.click('#shareBtn');
  const pressedAt = Date.now();
  await page.click('#recordBtn');

  // The count really runs before capture: the take must not be recording
  // while the overlay is up.
  await expect(page.locator('#countdownOverlay')).toBeVisible();
  await expect(page.locator('#statusText')).toHaveText('Sharing');
  await expect(page.locator('#statusText')).toHaveText(/^Recording/, {
    timeout: 8000,
  });
  await expect(page.locator('#countdownOverlay')).toBeHidden();
  expect(Date.now() - pressedAt).toBeGreaterThanOrEqual(2500);

  // Capture for a moment after the count, then stop.
  await page.waitForTimeout(1500);
  await page.click('#stopBtn');
  const wallSeconds = (Date.now() - pressedAt) / 1000;

  // The 3-second count is not part of the take: the reported length tracks
  // the captured time, lagging the wall clock by roughly the countdown.
  const rows = page.locator('#takeList [data-take-id]');
  await expect(rows).toHaveCount(1);
  const meta = rows.first().locator('p.text-xs');
  const shown = /(\d+):(\d\d)/.exec((await meta.textContent()) ?? '');
  expect(shown).not.toBeNull();
  const reported =
    Number((shown as RegExpExecArray)[1]) * 60 +
    Number((shown as RegExpExecArray)[2]);
  expect(reported).toBeGreaterThanOrEqual(1);
  expect(reported).toBeLessThanOrEqual(4);
  expect(wallSeconds - reported).toBeGreaterThan(2);
});

/** Row ids in the order the gallery currently renders them. */
function rowIds(page: Page) {
  return page
    .locator('#takeList [data-take-id]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-take-id')));
}

test('filters the gallery down to one kind of take', async ({ page }) => {
  await stubDisplayMedia(page);
  await page.goto('/');

  await page.click('#shareBtn');
  await page.click('#recordBtn');
  await page.waitForTimeout(1500);
  await page.click('#stopBtn');
  const rows = page.locator('#takeList [data-take-id]');
  await expect(rows).toHaveCount(1);
  const clipId = (await rowIds(page))[0];

  // A beat between captures keeps their timestamps - and so the sort - apart.
  await page.click('#screenshotBtn');
  await expect(rows).toHaveCount(2);
  await page.waitForTimeout(25);
  await page.click('#screenshotBtn');
  await expect(rows).toHaveCount(3);
  const stillIds = (await rowIds(page)).filter((id) => id !== clipId);
  expect(stillIds).toHaveLength(2);

  // Recordings only: just the clip row, and the pressed chip follows along.
  await page.click('.filter-chip[data-filter="recording"]');
  await expect(rows).toHaveCount(1);
  expect(await rowIds(page)).toEqual([clipId]);
  await expect(
    page.locator('.filter-chip[data-filter="recording"]')
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.locator('.filter-chip[data-filter="screenshot"]')
  ).toHaveAttribute('aria-pressed', 'false');

  // Screenshots only: the two stills.
  await page.click('.filter-chip[data-filter="screenshot"]');
  await expect(rows).toHaveCount(2);
  expect(new Set(await rowIds(page))).toEqual(new Set(stillIds));
  await expect(
    page.locator('.filter-chip[data-filter="screenshot"]')
  ).toHaveAttribute('aria-pressed', 'true');

  // Back to the whole gallery.
  await page.click('.filter-chip[data-filter="all"]');
  await expect(rows).toHaveCount(3);
  await expect(page.locator('.filter-chip[data-filter="all"]')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

test('toggles the gallery between newest-first and oldest-first', async ({
  page,
}) => {
  await stubDisplayMedia(page);
  await page.goto('/');

  // Capture in a known order: clip, then two stills.
  await page.click('#shareBtn');
  await page.click('#recordBtn');
  await page.waitForTimeout(1500);
  await page.click('#stopBtn');
  const rows = page.locator('#takeList [data-take-id]');
  await expect(rows).toHaveCount(1);
  const createdIds = [(await rowIds(page))[0]];
  for (let i = 0; i < 2; i++) {
    await page.waitForTimeout(25);
    await page.click('#screenshotBtn');
    await expect(rows).toHaveCount(createdIds.length + 1);
    const id = (await rowIds(page)).find((x) => !createdIds.includes(x));
    expect(id).toBeTruthy();
    createdIds.push(id as string);
  }

  // The default is newest first, so the creation order runs backwards.
  await expect(page.locator('#sortTakesBtn')).toHaveText('Newest first');
  expect(await rowIds(page)).toEqual([...createdIds].reverse());

  await page.click('#sortTakesBtn');
  await expect(page.locator('#sortTakesBtn')).toHaveText('Oldest first');
  expect(await rowIds(page)).toEqual(createdIds);

  await page.click('#sortTakesBtn');
  await expect(page.locator('#sortTakesBtn')).toHaveText('Newest first');
  expect(await rowIds(page)).toEqual([...createdIds].reverse());
});

test('the preview frame hugs the shared surface instead of letterboxing', async ({
  page,
}) => {
  await stubDisplayMedia(page);
  await page.goto('/');

  await page.click('#shareBtn');
  await page.waitForFunction(() => {
    const v = document.getElementById(
      'videoPreview'
    ) as HTMLVideoElement | null;
    return Boolean(v && v.videoWidth === 640);
  });

  // The stub shares a 640x360 canvas, so the frame must take exactly that
  // shape. It used to stretch to the stage width and letterbox the picture
  // inside, leaving a band of empty frame on either side.
  const boxRatio = async (): Promise<number> => {
    const box = await page.locator('#videoContainer').boundingBox();
    if (!box) throw new Error('preview frame has no box');
    return box.width / box.height;
  };
  expect(await boxRatio()).toBeCloseTo(640 / 360, 1);

  // On a narrow viewport the width binds instead of the height. Same shape.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(250);
  expect(await boxRatio()).toBeCloseTo(640 / 360, 1);
});

test('renames a take from the preview dialog', async ({ page }) => {
  await stubDisplayMedia(page);
  await page.goto('/');

  await page.click('#shareBtn');
  await page.click('#screenshotBtn');
  const rows = page.locator('#takeList [data-take-id]');
  await expect(rows).toHaveCount(1);

  await page.click('#takeList .take-thumb');
  await expect(page.locator('#previewModal')).toBeVisible();
  const title = page.locator('#previewTitle');
  const original = (await title.textContent()) ?? '';
  expect(original).toMatch(/\.png$/);

  // Commit a rename without typing an extension: the dialog title, the toast,
  // and the gallery row all follow, and the extension is kept.
  await page.click('#previewRename');
  await page.fill('#previewRenameInput', 'demo');
  await page.press('#previewRenameInput', 'Enter');
  await expect(title).toHaveText('demo.png');
  await expect(page.locator('#toastText')).toHaveText('Renamed to demo.png');
  await expect(rows.first()).toContainText('demo.png');
  await expect(page.locator('#takeList .take-thumb')).toHaveAttribute(
    'aria-label',
    'Preview demo.png'
  );
  await expect(page.locator('#previewRenameInput')).toBeHidden();

  // Escape backs out of a rename without touching the take.
  await page.click('#previewRename');
  await page.fill('#previewRenameInput', 'nope');
  await page.press('#previewRenameInput', 'Escape');
  await expect(title).toHaveText('demo.png');
  await expect(rows.first()).toContainText('demo.png');
  await expect(page.locator('#previewRenameInput')).toBeHidden();

  // The new name is written through to the on-device cache, so it survives a
  // reload - in the row and in the reopened dialog.
  await page.reload();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('demo.png');
  await page.click('#takeList .take-thumb');
  await expect(page.locator('#previewTitle')).toHaveText('demo.png');
});

test('confirms a saved take and jumps to its row on demand', async ({
  page,
}) => {
  await stubDisplayMedia(page);
  await page.goto('/');

  await page.click('#shareBtn');
  await page.click('#recordBtn');
  await page.waitForTimeout(1500);
  await page.click('#stopBtn');

  // Stopping is the app's one big success and it used to report nothing. Now
  // the toast names the take, says where it went, and offers the jump.
  const rows = page.locator('#takeList [data-take-id]');
  await expect(rows).toHaveCount(1);
  await expect(page.locator('#toastText')).toHaveText(/^Saved .+ to Takes$/);
  await expect(page.locator('#toastAction')).toHaveText('View');

  // "View" marks the row it means and puts it on screen.
  await page.click('#toastAction');
  await expect(rows.first()).toHaveClass(/is-fresh/);
  const box = await rows.first().boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error('row or viewport has no box');
  // On screen, give or take a sub-pixel of layout rounding.
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);

  // A screenshot is confirmed the same way.
  await page.click('#screenshotBtn');
  await expect(page.locator('#toastText')).toHaveText(
    /^Saved .+\.png to Takes$/
  );
  await expect(page.locator('#toastAction')).toHaveText('View');
});

test('undo puts a removed take back in its own slot and it survives a reload', async ({
  page,
}) => {
  await stubDisplayMedia(page);
  await page.goto('/');

  // Three stills in a known creation order (the default view is newest first).
  await page.click('#shareBtn');
  const rows = page.locator('#takeList [data-take-id]');
  const createdIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(25);
    await page.click('#screenshotBtn');
    await expect(rows).toHaveCount(createdIds.length + 1);
    const id = (await rowIds(page)).find(
      (x) => x !== null && !createdIds.includes(x)
    );
    expect(id).toBeTruthy();
    createdIds.push(id as string);
  }
  const shown = [...createdIds].reverse();
  expect(await rowIds(page)).toEqual(shown);

  // Remove the middle row: the toast names it and offers the undo.
  const gone = shown[1];
  await rows.nth(1).locator('button', { hasText: 'Remove' }).click();
  await expect(page.locator('#toastText')).toHaveText(/^Removed .+\.png$/);
  await expect(page.locator('#toastAction')).toHaveText('Undo');
  expect(await rowIds(page)).toEqual([shown[0], shown[2]]);

  // Undo must be an exact put-back - the same id in the same slot - not a
  // fresh re-add with a new id at the front.
  await page.click('#toastAction');
  expect(await rowIds(page)).toEqual(shown);
  expect((await rowIds(page)).filter((id) => id === gone)).toHaveLength(1);

  // The put-back is written through to the on-device cache, so the whole
  // gallery - restored take included - is still in the same order after a
  // full reload.
  await page.reload();
  expect(await rowIds(page)).toEqual(shown);
});

test('a removal the user keeps is gone for good after a reload', async ({
  page,
}) => {
  await stubDisplayMedia(page);
  await page.goto('/');

  await page.click('#shareBtn');
  const rows = page.locator('#takeList [data-take-id]');
  const createdIds: string[] = [];
  for (let i = 0; i < 2; i++) {
    await page.waitForTimeout(25);
    await page.click('#screenshotBtn');
    await expect(rows).toHaveCount(createdIds.length + 1);
    const id = (await rowIds(page)).find(
      (x) => x !== null && !createdIds.includes(x)
    );
    expect(id).toBeTruthy();
    createdIds.push(id as string);
  }
  const shown = [...createdIds].reverse();
  expect(await rowIds(page)).toEqual(shown);

  // Remove the newest row and simply let the Undo offer expire.
  await rows.first().locator('button', { hasText: 'Remove' }).click();
  await expect(page.locator('#toastText')).toHaveText(/^Removed .+\.png$/);
  await expect(rows).toHaveCount(1);
  expect(await rowIds(page)).toEqual([shown[1]]);

  // The removal reached the cache, so the take does not come back on reload.
  await page.reload();
  await expect(rows).toHaveCount(1);
  expect(await rowIds(page)).toEqual([shown[1]]);
});

test('pausing freezes the clock and the saved take leaves the paused time out', async ({
  page,
}) => {
  await stubDisplayMedia(page);
  await page.goto('/');

  await page.click('#shareBtn');
  const startedAt = Date.now();
  await page.click('#recordBtn');

  // Let the stopwatch tick before pausing so there is a reading to freeze.
  await page.waitForTimeout(1300);

  // The Pause control is armed for the running take and clickable - it used
  // to stay hidden for the whole recording, leaving pause keyboard-only.
  await expect(page.locator('#pauseBtn')).toBeVisible();
  await expect(page.locator('#pauseBtn')).toBeEnabled();

  // Pause surfaces the state on every control that tracks the phase.
  await page.click('#pauseBtn');
  await expect(page.locator('#pauseBtnText')).toHaveText('Resume');
  await expect(page.locator('#statusText')).toHaveText('Paused');
  await expect(page.locator('#statusDot')).toHaveClass(/is-paused/);
  await expect(page).toHaveTitle(/Paused/);

  // The clock is frozen: the reading in the Record button must not move at
  // all across the pause, however long the pause lasts.
  const clock = page.locator('#recordBtnText');
  const frozen = await clock.textContent();
  await page.waitForTimeout(4000);
  expect(await clock.textContent()).toBe(frozen);

  // Resume: the label falls back and the clock runs again. The readout ticks
  // once a second, so give it room for the next tick to land.
  await page.click('#pauseBtn');
  await expect(page.locator('#pauseBtnText')).toHaveText('Pause');
  await expect(page.locator('#statusText')).toHaveText('Recording...');
  await expect(page.locator('#statusDot')).not.toHaveClass(/is-paused/);
  const before = await clock.textContent();
  await expect(clock).not.toHaveText(before ?? '', { timeout: 6000 });

  await page.click('#stopBtn');
  const wallSeconds = (Date.now() - startedAt) / 1000;

  // The take reports only the time actually captured. The clock was frozen
  // for 4s, so the reported length must lag the wall clock by roughly that
  // much - a stopwatch that counted paused time would keep up with it.
  // Parse the meta line, not the row: textContent glues the timestamp
  // filename to the meta ("...mp400:01..."), which fools a colon regex.
  const rows = page.locator('#takeList [data-take-id]');
  await expect(rows).toHaveCount(1);
  const meta = rows.first().locator('p.text-xs');
  const shown = /(\d+):(\d\d)/.exec((await meta.textContent()) ?? '');
  expect(shown).not.toBeNull();
  const reported =
    Number((shown as RegExpExecArray)[1]) * 60 +
    Number((shown as RegExpExecArray)[2]);
  expect(reported).toBeGreaterThanOrEqual(1);
  expect(reported).toBeLessThanOrEqual(6);
  expect(wallSeconds - reported).toBeGreaterThan(2);

  // The exclusion reaches the file, not just the label: the repaired clip
  // plays for the captured length, not the wall clock.
  await page.click('#takeList .take-thumb');
  await expect(page.locator('#previewModal')).toBeVisible();
  const clip = page.locator('#previewMedia video');
  await expect(clip).toBeVisible();
  const duration = await clip.evaluate(
    (v) =>
      new Promise<number>((resolve) => {
        if (Number.isFinite(v.duration)) resolve(v.duration);
        else
          v.addEventListener('loadedmetadata', () => resolve(v.duration), {
            once: true,
          });
      })
  );
  expect(duration).toBeGreaterThan(0.5);
  expect(duration).toBeLessThan(wallSeconds - 2);
});

test('locks the capture-time settings while a share is live', async ({
  page,
}) => {
  await stubDisplayMedia(page);
  await page.goto('/');

  // The settings that are baked into the shared stream when the share starts:
  // the container/codec, the track's resolution and frame rate, and the audio
  // inputs with their conditioning. The next-take settings - bitrate and
  // countdown - are the contrast: they apply to a take, not to the share.
  const captureTime = [
    '#formatSelect',
    '#resolutionSelect',
    '#frameRateSelect',
    '#systemAudioToggle',
    '#micAudioToggle',
    '#micNoiseSuppression',
    '#micEchoCancellation',
    '#micAutoGain',
  ];
  const nextTake = ['#bitrateSelect', '#countdownSelect'];

  // Before a share exists, everything is editable.
  await page.click('#openSettings');
  await expect(page.locator('body')).toHaveAttribute('data-panel', 'open');
  for (const id of [...captureTime, ...nextTake]) {
    await expect(page.locator(id)).toBeEnabled();
  }

  // While the share is live the capture-time controls are greyed out: editing
  // them cannot change the stream that already exists, and accepting the input
  // silently would make the panel lie. They used to stay editable throughout.
  await page.click('#closeSettings');
  await page.click('#shareBtn');
  await page.click('#openSettings');
  for (const id of captureTime) {
    await expect(page.locator(id)).toBeDisabled();
  }
  for (const id of nextTake) {
    await expect(page.locator(id)).toBeEnabled();
  }

  // The lock has to be visible too: the drawer styles its own selects, which
  // otherwise overrides the browser's disabled rendering and leaves a locked
  // control looking live. The locked control must render in different ink
  // from the next-take control beside it.
  const lockedInk = await page
    .locator('#formatSelect')
    .evaluate((el) => getComputedStyle(el).color);
  const liveInk = await page
    .locator('#bitrateSelect')
    .evaluate((el) => getComputedStyle(el).color);
  expect(lockedInk).not.toBe(liveInk);

  // Stop sharing and the whole panel is editable again - the next share is
  // decided from these very controls. The share ends the way it does outside
  // the app: the browser's own "Stop sharing" kills the captured track and the
  // UA fires its 'ended' event, which is what the app tears the capture down
  // on. (A script-side track.stop() deliberately does not dispatch 'ended' -
  // that event is the UA's signal - so the test stands in for the user's click
  // by firing it. The transport hides its own share control while a share is
  // live - one prominent button per phase - so there is no in-page stop.)
  await page.click('#closeSettings');
  await page.evaluate(() => {
    const preview = document.getElementById(
      'videoPreview'
    ) as HTMLVideoElement | null;
    const live = preview?.srcObject as MediaStream | null;
    for (const track of live?.getTracks() ?? []) {
      track.stop();
      track.dispatchEvent(new Event('ended'));
    }
  });
  await page.click('#openSettings');
  for (const id of [...captureTime, ...nextTake]) {
    await expect(page.locator(id)).toBeEnabled();
  }
});

test('stopping while paused still saves the take', async ({ page }) => {
  await stubDisplayMedia(page);
  await page.goto('/');

  await page.click('#shareBtn');
  await page.click('#recordBtn');
  await page.waitForTimeout(1300);
  await page.click('#pauseBtn');
  await expect(page.locator('#statusText')).toHaveText('Paused');

  // Stop straight from the paused state - MediaRecorder is in its distinct
  // 'paused' state here, and the take must still be assembled and saved.
  await page.click('#stopBtn');

  const rows = page.locator('#takeList [data-take-id]');
  await expect(rows).toHaveCount(1);
  await expect(page.locator('#toastText')).toHaveText(/^Saved .+ to Takes$/);

  // The paused presentation clears with the take, and the control retires
  // with it: at rest it is hidden again, not left as a dead button.
  await expect(page.locator('#pauseBtnText')).toHaveText('Pause');
  await expect(page.locator('#pauseBtn')).toBeHidden();
  await expect(page.locator('#statusDot')).not.toHaveClass(/is-paused/);
  await expect(page.locator('#statusText')).toHaveText('Sharing');

  // It reached the on-device cache: still there after a full reload.
  await page.reload();
  await expect(page.locator('#takeList [data-take-id]')).toHaveCount(1);
});
