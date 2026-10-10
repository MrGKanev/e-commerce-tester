import { defineConfig } from '@playwright/test';
import path from 'node:path';
export default defineConfig({
  testDir: '.',
  testMatch: 'journey.spec.ts',
  workers: 1,
  retries: 0,
  expect: { timeout: 1200 },
  use: { actionTimeout: 1500, navigationTimeout: 3000, locale: 'en-US' },
  reporter: [
    ['list'],
    [
      '../config/run-metadata-reporter.ts',
      {
        outputFile: path.resolve(
          __dirname,
          `../reports/local-journey-${process.env.STORE_PLATFORM}/run-metadata.json`,
        ),
      },
    ],
  ],
  outputDir: `../reports/local-journey-${process.env.STORE_PLATFORM}/artifacts`,
});
