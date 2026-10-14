import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui', fullyParallel: false, workers: 1, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:4318', browserName: 'chromium', channel: 'msedge', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure' },
  webServer: { command: 'node tests/ui-server.mjs', url: 'http://127.0.0.1:4318', timeout: 30000, reuseExistingServer: false }
});
