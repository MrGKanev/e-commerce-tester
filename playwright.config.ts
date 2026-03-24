import { defineConfig, devices } from '@playwright/test';
import { STORAGE_STATE } from './global-setup';

const runDate =
  process.env.TEST_RUN_DATE ||
  new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');

const reportDir = `./reports/${runDate}`;

export default defineConfig({
  testDir: './tests',
  outputDir: `${reportDir}/screenshots`,

  // Global setup runs once before all tests: accepts cookie consent and saves
  // browser storage state so every test inherits accepted cookies.
  globalSetup: require.resolve('./global-setup'),

  // Sequential — avoids Shopify rate-limiting and cart state collisions
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 60000,
  expect: { timeout: 15000 },

  reporter: [
    ['list'],
    ['html', { outputFolder: reportDir, open: 'never' }],
    ['json', { outputFile: `${reportDir}/results.json` }],
  ],

  use: {
    baseURL: 'https://zerno.co',

    // Reuse the storage state (cookies) from global setup.
    // Shopify sees a single returning visitor → less bot-detection risk.
    storageState: STORAGE_STATE,

    // Screenshots only on failure — no folder created for passing test runs.
    screenshot: 'only-on-failure',
    video: 'off',
    // Keep trace only on failure for debugging
    trace: 'retain-on-failure',

    actionTimeout: 15000,
    navigationTimeout: 35000,

    // Desktop default viewport; mobile tests override per-suite via page.setViewportSize()
    viewport: { width: 1280, height: 800 },

    // Real browser UA — avoids 403/bot-detection on Shopify
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

    // Locale — Bulgarian store
    locale: 'bg-BG',
    timezoneId: 'Europe/Sofia',
  },

  projects: [
    {
      name: 'Desktop Chrome',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
