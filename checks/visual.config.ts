import { defineConfig, devices } from '@playwright/test';
import { pin, baselineRoot } from '../scripts/visual-baselines';
const site = process.env.SITE_SLUG!;
const run = process.env.TEST_RUN_DATE!;
export default defineConfig({
  testDir: '.',
  testMatch: 'visual.spec.ts',
  workers: 1,
  retries: 0,
  updateSnapshots: 'none',
  expect: { timeout: 1500 },
  snapshotPathTemplate: `../reports/${site}/${run}/visual-reference/{arg}{ext}`,
  outputDir: `../reports/${site}/${run}/screenshots`,
  metadata: {
    visualRun: run,
    visualBaseline: pin(baselineRoot(), site, run),
  },
  reporter: 'list',
  projects: [
    { name: 'Desktop Chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'Desktop Firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'Desktop Safari', use: { ...devices['Desktop Safari'] } },
    { name: 'Mobile Chrome', use: { ...devices['Pixel 7'] } },
    { name: 'Mobile Safari', use: { ...devices['iPhone 13'] } },
  ],
});
