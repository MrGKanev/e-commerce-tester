import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'vitals.spec.ts',
  workers: 1,
  use: { launchOptions: { timeout: 30000 } },
  retries: 0,
  reporter: 'list',
  outputDir: '../reports/local-vitals-checks',
});
