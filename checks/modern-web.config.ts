import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: /modern-web(?:-[\w-]+)?\.spec\.ts/,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: '../reports/local-modern-web',
  projects: [
    { name: 'Desktop Chrome', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'Mobile Chrome', use: { ...devices['Pixel 7'] } },
    { name: 'Firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'WebKit', use: { ...devices['Desktop Safari'] } },
    { name: 'Mobile WebKit', use: { ...devices['iPhone 13'] } },
  ],
});
