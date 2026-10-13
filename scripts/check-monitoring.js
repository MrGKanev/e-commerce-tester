'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../reports/local-monitoring');
for (const platform of ['shopify', 'woocommerce']) {
  for (const mismatch of [false, true]) {
    const dir = path.join(root, platform + (mismatch ? '-mismatch' : '-expected'));
    fs.mkdirSync(dir, { recursive: true });
    const settings = {
      platform,
      monitorScripts: true,
      cookieConsent: { mode: 'none' },
      performanceMetrics: { enabled: false },
      expectations: {
        minProducts: mismatch ? 3 : 2,
        currency: mismatch ? 'USD' : 'BGN',
        paymentSelector: mismatch ? '#missing-payment' : '#payment',
        paymentPath: '/checkout',
      },
    };
    const result = spawnSync(
      'pnpm',
      ['exec', 'playwright', 'test', '--config=checks/monitoring.config.ts'],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          STORE_URL: 'http://127.0.0.1:45994',
          SITE_SETTINGS_JSON: JSON.stringify(settings),
          TEST_DELAY_MS: '0',
          TEST_JITTER_MS: '0',
          REQUEST_DELAY_MS: '0',
          REQUEST_JITTER_MS: '0',
          MONITORING_RESULTS: path.join(dir, 'results.json'),
          MONITORING_METADATA: path.join(dir, 'run-metadata.json'),
        },
      },
    );
    assert.equal(result.status, mismatch ? 1 : 0);
    const results = JSON.parse(fs.readFileSync(path.join(dir, 'results.json')));
    assert.equal(results.stats.unexpected, mismatch ? 3 : 0);
    const scripts = JSON.parse(fs.readFileSync(path.join(dir, 'third-party-scripts.json')));
    assert.deepEqual(scripts.scripts, ['http://localhost:45994/tracker.js']);
  }
}
console.log('Local monitoring expectations and script capture verified for both platforms.');
