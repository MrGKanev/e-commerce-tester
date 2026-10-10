'use strict';
const fs = require('node:fs');
const { validateConfigShape } = require('../config/config-validation');
const { resolveSiteSettings } = require('../config/site-settings');
function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
function loadSites(file, env = process.env, { requireFile = false, requireHandles = false } = {}) {
  let sites;
  if (fs.existsSync(file)) {
    try {
      sites = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      throw new Error(`sites.json is not valid JSON: ${error.message}`, { cause: error });
    }
  } else {
    if (requireFile) throw new Error(`Store configuration is required: ${file}`);
    const url = env.STORE_URL || 'https://zerno.co';
    const slug = slugify(new URL(url).hostname);
    sites = [
      {
        name: slug,
        slug,
        url,
        productHandle: env.PRODUCT_HANDLE || 'zerno-z1',
        productHandle2: env.PRODUCT_HANDLE_2 || 'zerno-z2',
        searchTerm: env.SEARCH_TERM || slug,
        platform: env.STORE_PLATFORM || 'shopify',
        ...(env.STORE_PLATFORM === 'woocommerce'
          ? {
              commerce: {
                productUrls: env.WOO_PRODUCT_URLS ? JSON.parse(env.WOO_PRODUCT_URLS) : [],
                productIds: env.WOO_PRODUCT_IDS ? JSON.parse(env.WOO_PRODUCT_IDS) : [],
              },
            }
          : {}),
      },
    ];
  }
  return validateSites(sites, env, { requireHandles });
}
function validateSites(sites, env = process.env, { requireHandles = false } = {}) {
  validateConfigShape('sites', sites);
  const seen = new Set();
  return sites.map(input => {
    if (!input || typeof input !== 'object' || typeof input.url !== 'string')
      throw new Error('Each site must be an object with a URL');
    const site = { ...input };
    const platform = site.platform === undefined ? 'shopify' : site.platform;
    if (!['shopify', 'woocommerce'].includes(platform))
      throw new Error('platform must be shopify or woocommerce');
    if (site.platform !== undefined || platform !== 'shopify') site.platform = platform;
    const url = new URL(site.url);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      (platform === 'shopify' && url.pathname !== '/') ||
      url.search ||
      url.hash
    )
      throw new Error(
        'Site URLs must be HTTP(S) origins without credentials, paths, query strings or fragments',
      );
    if (
      platform === 'woocommerce' &&
      /(?:^|\/)(?:wp-admin|admin)(?:\/|$)/i.test(decodeURIComponent(url.pathname))
    )
      throw new Error('WooCommerce URL must identify the public installation, not admin');
    site.url =
      platform === 'woocommerce' ? url.origin + url.pathname.replace(/\/$/, '') : url.origin;
    site.slug ??= slugify(url.hostname);
    if (typeof site.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(site.slug))
      throw new Error('Site slug must contain lowercase letters, digits and single hyphens');
    if (seen.has(site.slug)) throw new Error(`Duplicate site slug: ${site.slug}`);
    seen.add(site.slug);
    for (const field of ['productHandle', 'productHandle2']) {
      if (
        site[field] !== undefined &&
        (typeof site[field] !== 'string' || /[\s/?#]/.test(site[field]))
      )
        throw new Error(`${field} must be a product handle without path/query characters`);
      if (
        platform === 'shopify' &&
        requireHandles &&
        (typeof site[field] !== 'string' || !site[field].trim())
      )
        throw new Error(`Scheduled store ${site.slug} requires ${field}`);
    }
    for (const field of ['name', 'productHandle', 'productHandle2', 'searchTerm', 'discountCode']) {
      if (site[field] !== undefined && typeof site[field] !== 'string')
        throw new Error(`${field} must be a string`);
    }
    site.settings = resolveSiteSettings({
      locale: env.STORE_LOCALE || 'bg-BG',
      timezoneId: env.STORE_TIMEZONE || 'Europe/Sofia',
      ...site,
      platform,
    });
    if (
      platform === 'woocommerce' &&
      requireHandles &&
      !site.settings.commerce.productUrls.length &&
      !site.settings.commerce.productIds.length &&
      !site.settings.inventory.discoverProducts
    )
      throw new Error(
        `Scheduled WooCommerce store ${site.slug} requires product URLs, IDs or explicit discovery`,
      );
    return site;
  });
}
module.exports = { loadSites, validateSites, slugify };
