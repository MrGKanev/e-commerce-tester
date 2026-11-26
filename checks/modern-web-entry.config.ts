import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

if (!process.env.MODERN_WEB_ENTRY_REPORT_FILE || !process.env.MODERN_WEB_ENTRY_OUTPUT_DIR)
  throw new Error('Run this acceptance config through node scripts/check-modern-web-entry.js');

export default defineConfig({
  testDir: '../tests',
  testMatch: '43-modern-web.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 30000,
  outputDir: path.resolve(process.env.MODERN_WEB_ENTRY_OUTPUT_DIR),
  reporter: [
    ['list'],
    ['json', { outputFile: path.resolve(process.env.MODERN_WEB_ENTRY_REPORT_FILE) }],
  ],
  use: { locale: 'en-US' },
  projects: [
    { name: 'Desktop Chrome', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'Mobile Chrome', use: { ...devices['Pixel 7'] } },
  ],
});
