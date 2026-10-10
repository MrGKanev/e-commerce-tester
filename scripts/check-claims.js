'use strict';
const { spawnSync } = require('node:child_process');
for (const platform of ['shopify', 'woocommerce']) {
  const result = spawnSync(
    'pnpm',
    ['exec', 'playwright', 'test', '--config=checks/claims.config.ts'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        STORE_URL: 'http://127.0.0.1:45994' + (platform === 'woocommerce' ? '/wp' : ''),
        SITE_SETTINGS_JSON: JSON.stringify({
          platform,
          commerce: { routes: { cart: '/wp/cart', checkout: '/wp/pay' } },
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
console.log('Checkout and empty-cart claims verified on both local platform fixtures.');
