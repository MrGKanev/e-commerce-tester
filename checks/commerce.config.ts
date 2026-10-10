import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
export default defineConfig({
  testDir: '.',
  testMatch: 'commerce.spec.ts',
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    [
      '../config/run-metadata-reporter.ts',
      {
        outputFile: path.resolve(__dirname, '../reports/local-commerce-checks/run-metadata.json'),
      },
    ],
  ],
  outputDir: '../reports/local-commerce-checks',
  expect: { timeout: 2000 },
  use: {
    ...devices['Desktop Chrome'],
    locale: 'bg-BG',
    navigationTimeout: 5000,
    actionTimeout: 3000,
  },
});
