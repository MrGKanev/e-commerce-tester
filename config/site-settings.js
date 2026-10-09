'use strict';

const DEFAULTS = {
  locale: 'bg-BG', timezoneId: 'Europe/Sofia', performanceMetrics: { enabled: true, mode: 'report', afterDomMs: 5000, maxPaintMs: 15000, minPaintMs: 500, maxEventMs: 120000 }, capabilities: {}, selectors: {},
  thresholds: {
    webVitals: { lcp: 2500, cls: 0.1, interactionLatency: 200 },
    performance: { ttfb: 2000, domInteractive: 5000, domContentLoaded: 6000, loadComplete: 12000 },
    lighthouse: { performance: 50, accessibility: 80, 'best-practices': 80, seo: 85 },
    accessibility: { maxBlocking: 0, maxViolations: 10, maxContrastNodes: 5 },
    visual: { maxDiffPixelRatio: 0.03 },
  },
  inventory: { discoverProducts: false, productLimit: 5, pages: [] },
  spelling: { mode: 'report', languages: ['bg', 'en'], allowWords: [], acceptedFindings: [], excludeSelectors: [], maxFindings: 0, ocr: { enabled: false, selector: 'img, canvas', minConfidence: 85, maxImages: 3, tessdataPath: '' } },
};
const CAPABILITIES = ['checkout', 'discounts', 'currency', 'language', 'recommendations', 'recentlyViewed', 'newsletter', 'reviews', 'filters', 'variants', 'mobileMenu'];
const SELECTORS = ['addToCart', 'productTitle', 'price', 'cartCount', 'cartItems', 'mobileMenuToggle', 'consentAccept', 'main'];
const TYPES = ['home', 'product', 'collection', 'search', 'cart', 'static'];
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
}
function keys(value, allowed, label) {
  object(value, label);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown ${label} key: ${key}`);
}
function strings(value, label) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) throw new Error(`${label} must be an array of non-empty strings`);
}
function resolveSiteSettings(input = {}) {
  object(input, 'site settings');
  const result = structuredClone(DEFAULTS);
  result.locale = input.locale ?? result.locale;
  result.timezoneId = input.timezoneId ?? result.timezoneId;
  if (typeof result.locale !== 'string' || Intl.getCanonicalLocales(result.locale).length !== 1) throw new Error('Invalid locale');
  new Intl.DateTimeFormat(result.locale, { timeZone: result.timezoneId });
  if (input.performanceMetrics !== undefined) {
    keys(input.performanceMetrics, Object.keys(DEFAULTS.performanceMetrics), 'performanceMetrics');
    Object.assign(result.performanceMetrics, input.performanceMetrics);
  }
  const metrics = result.performanceMetrics;
  if (typeof metrics.enabled !== 'boolean' || !['report', 'strict'].includes(metrics.mode) || ['afterDomMs', 'maxPaintMs', 'minPaintMs', 'maxEventMs'].some(key => !Number.isFinite(metrics[key]) || metrics[key] < 0) || metrics.minPaintMs > metrics.afterDomMs || metrics.afterDomMs > metrics.maxPaintMs || metrics.maxEventMs < metrics.maxPaintMs) throw new Error('Invalid performanceMetrics observation settings');
  if (input.capabilities !== undefined) {
    keys(input.capabilities, CAPABILITIES, 'capabilities');
    for (const [key, value] of Object.entries(input.capabilities)) {
      if (typeof value !== 'boolean') throw new Error(`capabilities.${key} must be boolean`);
      result.capabilities[key] = value;
    }
  }
  if (input.selectors !== undefined) {
    keys(input.selectors, SELECTORS, 'selectors');
    for (const [key, value] of Object.entries(input.selectors)) {
      if (typeof value !== 'string' || !value.trim()) throw new Error(`selectors.${key} must be a non-empty CSS selector`);
      result.selectors[key] = value;
    }
  }
  if (input.thresholds !== undefined) {
    keys(input.thresholds, Object.keys(DEFAULTS.thresholds), 'thresholds');
    for (const [group, values] of Object.entries(input.thresholds)) {
      keys(values, Object.keys(DEFAULTS.thresholds[group]), `thresholds.${group}`);
      for (const [key, value] of Object.entries(values)) {
        const maximum = group === 'lighthouse' ? 100 : group === 'visual' ? 1 : Infinity;
        if (!Number.isFinite(value) || value < 0 || value > maximum) throw new Error(`Invalid threshold ${group}.${key}`);
        result.thresholds[group][key] = value;
      }
    }
  }
  if (input.inventory !== undefined) {
    keys(input.inventory, Object.keys(DEFAULTS.inventory), 'inventory');
    Object.assign(result.inventory, input.inventory);
  }
  if (typeof result.inventory.discoverProducts !== 'boolean' || !Number.isInteger(result.inventory.productLimit) || result.inventory.productLimit < 1 || result.inventory.productLimit > 25) throw new Error('Inventory discovery must be boolean with productLimit 1–25');
  if (!Array.isArray(result.inventory.pages)) throw new Error('inventory.pages must be an array');
  for (const page of result.inventory.pages) {
    keys(page, ['path', 'type', 'language'], 'inventory page');
    if (typeof page.path !== 'string' || !page.path.startsWith('/') || page.path.startsWith('//') || page.path.includes('\\') || !TYPES.includes(page.type)) throw new Error('Inventory pages require an internal path and supported type');
    if (page.language !== undefined && (typeof page.language !== 'string' || !page.language.trim() || Intl.getCanonicalLocales(page.language).length !== 1)) throw new Error('Inventory page language must be a string');
  }
  if (input.spelling !== undefined) {
    keys(input.spelling, Object.keys(DEFAULTS.spelling), 'spelling');
    Object.assign(result.spelling, input.spelling);
    if (input.spelling.ocr !== undefined) keys(input.spelling.ocr, Object.keys(DEFAULTS.spelling.ocr), 'spelling.ocr');
    result.spelling.ocr = { ...DEFAULTS.spelling.ocr, ...(input.spelling.ocr || {}) };
  }
  if (!['off', 'report', 'strict'].includes(result.spelling.mode)) throw new Error('spelling.mode must be off, report or strict');
  for (const key of ['languages', 'allowWords', 'acceptedFindings', 'excludeSelectors']) strings(result.spelling[key], `spelling.${key}`);
  if (!result.spelling.languages.length || result.spelling.languages.some(language => !['bg', 'en'].includes(language))) throw new Error('Spelling currently supports bg and en');
  if (!Number.isInteger(result.spelling.maxFindings) || result.spelling.maxFindings < 0) throw new Error('spelling.maxFindings must be a non-negative integer');
  const ocr = result.spelling.ocr;
  if (typeof ocr.enabled !== 'boolean' || typeof ocr.selector !== 'string' || !ocr.selector.trim() || typeof ocr.tessdataPath !== 'string' || !Number.isFinite(ocr.minConfidence) || ocr.minConfidence < 0 || ocr.minConfidence > 100 || !Number.isInteger(ocr.maxImages) || ocr.maxImages < 1 || ocr.maxImages > 20) throw new Error('Invalid OCR settings');
  return result;
}
function readSiteSettings() {
  return resolveSiteSettings(process.env.SITE_SETTINGS_JSON ? JSON.parse(process.env.SITE_SETTINGS_JSON) : {
    locale: process.env.STORE_LOCALE || DEFAULTS.locale,
    timezoneId: process.env.STORE_TIMEZONE || DEFAULTS.timezoneId,
  });
}
module.exports = { resolveSiteSettings, readSiteSettings, CAPABILITIES };
