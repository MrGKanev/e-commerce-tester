import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

if (!process.env.VISIT_GROUPS_DIRECTORY)
  throw new Error('Run through pnpm test:visit-groups:local');
export default defineConfig({
  testDir: '.',
  testMatch: 'visit-groups.spec.ts',
  grep: /03 ·|08 ·|09 ·|11 ·|16 ·|23 ·|security headers — shared response|Strict-Transport-Security header is present|HSTS max-age|X-Content-Type-Options: nosniff|X-Frame-Options or CSP|Server header does not expose|X-Powered-By header is not present/,
  workers: 1,
  retries: 0,
  timeout: 30000,
  expect: { timeout: 1000 },
  outputDir: path.join(process.env.VISIT_GROUPS_DIRECTORY, 'artifacts'),
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(process.env.VISIT_GROUPS_DIRECTORY, 'results.json') }],
  ],
  use: { locale: 'en-US', actionTimeout: 1000 },
  projects: [
    { name: 'Desktop Chrome', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'Mobile Chrome', use: { ...devices['Pixel 7'] } },
    { name: 'Firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'WebKit', use: { ...devices['Desktop Safari'] } },
    { name: 'Mobile WebKit', use: { ...devices['iPhone 13'] } },
  ],
});
