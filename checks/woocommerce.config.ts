import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
export default defineConfig({
  testDir: '.',
  testMatch: 'woocommerce.spec.ts',
  workers: 1,
  retries: 0,
  expect: { timeout: 1500 },
  outputDir: '../reports/local-woocommerce-checks',
  reporter: [
    ['list'],
    [
      '../config/run-metadata-reporter.ts',
      {
        outputFile: path.resolve(
          __dirname,
          '../reports/local-woocommerce-checks/run-metadata.json',
        ),
      },
    ],
  ],
  use: {
    ...devices['Desktop Chrome'],
    locale: 'en-US',
    actionTimeout: 2000,
    navigationTimeout: 5000,
  },
});
