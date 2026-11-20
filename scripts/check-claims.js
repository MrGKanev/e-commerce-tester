'use strict';
const { spawn } = require('node:child_process');
const { createClaimsServer } = require('./claims-fixture-server');

async function main() {
  for (const platform of ['shopify', 'woocommerce']) {
    const fixture = createClaimsServer(platform);
    try {
      const base = await fixture.listen();
      const status = await new Promise((resolve, reject) => {
        const child = spawn(
          'pnpm',
          ['exec', 'playwright', 'test', '--config=checks/claims.config.ts'],
          {
            stdio: 'inherit',
            env: {
              ...process.env,
              STORE_URL: base + (platform === 'woocommerce' ? '/wp' : ''),
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
        child.once('error', reject);
        child.once('exit', (code, signal) =>
          signal ? reject(new Error(`Claims runner terminated: ${signal}`)) : resolve(code),
        );
      });
      if (status !== 0) throw new Error(`Claims acceptance failed for ${platform}: exit ${status}`);
    } finally {
      await fixture.close();
    }
  }
  console.log(
    'Checkout and empty-cart claims verified on both dynamic-port local platform fixtures.',
  );
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
