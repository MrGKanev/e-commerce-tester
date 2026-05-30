import { defineConfig, devices } from '@playwright/test';
import { STORAGE_STATE } from './global-setup';
import { BASE, USER_AGENT, LOCALE, TIMEZONE_ID } from './tests/helpers';

const runDate =
  process.env.TEST_RUN_DATE ||
  new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');

const reportDir = `./reports/${runDate}`;

export default defineConfig({
  testDir: './tests',
  outputDir: `${reportDir}/screenshots`,

  // Global setup/teardown: setup accepts cookie consent + saves browser state;
  // teardown clears the cart so each run starts clean.
  globalSetup: require.resolve('./global-setup'),
  globalTeardown: require.resolve('./global-teardown'),

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
    baseURL: BASE,

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
    userAgent: USER_AGENT,

    // Locale — Bulgarian store
    locale: LOCALE,
    timezoneId: TIMEZONE_ID,
  },

  projects: [
    {
      name: 'Desktop Chrome',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
