import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'tracking.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { actionTimeout: 1500 },
  outputDir: '../reports/local-tracking',
});
