import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../tests',
  testMatch: /(?:37-store-expectations|38-third-party-scripts)\.spec\.ts/,
  workers: 1,
  retries: 0,
  expect: { timeout: 700 },
  use: { baseURL: 'http://127.0.0.1:45994' },
  reporter: [
    ['list'],
    ['json', { outputFile: process.env.MONITORING_RESULTS }],
    ['../config/run-metadata-reporter.ts', { outputFile: process.env.MONITORING_METADATA }],
  ],
  outputDir: '../reports/local-monitoring/artifacts',
  webServer: {
    command: 'node monitoring-server.js',
    port: 45994,
    reuseExistingServer: false,
  },
});
