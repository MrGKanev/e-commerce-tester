import { defineConfig, devices } from '@playwright/test';

const runDate =
  process.env.TEST_RUN_DATE ||
  new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');

const reportDir = `./reports/${runDate}`;

export default defineConfig({
  testDir: './tests',
  outputDir: `${reportDir}/screenshots`,
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 45000,
  expect: { timeout: 15000 },

  reporter: [
    ['list'],
    ['html', { outputFolder: reportDir, open: 'never' }],
    ['json', { outputFile: `${reportDir}/results.json` }],
  ],

  use: {
    baseURL: 'https://zerno.co',
    screenshot: 'on',
    video: 'off',
    trace: 'retain-on-failure',
    actionTimeout: 15000,
    navigationTimeout: 30000,
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },

  projects: [
    {
      name: 'Desktop Chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
});
