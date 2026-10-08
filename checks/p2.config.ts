import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: ['p2.spec.ts', '22-newsletter.spec.ts'],
  workers: 1,
  grep: process.env.P2_STRICT ? /strict/ : /report|inventory|touch|disabled/,
  reporter: [
    ['list'],
    ['../config/run-metadata-reporter.ts', { outputFile: process.env.P2_METADATA_FILE }],
  ],
  outputDir: '../reports/local-p2-checks',
  use: { ...devices['Pixel 7'], locale: 'en-US' },
});
