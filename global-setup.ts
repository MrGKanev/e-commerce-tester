/**
 * Global setup — runs once before all tests.
 *
 * Opens the site, dismisses the cookie consent banner (if any), and saves the
 * browser storage state to storageState.json.  Every test then starts with
 * those cookies already accepted, so:
 *   • cookie banners don't block interactive elements mid-test
 *   • Shopify sees a single returning visitor instead of a brand-new one for
 *     every test — reducing the risk of bot-detection / rate-limiting
 */

import { chromium } from '@playwright/test';
import path from 'path';
import { dismissCookieConsent } from './tests/helpers';

export const STORAGE_STATE = path.join(__dirname, 'storageState.json');

export default async function globalSetup(): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'bg-BG',
    timezoneId: 'Europe/Sofia',
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();
  await page.goto('https://zerno.co', { waitUntil: 'domcontentloaded' });

  // Accept cookie consent once — persisted via storage state for all tests
  await dismissCookieConsent(page);

  await context.storageState({ path: STORAGE_STATE });
  await browser.close();
}
