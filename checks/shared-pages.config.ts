import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'shared-pages.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: '../reports/local-shared-pages',
  use: { launchOptions: { timeout: 30000 } },
});
