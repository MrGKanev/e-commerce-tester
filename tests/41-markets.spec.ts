import { test, expect } from './fixtures';
import { readSiteSettings } from '../config/site-settings';
import { runBuyerJourney } from './buyer-journey';
import { CommerceUnverified } from '../scripts/storefront-model';
const settings = readSiteSettings();
for (const market of settings.markets) {
  test(
    `Market buyer journey: ${market.name}`,
    { tag: ['@full', '@markets'] },
    async ({ browser }, info) => {
      test.skip(settings.capabilities.checkout === false, 'Checkout explicitly disabled');
      test.setTimeout(300000);
      const context = await browser.newContext({
        ...info.project.use,
        locale: market.locale,
        storageState: { cookies: [], origins: [] },
      });
      try {
        await runBuyerJourney(await context.newPage(), info, undefined, market);
      } catch (error) {
        if (!(error instanceof CommerceUnverified)) throw error;
        info.annotations.push({ type: 'journey-unverified', description: error.message });
        test.skip(true, error.message);
      } finally {
        await context.close();
      }
    },
  );
}
if (!settings.markets.length)
  test('Market scenarios not configured', { tag: ['@full', '@markets'] }, () => {
    expect(settings.markets).toHaveLength(0);
    test.skip(true, 'Configure markets to verify country-specific prices and checkout');
  });
