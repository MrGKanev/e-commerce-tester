import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'reporting.spec.ts',
  workers: 1,
  retries: 1,
  reporter: [
    ['list'],
    ['../config/run-metadata-reporter.ts', { outputFile: process.env.REPORTING_METADATA_FILE }],
    ['json', { outputFile: process.env.REPORTING_RESULTS_FILE }],
  ],
  outputDir: '../reports/local-reporting-checks',
  projects: [
    {
      name: 'Reporting Chrome',
      use: { browserName: 'chromium', locale: 'bg-BG', timezoneId: 'Europe/Sofia' },
    },
  ],
});
