import { defineConfig } from '@playwright/test';

// Pure TypeScript contracts run once without starting a browser or inheriting projects.
export default defineConfig({
  testDir: '.',
  testMatch: 'modern-web-continuation-unit.spec.ts',
  outputDir: '../reports/local-modern-web-unit',
  workers: 1,
  retries: 0,
});
