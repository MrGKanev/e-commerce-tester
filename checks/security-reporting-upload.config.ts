import { defineConfig, devices } from '@playwright/test';

// Owned loopback calibration only. Never import these debug settings into store runs.
export default defineConfig({
  testDir: '.',
  testMatch: 'security-reporting-upload.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: '../reports/local-security-reporting-upload',
  use: {
    serviceWorkers: 'block',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    { name: 'Desktop Chrome', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'Mobile Chrome', use: { ...devices['Pixel 7'] } },
  ],
});
