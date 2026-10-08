import { readSiteSettings } from './site-settings';
import { prepareInventory } from '../tests/inventory';
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

import { chromium, request } from '@playwright/test';
import path from 'path';
import fs from 'node:fs';
import { RATE_LIMIT_FILE, paceContext, paceAPI, assertNotLimited } from '../tests/pacing';
import { BASE, USER_AGENT, LOCALE, TIMEZONE_ID, dismissCookieConsent } from '../tests/helpers';

// storageState lives in the project root regardless of where this file is
const ROOT = path.join(__dirname, '..');

export const STORAGE_STATE = path.join(
  ROOT,
  process.env.SITE_SLUG ? `storageState.${process.env.SITE_SLUG}.json` : 'storageState.json',
);

export default async function globalSetup(): Promise<void> {
  fs.rmSync(RATE_LIMIT_FILE, { force: true });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      locale: LOCALE,
      timezoneId: TIMEZONE_ID,
      viewport: { width: 1280, height: 800 },
    });
    await paceContext(context);
    const page = await context.newPage();
    await page.evaluate(selectors => { for (const selector of selectors) document.querySelector(selector); }, [...Object.values(readSiteSettings().selectors), ...readSiteSettings().spelling.excludeSelectors]);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    assertNotLimited();
    // Only fresh setup waits for a banner; returning sessions probe immediately.
    await dismissCookieConsent(page, 5000);
    await context.storageState({ path: STORAGE_STATE });
  } finally {
    await browser.close();
  }

  // Validate the saved session can reach the store before handing off to tests
  const reqCtx = await request.newContext({ baseURL: BASE, storageState: STORAGE_STATE });
  paceAPI(reqCtx);
  try {
    await prepareInventory(reqCtx);
    const resp = await reqCtx.get('/cart.js');
    if (resp.status() !== 200) {
      console.warn(
        `[setup] Session health-check: /cart.js returned HTTP ${resp.status()} — tests may behave unexpectedly`,
      );
    }
  } catch (error) {
    throw error;
  } finally {
    await reqCtx.dispose();
  }
  assertNotLimited();
}
