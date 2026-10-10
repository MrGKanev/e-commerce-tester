'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const settings = {
  platform: 'woocommerce',
  url: 'http://127.0.0.1:45991/wp',
  locale: 'en-US',
  commerce: {
    productUrls: ['/wp/goods/simple/', '/wp/goods/variable/'],
    routes: { catalog: '/wp/catalog/', cart: '/wp/basket/', checkout: '/wp/pay/' },
  },
};
const commonEnv = {
  ...process.env,
  STORE_URL: settings.url,
  STORE_PLATFORM: 'woocommerce',
  SITE_SLUG: 'woocommerce-selection',
  SITE_SETTINGS_JSON: JSON.stringify(settings),
};
const wooSelection = spawnSync(
  'pnpm',
  ['exec', 'playwright', 'test', '--list', '--project=Desktop Chrome'],
  { cwd: root, encoding: 'utf8', env: commonEnv },
);
assert.equal(wooSelection.status, 0, wooSelection.stderr);
assert.match(wooSelection.stdout, /34-woocommerce/);
assert.ok(!wooSelection.stdout.includes('33-commerce-consistency.spec.ts'));
assert.ok(!wooSelection.stdout.includes('01-homepage.spec.ts'));
const shopSelection = spawnSync(
  'pnpm',
  ['exec', 'playwright', 'test', '--list', '--project=Desktop Chrome'],
  {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...commonEnv,
      STORE_URL: 'http://127.0.0.1:45991',
      STORE_PLATFORM: 'shopify',
      SITE_SLUG: 'shopify-selection',
      SITE_SETTINGS_JSON: JSON.stringify({ platform: 'shopify', url: 'http://127.0.0.1:45991' }),
    },
  },
);
assert.equal(shopSelection.status, 0, shopSelection.stderr);
assert.ok(!shopSelection.stdout.includes('34-woocommerce.spec.ts'));
assert.match(shopSelection.stdout, /33-commerce-consistency/);
fs.rmSync(path.join(root, 'reports/woocommerce-selection'), { recursive: true, force: true });
fs.rmSync(path.join(root, 'reports/shopify-selection'), { recursive: true, force: true });
const result = spawnSync(
  'pnpm',
  ['exec', 'playwright', 'test', '--config=checks/woocommerce.config.ts', ...process.argv.slice(2)],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      STORE_URL: settings.url,
      STORE_PLATFORM: 'woocommerce',
      SITE_SLUG: 'woocommerce-local',
      SITE_SETTINGS_JSON: JSON.stringify(settings),
      PAGE_INVENTORY_FILE: path.join(root, 'reports/local-woocommerce-checks/page-inventory.json'),
      TEST_DELAY_MS: '0',
      TEST_JITTER_MS: '0',
      REQUEST_DELAY_MS: '0',
      REQUEST_JITTER_MS: '0',
    },
  },
);
if (result.status !== 0) process.exit(result.status || 1);
const report = JSON.parse(
  fs.readFileSync(
    path.join(root, 'reports/local-woocommerce-checks/commerce-consistency.json'),
    'utf8',
  ),
);
assert.ok(report.checks.length);
assert.ok(report.checks.every(check => check.platform === 'woocommerce'));
assert.ok(
  !JSON.stringify(report).includes('secret-cart-token'),
  'Cart credentials must not enter evidence',
);
console.log(
  'WooCommerce acceptance passed with public API/session evidence; no Shopify routes or orders.',
);
