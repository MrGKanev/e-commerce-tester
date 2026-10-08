import { defineConfig } from '@playwright/test';
import main from '../playwright.config';

// Local acceptance checks reuse the real Lighthouse suite, without store setup/teardown.
export default defineConfig({
  ...main,
  testDir: '../tests',
  testMatch: '12-performance.spec.ts',
  grep: /12b · Lighthouse/,
  globalSetup: undefined,
  globalTeardown: undefined,
  outputDir: `../reports/${process.env.SITE_SLUG}/${process.env.TEST_RUN_DATE}/screenshots`,
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: `../reports/${process.env.SITE_SLUG}/${process.env.TEST_RUN_DATE}/results.json`,
      },
    ],
  ],
  use: { ...main.use, storageState: undefined },
});
