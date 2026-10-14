import { test } from './fixtures';
import { readSiteSettings } from '../config/site-settings';
import { BASE } from './helpers';
import { verifyTrackingConsent } from './commerce-expectations';
const config = readSiteSettings().analytics;
for (const choice of ['accept', 'reject'] as const) {
  test(
    `Configured trackers respect ${choice} consent`,
    { tag: ['@full', '@analytics'] },
    async ({ browser }, info) => {
      test.skip(!config?.enabled, 'Analytics expectations are not configured');
      const settings = config!;
      const context = await browser.newContext({
        ...info.project.use,
        storageState: { cookies: [], origins: [] },
      });
      const observed = new Set<string>();
      try {
        await verifyTrackingConsent(await context.newPage(), settings, choice, BASE, observed);
      } finally {
        await info.attach('tracking-consent.json', {
          body: JSON.stringify({
            choice,
            observed: [...observed],
            windowMs: settings.observeMs ?? 1000,
          }),
          contentType: 'application/json',
        });
        await context.close();
      }
    },
  );
}
