import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'frontend.spec.js',
  use: { baseURL: 'http://127.0.0.1:8091', headless: true },
  webServer: {
    command: 'node tests/dev-server.mjs',
    env: { PORT: '8091' },
    url: 'http://127.0.0.1:8091',
    reuseExistingServer: false,
  },
});
