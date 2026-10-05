import { defineConfig } from '@playwright/test';

// Responsive/visual regression suite. Runs against `next dev` on :3000 (reused
// if already running). Set PLAYWRIGHT_BASE_URL to point at a deployed build.
// `npm run test:e2e` = Chromium; `npm run test:e2e:webkit` = WebKit (iOS Safari's engine).
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  reporter: [['list']],
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : { command: 'npm run dev', url: baseURL, reuseExistingServer: true, timeout: 180_000 },
});
