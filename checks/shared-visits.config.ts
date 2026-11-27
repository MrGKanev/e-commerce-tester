import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

if (!process.env.SHARED_VISITS_DIRECTORY)
  throw new Error('Run through pnpm test:shared-visits:local');
const directory = process.env.SHARED_VISITS_DIRECTORY;
export default defineConfig({
  testDir: '.',
  testMatch: 'shared-visits.spec.ts',
  grep: /third-party script inventory|page load WebSocket|pageCheck|homepage smoke|remaining passive|product — passive|Mobile viewport|structured data and Open Graph|content —|inventory snapshot|inventory snapshots|Shared inventory —|SEO — metadata|modern web —/,
  workers: 1,
  retries: 0,
  timeout: 30000,
  expect: { timeout: 1000 },
  updateSnapshots: 'none',
  snapshotPathTemplate: path.join(directory, 'visual-reference/{arg}{ext}'),
  outputDir: path.join(directory, 'artifacts'),
  reporter: [['list'], ['json', { outputFile: path.join(directory, 'results.json') }]],
  use: { locale: 'en-US' },
  projects: [
    { name: 'Desktop Chrome', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'Mobile Chrome', use: { ...devices['Pixel 7'] } },
    { name: 'Firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'WebKit', use: { ...devices['Desktop Safari'] } },
    { name: 'Mobile WebKit', use: { ...devices['iPhone 13'] } },
  ],
});
