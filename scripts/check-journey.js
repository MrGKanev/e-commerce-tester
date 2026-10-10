'use strict';
const { spawnSync } = require('node:child_process');
for (const platform of ['shopify', 'woocommerce']) {
  const result = spawnSync(
    'pnpm',
    ['exec', 'playwright', 'test', '--config=checks/journey.config.ts'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        STORE_URL: 'http://127.0.0.1:45993' + (platform === 'woocommerce' ? '/wp' : ''),
        STORE_PLATFORM: platform,
        SITE_SETTINGS_JSON: JSON.stringify({
          platform,
          locale: 'en-US',
          commerce: {
            taxDisplay: 'excluding',
            routes: { cart: '/wp/cart', search: '/wp/?s={query}', checkout: '/wp/checkout' },
          },
          selectors: {
            price: '[data-product-price]',
            checkoutSummary: '[data-checkout-line-item]',
          },
        }),
        TEST_DELAY_MS: '0',
        TEST_JITTER_MS: '0',
        REQUEST_DELAY_MS: '0',
        REQUEST_JITTER_MS: '0',
      },
    },
  );
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('Both platform buyer journeys passed against local fixtures; no orders submitted.');
