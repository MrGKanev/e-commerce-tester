import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'smoke-regressions.spec.ts',
  grep: /at least one product or collection is linked from homepage|page loads \(not 404\)|URL stays on product path/,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: '../reports/local-smoke-regressions',
  expect: { timeout: 700 },
  projects: [
    { name: 'Desktop Chrome', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'Mobile Chrome', use: { ...devices['Pixel 7'] } },
    { name: 'Hidden-only Chrome', use: { viewport: { width: 1280, height: 800 } } },
  ],
});
