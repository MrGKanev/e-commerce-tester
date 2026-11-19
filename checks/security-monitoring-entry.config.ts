import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
if (!process.env.SECURITY_ENTRY_REPORT_FILE || !process.env.SECURITY_ENTRY_OUTPUT_DIR)
  throw new Error('Run through scripts/check-security-monitoring.js');
export default defineConfig({
  testDir: '../tests',
  testMatch: '44-security-monitoring.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 30000,
  outputDir: path.resolve(process.env.SECURITY_ENTRY_OUTPUT_DIR),
  reporter: [
    ['list'],
    ['json', { outputFile: path.resolve(process.env.SECURITY_ENTRY_REPORT_FILE) }],
  ],
  projects: [
    { name: 'Desktop Chrome', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'Mobile Chrome', use: { ...devices['Pixel 7'] } },
  ],
});
