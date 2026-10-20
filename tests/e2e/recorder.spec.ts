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
async function stubDisplayMedia(page: Page): Promise<void> {
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
