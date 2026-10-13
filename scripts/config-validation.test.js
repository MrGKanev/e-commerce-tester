'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateConfigShape } = require('../config/config-validation');
const { resolveSiteSettings } = require('../config/site-settings');
const { validateSites, loadSites } = require('./site-config');

test('Ajv rejects mistyped settings with all field paths and never coerces values', () => {
  const input = {
    capabilities: { reviews: 'false' },
    inventory: { productLimit: '5' },
    thresholds: { lighthouse: { seo: 101 } },
  };
  const before = structuredClone(input);
  assert.throws(
    () => resolveSiteSettings(input),
    error => {
      for (const field of [
        '/capabilities/reviews',
        '/inventory/productLimit',
        '/thresholds/lighthouse/seo',
      ])
        assert.ok(error.message.includes(field));
      return true;
    },
  );
  assert.deepEqual(input, before);
});

test('Ajv errors omit supplied values and reject rather than remove unknown nested fields', () => {
  const secret = 'private-secret-123';
  const input = { selectors: { unknown: secret }, spelling: { ocr: { maxImages: secret } } };
  assert.throws(
    () => resolveSiteSettings(input),
    error => {
      assert.ok(error.message.includes('unknown'));
      assert.ok(error.message.includes('/spelling/ocr/maxImages'));
      assert.ok(!error.message.includes(secret));
      return true;
    },
  );
  assert.equal(input.selectors.unknown, secret);
});

test('existing defaults and partial overrides remain independent without mutating input', () => {
  const input = {
    locale: null,
    thresholds: { lighthouse: { seo: 95 } },
    spelling: { ocr: { maxImages: 2 }, allowWords: ['Brand'] },
    inventory: { pages: [{ path: '/about', type: 'static' }] },
  };
  const before = structuredClone(input);
  const resolved = resolveSiteSettings(input);
  assert.equal(resolved.platform, 'shopify');
  assert.equal(resolved.locale, 'bg-BG');
  assert.equal(resolved.thresholds.lighthouse.seo, 95);
  assert.equal(resolved.thresholds.lighthouse.performance, 50);
  assert.equal(resolved.spelling.ocr.minConfidence, 85);
  resolved.spelling.allowWords.push('Another');
  resolved.inventory.pages[0].path = '/changed';
  assert.deepEqual(input, before);
  assert.equal(resolveSiteSettings().thresholds.lighthouse.seo, 85);
  assert.deepEqual(resolveSiteSettings().spelling.allowWords, []);
});

test('schemas preserve top-level metadata while enforcing nested fields and finite bounds', () => {
  const input = { customMetadata: { owner: 'local' } };
  validateConfigShape('settings', input);
  assert.deepEqual(input, { customMetadata: { owner: 'local' } });
  for (const bad of [
    { thresholds: { performance: { ttfb: Infinity } } },
    { thresholds: { visual: { components: { hero: NaN } } } },
    { spelling: { maxFindings: 0.5 } },
    { inventory: { pages: [{ path: '/about' }] } },
  ])
    assert.throws(() => resolveSiteSettings(bad));
});

test('both platform examples load through the same file validator without registrations', () => {
  for (const file of ['sites.example.json', 'woocommerce-sites.example.json']) {
    const sites = loadSites(path.join(__dirname, '../examples', file), {});
    assert.ok(sites.length);
    const source = JSON.parse(fs.readFileSync(path.join(__dirname, '../examples', file), 'utf8'));
    assert.equal(sites.length, source.length);
  }
});

test('Woo schema is isolated from Shopify and semantic URL checks still reject unsafe paths', () => {
  assert.doesNotThrow(() =>
    resolveSiteSettings({ platform: 'shopify', commerce: { unknown: 'ignored Woo settings' } }),
  );
  assert.throws(
    () => resolveSiteSettings({ platform: 'woocommerce', commerce: { unknown: 'rejected' } }),
    /Unknown|unknown/,
  );
  assert.throws(
    () => resolveSiteSettings({ platform: 'woocommerce', commerce: { productIds: ['12'] } }),
    /productIds/,
  );
  assert.throws(
    () =>
      resolveSiteSettings({
        platform: 'woocommerce',
        url: 'https://example.test',
        commerce: { productUrls: ['https://foreign.test/product/'] },
      }),
    /origin/,
  );
  assert.throws(
    () => validateSites([{ url: 'https://example.test/admin', platform: 'woocommerce' }]),
    /admin/,
  );
});

test('checkout expectations validate explicit policies, required address fields and custom selectors', () => {
  const input = {
    checkout: {
      shippingAddress: 'not-applicable',
      requiredAddressFields: ['addressLine1', 'country'],
    },
    selectors: {
      checkoutRoot: '.custom-checkout',
      checkoutEmail: '#contact',
      cartEmpty: '.empty-message',
    },
  };
  const resolved = resolveSiteSettings(input);
  assert.equal(resolved.checkout.contact, 'required');
  assert.equal(resolved.checkout.mode, 'auto');
  assert.equal(resolved.checkout.shippingAddress, 'not-applicable');
  resolved.checkout.requiredAddressFields.push('city');
  assert.deepEqual(input.checkout.requiredAddressFields, ['addressLine1', 'country']);
  for (const checkout of [
    { contact: true },
    { shippingAddress: 'optional' },
    { mode: 'guess' },
    { requiredAddressFields: [] },
    { requiredAddressFields: ['addressLine1', 'addressLine1'] },
    { requiredAddressFields: ['unknown'] },
  ])
    assert.throws(() => resolveSiteSettings({ checkout }), /checkout/);
});

test('cookie consent settings have independent defaults and reject invalid choices or waits', () => {
  const settings = resolveSiteSettings({ cookieConsent: { mode: 'none', waitMs: 2500 } });
  assert.deepEqual(settings.cookieConsent, { mode: 'none', waitMs: 2500, frameSelector: '' });
  assert.equal(resolveSiteSettings().cookieConsent.mode, 'accept-all');
  for (const cookieConsent of [
    { mode: 'reject' },
    { waitMs: -1 },
    { waitMs: 30001 },
    { waitMs: '5000' },
  ])
    assert.throws(() => resolveSiteSettings({ cookieConsent }));
});
