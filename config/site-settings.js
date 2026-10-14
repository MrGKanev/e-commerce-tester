'use strict';
const { validateConfigShape } = require('./config-validation');
const { commerceSettings } = require('../scripts/platform-config');

const DEFAULTS = {
  expectations: { minProducts: 0, currency: '', paymentSelector: '', paymentPath: '/checkout' },
  monitorScripts: false,
  markets: [],
  retention: { maxRuns: 30, maxDays: 0, maxBytes: 0 },
  locale: 'bg-BG',
  timezoneId: 'Europe/Sofia',
  performanceMetrics: {
    enabled: true,
    mode: 'report',
    afterDomMs: 5000,
    maxPaintMs: 15000,
    minPaintMs: 500,
    maxEventMs: 120000,
  },
  checkout: {
    mode: 'auto',
    reason: '',
    contact: 'required',
    shippingAddress: 'required',
    requiredAddressFields: ['addressLine1', 'city', 'postalCode', 'country'],
  },
  cookieConsent: { mode: 'accept-all', waitMs: 5000, frameSelector: '' },
  capabilities: {},
  selectors: {},
  thresholds: {
    webVitals: { lcp: 2500, cls: 0.1, interactionLatency: 200 },
    performance: { ttfb: 2000, domInteractive: 5000, domContentLoaded: 6000, loadComplete: 12000 },
    lighthouse: { performance: 50, accessibility: 80, 'best-practices': 80, seo: 85 },
    accessibility: { maxBlocking: 0, maxViolations: 10, maxContrastNodes: 5 },
    visual: { maxDiffPixelRatio: 0.03, components: {} },
  },
  inventory: { discoverProducts: false, productLimit: 5, pages: [] },
  spelling: {
    mode: 'report',
    languages: ['bg', 'en'],
    allowWords: [],
    acceptedFindings: [],
    excludeSelectors: [],
    maxFindings: 0,
    ocr: {
      enabled: false,
      selector: 'img, canvas',
      minConfidence: 85,
      maxImages: 3,
      tessdataPath: '',
    },
  },
};
const CAPABILITIES = [
  'checkout',
  'discounts',
  'currency',
  'language',
  'recommendations',
  'recentlyViewed',
  'newsletter',
  'reviews',
  'filters',
  'variants',
  'mobileMenu',
  'commerceConsistency',
];
function resolveSiteSettings(input = {}) {
  validateConfigShape('settings', input);
  const result = structuredClone(DEFAULTS);
  result.platform = input.platform === undefined ? 'shopify' : input.platform;
  result.commerce = commerceSettings(
    input.commerce,
    result.platform,
    input.url || process.env.STORE_URL || 'https://example.test',
  );
  result.locale = input.locale ?? result.locale;
  result.timezoneId = input.timezoneId ?? result.timezoneId;
  if (Intl.getCanonicalLocales(result.locale).length !== 1) throw new Error('Invalid locale');
  new Intl.DateTimeFormat(result.locale, { timeZone: result.timezoneId });
  for (const key of ['checkoutTotals', 'analytics', 'markets'])
    if (input[key] !== undefined) result[key] = structuredClone(input[key]);
  Object.assign(result.retention, input.retention);
  const names = new Set();
  for (const market of result.markets) {
    if (names.has(market.name)) throw new Error('Market names must be unique');
    names.add(market.name);
    Intl.getCanonicalLocales(market.locale);
    if (market.currency !== market.checkoutTotals.currency)
      throw new Error('Market and checkout currencies must match');
  }
  for (const totals of [result.checkoutTotals, ...result.markets.map(m => m.checkoutTotals)].filter(
    Boolean,
  )) {
    if (
      totals.total !==
      totals.subtotal + totals.shipping + (totals.taxIncluded ? 0 : totals.tax) - totals.discount
    )
      throw new Error('Checkout total must equal subtotal + shipping + exclusive tax - discount');
    if (
      totals.freeShippingThreshold !== undefined &&
      totals.subtotal - totals.discount >= totals.freeShippingThreshold &&
      totals.shipping !== 0
    )
      throw new Error('Expected shipping must be zero above the free shipping threshold');
  }
  Object.assign(result.expectations, input.expectations);
  result.monitorScripts = input.monitorScripts ?? false;
  for (const window of input.notifications?.maintenance || []) {
    if (
      !Number.isFinite(Date.parse(window.start)) ||
      !Number.isFinite(Date.parse(window.end)) ||
      Date.parse(window.end) <= Date.parse(window.start)
    )
      throw new Error('Maintenance requires valid start and end timestamps with end after start');
  }
  Object.assign(result.performanceMetrics, input.performanceMetrics);
  const metrics = result.performanceMetrics;
  if (
    metrics.minPaintMs > metrics.afterDomMs ||
    metrics.afterDomMs > metrics.maxPaintMs ||
    metrics.maxEventMs < metrics.maxPaintMs
  )
    throw new Error('Invalid performanceMetrics observation settings');
  Object.assign(result.cookieConsent, input.cookieConsent);
  Object.assign(result.checkout, input.checkout);
  result.checkout.requiredAddressFields = [...result.checkout.requiredAddressFields];
  Object.assign(result.capabilities, input.capabilities);
  Object.assign(result.selectors, input.selectors);
  for (const [group, values] of Object.entries(input.thresholds || {})) {
    Object.assign(result.thresholds[group], values);
    if (group === 'visual' && values.components)
      result.thresholds.visual.components = { ...values.components };
  }
  Object.assign(result.inventory, input.inventory);
  // Copy collections so callers cannot mutate the original config through resolved settings.
  result.inventory.pages = structuredClone(result.inventory.pages);
  for (const page of result.inventory.pages) {
    if (page.language !== undefined && Intl.getCanonicalLocales(page.language).length !== 1)
      throw new Error('Inventory page language must be a string');
  }
  Object.assign(result.spelling, input.spelling);
  result.spelling.ocr = { ...DEFAULTS.spelling.ocr, ...input.spelling?.ocr };
  for (const key of ['languages', 'allowWords', 'acceptedFindings', 'excludeSelectors'])
    result.spelling[key] = [...result.spelling[key]];
  return result;
}
function readSiteSettings() {
  return resolveSiteSettings(
    process.env.SITE_SETTINGS_JSON
      ? JSON.parse(process.env.SITE_SETTINGS_JSON)
      : {
          locale: process.env.STORE_LOCALE || DEFAULTS.locale,
          timezoneId: process.env.STORE_TIMEZONE || DEFAULTS.timezoneId,
          platform: process.env.STORE_PLATFORM || 'shopify',
          url: process.env.STORE_URL,
        },
  );
}
module.exports = { resolveSiteSettings, readSiteSettings, CAPABILITIES };
