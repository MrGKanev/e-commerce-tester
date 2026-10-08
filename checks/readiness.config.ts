import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'readiness.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: '../reports/local-readiness-checks',
  expect: { timeout: 700 },
  use: { navigationTimeout: 3000, actionTimeout: 1000 },
});
