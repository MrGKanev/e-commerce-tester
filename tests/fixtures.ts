import { test as base, chromium as originalChromium, type Browser } from '@playwright/test';
import { assertNotLimited, isLimited, paceAPI, paceContext, pauseBetweenTests } from './pacing';

export { expect } from '@playwright/test';
export type { Page, BrowserContext } from '@playwright/test';

function paceBrowser(browser: Browser): Browser {
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async options => {
    const context = await newContext({ ...options, serviceWorkers: 'block' });
    await paceContext(context);
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
    async ({}, use) => {
      base.skip(isLimited(), 'HTTP 429 received earlier; no more requests to this store');
      await pauseBetweenTests();
      await use();
      assertNotLimited();
    },
    { auto: true },
  ],
});
