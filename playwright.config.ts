import { defineConfig, devices } from '@playwright/test';

/**
 * Browser integration tests.
 *
 * These drive the *built* app (`dist/`) in a real Chromium, so they cover what
 * the jsdom unit tests cannot: real MediaRecorder, real IndexedDB persistence,
 * real layout and the service worker. `getDisplayMedia` is stubbed to a canvas
 * stream in the specs (it can't be automated headlessly).
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4317',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/serve-dist.mjs',
    url: 'http://127.0.0.1:4317',
    reuseExistingServer: !process.env.CI,
  },
});
