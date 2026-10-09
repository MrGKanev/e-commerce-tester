import { defineConfig, devices } from '@playwright/test';
import { STORAGE_STATE } from './config/global-setup';
import { BASE, USER_AGENT, LOCALE, TIMEZONE_ID } from './tests/helpers';

const runDate =
  process.env.TEST_RUN_DATE ||
  new Date().toISOString().replace('T', '_').replace(/[:.]/g, '-').replace('Z', '');

const siteSlug = process.env.SITE_SLUG || new URL(BASE).hostname.replace(/[^a-z0-9-]/gi, '-');
const reportDir = siteSlug ? `./reports/${siteSlug}/${runDate}` : `./reports/${runDate}`;

process.env.PAGE_INVENTORY_FILE ||= `${reportDir}/page-inventory.json`;

export default defineConfig({
  testDir: './tests',
  snapshotPathTemplate: `{testDir}/{testFilePath}-snapshots/${siteSlug || new URL(BASE).hostname.replace(/[^a-z0-9-]/gi, '-')}/{arg}-{projectName}-{platform}{ext}`,
  outputDir: `${reportDir}/screenshots`,

  // Global setup/teardown: setup accepts cookie consent + saves browser state;
  // teardown clears the cart so each run starts clean.
  globalSetup: require.resolve('./config/global-setup'),
  globalTeardown: require.resolve('./config/global-teardown'),

  // Sequential — avoids Shopify rate-limiting and cart state collisions
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120000,
  expect: { timeout: 15000 },

  reporter: [
    ['list'],
    ['./config/run-metadata-reporter.ts', { outputFile: `${reportDir}/run-metadata.json` }],
    ['html', { outputFolder: `${reportDir}/html`, open: 'never' }],
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
    {
      name: 'Desktop Firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'Desktop Safari',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'Mobile Chrome',
      testMatch:
        /(?:07-mobile|10-visual|11-accessibility|24-keyboard|29-content|30-inventory-visual|32-shared-pages)\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'Mobile Safari',
      testMatch:
        /(?:07-mobile|10-visual|11-accessibility|24-keyboard|29-content|30-inventory-visual|32-shared-pages)\.spec\.ts/,
      use: { ...devices['iPhone 13'] },
    },
  ],
});
