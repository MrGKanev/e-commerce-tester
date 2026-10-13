import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'a11y.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: '../reports/local-a11y',
  use: { launchOptions: { timeout: 30000 } },
});
