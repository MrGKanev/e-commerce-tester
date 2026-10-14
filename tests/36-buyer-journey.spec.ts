import { test } from './fixtures';
import { runBuyerJourney } from './buyer-journey';
import { CommerceUnverified } from '../scripts/storefront-model';
import { readSiteSettings } from '../config/site-settings';

test(
  'Buyer journey — search → product → variant → add → quantity → checkout',
  { tag: ['@full', '@journey', '@analytics'] },
  async ({ browser }, info) => {
    if (readSiteSettings().capabilities.checkout === false) {
      info.annotations.push({
        type: 'not-applicable',
        description: 'Checkout explicitly disabled',
      });
      test.skip(true, 'Checkout disabled for this store');
    }
    test.setTimeout(300000);
    // A dedicated empty visitor session never inherits the global storefront cart.
    const use = info.project.use;
    const context = await browser.newContext({
      ...use.contextOptions,
      viewport: use.viewport,
      userAgent: use.userAgent,
      deviceScaleFactor: use.deviceScaleFactor,
      isMobile: use.isMobile,
      hasTouch: use.hasTouch,
      locale: use.locale,
      timezoneId: use.timezoneId,
      baseURL: use.baseURL,
      storageState: { cookies: [], origins: [] },
    });
    context.setDefaultTimeout(use.actionTimeout || 15000);
    context.setDefaultNavigationTimeout(use.navigationTimeout || 35000);
    try {
      await runBuyerJourney(await context.newPage(), info);
    } catch (error) {
      if (!(error instanceof CommerceUnverified)) throw error;
      info.annotations.push({ type: 'journey-unverified', description: error.message });
      test.skip(true, error.message);
    } finally {
      await context.close();
    }
  },
);
