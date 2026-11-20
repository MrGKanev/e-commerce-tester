import { privateResultsFile } from '../scripts/artifact-privacy';
import { defineConfig } from '@playwright/test';
const stagedResults = privateResultsFile(process.env.REPORTING_RESULTS_FILE);
export default defineConfig({
  testDir: '.',
  testMatch: 'reporting.spec.ts',
  workers: 1,
  retries: 1,
  reporter: [
    ['list'],
    ['../config/run-metadata-reporter.ts', { outputFile: process.env.REPORTING_METADATA_FILE }],
    ['json', { outputFile: stagedResults }],
    [
      '../config/artifact-privacy-reporter.ts',
      { inputFile: stagedResults, outputFile: process.env.REPORTING_RESULTS_FILE },
    ],
  ],
  outputDir: '../reports/local-reporting-checks',
  projects: [
    {
      name: 'Reporting Chrome',
      use: { browserName: 'chromium', locale: 'bg-BG', timezoneId: 'Europe/Sofia' },
    },
  ],
});
