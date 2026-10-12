// Playwright configuration: the dev servers are started automatically and serve
// both the page and the images, so the tests need nothing else.
//   - port 8090 — a folder with a screenshot inside (tests/)
//   - port 8091 — an empty folder (tests/empty), used for the empty-state test
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js', // backend.test.js runs under the txiki.js runtime instead
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:8090',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node tests/dev-server.mjs',
      url: 'http://127.0.0.1:8090/api/state',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'env SHOT_FOLDER=tests/empty PORT=8091 node tests/dev-server.mjs',
      url: 'http://127.0.0.1:8091/api/state',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
