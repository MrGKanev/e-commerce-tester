import { installWebVitals, attachWebVitals, type VitalsSession } from './web-vitals';
let vitalSessions: VitalsSession[] = [];
import path from 'node:path';
import { readSiteSettings, type Capability } from '../config/site-settings';
const settings = readSiteSettings();
let visitedUrls = new Set<string>();
import { test as base, chromium as originalChromium, type Browser } from '@playwright/test';
import { assertNotLimited, isLimited, paceAPI, paceContext, pauseBetweenTests } from './pacing';

export { expect } from '@playwright/test';
export type { Page, BrowserContext } from '@playwright/test';

let actualBrowserVersion: string | undefined;

function paceBrowser(browser: Browser): Browser {
  actualBrowserVersion = browser.version();
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async options => {
    const context = await newContext({ ...options, serviceWorkers: 'block' });
    await paceContext(context);
    vitalSessions.push(await installWebVitals(context));
    context.on('page', page =>
      page.on('framenavigated', frame => {
        if (frame === page.mainFrame() && /^https?:/.test(frame.url()))
          visitedUrls.add(frame.url());
      }),
    );
    return context;
  };
  return browser;
}

// Also covers explicitly launched Chromium contexts (e.g. Lighthouse).
export const chromium = {
  launch: async (...args: Parameters<typeof originalChromium.launch>) =>
    paceBrowser(await originalChromium.launch(...args)),
};

export const test = base.extend<{ politeRun: void }>({
  browser: [
    async ({ browser }, use) => {
      await use(paceBrowser(browser));
    },
    { scope: 'worker' },
  ],
  request: async ({ request }, use) => {
    paceAPI(request);
    await use(request);
  },
  politeRun: [
    async ({}, use, testInfo) => {
      visitedUrls = new Set();
      vitalSessions = [];
      const file = path.basename(testInfo.file);
      if (file === '29-content.spec.ts' && settings.spelling.mode === 'off') {
        testInfo.annotations.push({
          type: 'not-applicable',
          description: 'Spelling disabled for this store',
        });
        base.skip(true, 'Spelling disabled for this store');
      }
      const features: Record<string, Capability> = {
        '17-checkout.spec.ts': 'checkout',
        '25-discount-codes.spec.ts': 'discounts',
        '27-cross-sell.spec.ts': 'recommendations',
        '28-recently-viewed.spec.ts': 'recentlyViewed',
        '22-newsletter.spec.ts': 'newsletter',
        '19-filters.spec.ts': 'filters',
        '18-variants.spec.ts': 'variants',
      };
      let feature = features[file];
      if (file === '26-currency-i18n.spec.ts')
        feature = /language|locale/i.test(testInfo.title) ? 'language' : 'currency';
      if (/mobile menu|hamburger/i.test(testInfo.title)) feature = 'mobileMenu';
      if (file === '21-trust.spec.ts' && /reviews|ratings/i.test(testInfo.title))
        feature = 'reviews';
      if (file === '05-cart.spec.ts' && /checkout/i.test(testInfo.title)) feature = 'checkout';
      if (feature && settings.capabilities[feature] === false) {
        testInfo.annotations.push({
          type: 'not-applicable',
          description: `${feature} disabled for this store`,
        });
        base.skip(true, `${feature} disabled for this store`);
      }
      base.skip(isLimited(), 'HTTP 429 received earlier; no more requests to this store');
      await pauseBetweenTests();
      try {
        await use();
      } finally {
        await attachWebVitals(vitalSessions, testInfo);
        for (const url of visitedUrls) testInfo.annotations.push({ type: 'url', description: url });
        if (actualBrowserVersion)
          testInfo.annotations.push({ type: 'browser-version', description: actualBrowserVersion });
      }
      assertNotLimited();
    },
    { auto: true },
  ],
});
