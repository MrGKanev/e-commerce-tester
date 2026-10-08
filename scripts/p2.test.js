'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveSiteSettings } = require('../config/site-settings');
const { mergeFindings, fingerprint } = require('./spelling-model');
const { compareRuns } = require('./report-model');

test('site settings merge thresholds and validate locale, capabilities, limits and internal pages', () => {
  const settings = resolveSiteSettings({ locale: 'en-US', timezoneId: 'America/New_York', capabilities: { reviews: false }, thresholds: { lighthouse: { performance: 75 } }, inventory: { pages: [{ path: '/about', type: 'static', language: 'en' }] } });
  assert.equal(settings.thresholds.lighthouse.performance, 75);
  assert.equal(settings.thresholds.lighthouse.seo, 85);
  assert.equal(settings.capabilities.reviews, false);
  for (const bad of [
    { capabilities: false }, { inventory: null }, { locale: 'not_a_locale' }, { timezoneId: 'Invalid/Zone' }, { capabilities: { reviews: 'false' } },
    { thresholds: { lighthouse: { seo: 120 } } }, { inventory: { productLimit: 500 } },
    { inventory: { pages: [{ path: '//outside.test', type: 'home' }] } },
    { spelling: { languages: ['unsupported'] } }, { spelling: { ocr: { minConfidence: 101 } } }, { selectors: { misspeltKey: 'h1' } },
  ]) assert.throws(() => resolveSiteSettings(bad));
});

test('spelling deduplicates shared components and preserves every URL and location', () => {
  const finding = { language: 'en', component: 'header', source: 'text', text: '  Heloow  world ', word: 'Heloow', suggestions: ['Hello'], accepted: false, urls: ['https://example.test/'], locations: [{ url: 'https://example.test/', locator: '#nav', rect: {} }] };
  const merged = mergeFindings([], [finding, { ...finding, text: 'Heloow world', urls: ['https://example.test/product'], locations: [{ url: 'https://example.test/product', locator: '#nav', rect: {} }] }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].urls.length, 2);
  assert.equal(merged[0].locations.length, 2);
  const acrossSources = mergeFindings([], [finding, { ...finding, source: 'aria-label' }]);
  assert.equal(acrossSources.length, 1);
  assert.deepEqual(acrossSources[0].sources, ['text', 'aria-label']);
  assert.notEqual(fingerprint(finding), fingerprint({ ...finding, component: 'footer' }));
});

test('failure comparisons distinguish new, recurring, resolved and unchecked regressions', () => {
  const scenario = (title, outcome) => ({ title, file: 'cart.ts', project: 'Chrome', outcome });
  const old = { dir: 'previous', scenarios: [scenario('A', 'failed'), scenario('B', 'failed'), scenario('C', 'failed')] };
  const current = { scenarios: [scenario('A', 'failed'), scenario('B', 'passed'), scenario('C', 'skipped'), scenario('D', 'failed')] };
  const changes = compareRuns(current, old);
  assert.deepEqual(changes, { available: true, baseline: 'previous', new: 1, recurring: 1, resolved: 1, unverified: 1 });
  assert.equal(current.scenarios[0].change, 'recurring');
  assert.equal(compareRuns(current, { scenarios: [] }).available, false);
});
