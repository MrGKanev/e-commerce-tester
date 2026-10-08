import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '../tests',
  testMatch: '24-keyboard.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: '../reports/local-keyboard-checks',

  projects: [
    { name: 'Offline Desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'Offline Mobile', use: { ...devices['Pixel 7'] } },
  ],
});
