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
