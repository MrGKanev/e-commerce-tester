'use strict';
const fs = require('node:fs');
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
      throw new Error(`sites.json is not valid JSON: ${error.message}`);
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
      },
    ];
  }
  return validateSites(sites, env, { requireHandles });
}
function validateSites(sites, env = process.env, { requireHandles = false } = {}) {
  if (!Array.isArray(sites) || !sites.length)
    throw new Error('sites.json must be a non-empty array');
  const seen = new Set();
  return sites.map(input => {
    if (!input || typeof input !== 'object' || typeof input.url !== 'string')
      throw new Error('Each site must be an object with a URL');
    const site = { ...input };
    const url = new URL(site.url);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error(
        'Site URLs must be HTTP(S) origins without credentials, paths, query strings or fragments',
      );
    site.url = url.origin;
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
      if (requireHandles && (typeof site[field] !== 'string' || !site[field].trim()))
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
    });
    return site;
  });
}
module.exports = { loadSites, validateSites, slugify };
