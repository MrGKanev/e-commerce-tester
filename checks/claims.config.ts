import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'claims.spec.ts',
  workers: 1,
  retries: 0,
  expect: { timeout: 700 },
  use: { actionTimeout: 1000, navigationTimeout: 2500 },
  reporter: 'list',
  outputDir: '../reports/local-claims',
});
