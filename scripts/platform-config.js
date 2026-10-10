'use strict';
const path = require('node:path');
const { validateConfigShape } = require('../config/config-validation');
const SHARED = [
  '12-performance.spec.ts',
  '29-content.spec.ts',
  '30-inventory-visual.spec.ts',
  '32-shared-pages.spec.ts',
  '35-seo-inventory.spec.ts',
  '36-buyer-journey.spec.ts',
];
function compatibleSpec(file, platform) {
  const name = path.basename(file);
  if (!/^\d\d-.*\.spec\.ts$/.test(name) || SHARED.includes(name)) return true;
  return name === '34-woocommerce.spec.ts' ? platform === 'woocommerce' : platform === 'shopify';
}
function publicUrl(value, base, label) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\\'))
    throw new Error(`${label} must be a public storefront URL`);
  const url = new URL(value, base.endsWith('/') ? base : base + '/');
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.origin !== new URL(base).origin ||
    url.username ||
    url.password ||
    url.hash ||
    /(?:^|\/)(?:wp-admin|admin)(?:\/|$)/i.test(decodeURIComponent(url.pathname))
  )
    throw new Error(
      `${label} must stay on the storefront origin without credentials, fragments or admin routes`,
    );
  return url.href;
}
function commerceSettings(input = {}, platform = 'shopify', base = 'https://example.test') {
  if (platform === 'shopify') input = {};
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('commerce must be an object');
  const prefix = new URL(base).pathname.replace(/\/$/, '');
  const apiRoot = input.apiRoot || `${prefix}/wp-json/wc/store/v1`;
  const productUrls = input.productUrls || [];
  const productIds = input.productIds || [];
  const routes = input.routes || {};
  const uiProfile = input.uiProfile || 'auto',
    taxDisplay = input.taxDisplay || 'auto';
  validateConfigShape('commerce', {
    ...input,
    apiRoot,
    productUrls,
    productIds,
    routes,
    uiProfile,
    taxDisplay,
  });
  const api = new URL(publicUrl(apiRoot, base, 'commerce.apiRoot'));
  if (!/\/wc\/store\/v1\/?$/.test(api.pathname) || api.search)
    throw new Error('commerce.apiRoot must name the public wc/store/v1 API');
  const defaults = {
    catalog: `${prefix}/shop/`,
    cart: `${prefix}/cart/`,
    checkout: `${prefix}/checkout/`,
    search: `${prefix}/?s={query}&post_type=product`,
  };
  const resolvedRoutes = Object.fromEntries(
    Object.entries({ ...defaults, ...routes }).map(([key, value]) => [
      key,
      publicUrl(value, base, `commerce.routes.${key}`),
    ]),
  );
  return {
    productUrls: [...new Set(productUrls.map(url => publicUrl(url, base, 'commerce.productUrls')))],
    productIds: [...new Set(productIds)],
    apiRoot: api.href.replace(/\/$/, ''),
    routes: resolvedRoutes,
    uiProfile,
    taxDisplay,
  };
}
function storeApiUrl(settings, endpoint, query = {}) {
  if (settings.platform !== 'woocommerce')
    throw new Error('WooCommerce Store API cannot be used for this platform');
  if (!/^(products(?:\/\d+)?|cart(?:\/items|\/remove-item)?)$/.test(endpoint))
    throw new Error('Unsupported public WooCommerce endpoint');
  const url = new URL(settings.commerce.apiRoot + '/' + endpoint);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  return url.href;
}
function productReferences(settings, base, env = process.env) {
  if (settings.platform === 'woocommerce')
    return settings.commerce.productUrls.map(url => ({
      handle: decodeURIComponent(
        new URL(url).pathname.split('/').filter(Boolean).at(-1) || 'product',
      ),
      url,
    }));
  return [env.PRODUCT_HANDLE || 'zerno-z1', env.PRODUCT_HANDLE_2 || 'zerno-z2'].map(handle => ({
    handle,
    url: `${base}/products/${encodeURIComponent(handle)}`,
  }));
}
function storefrontRoute(settings, base, kind, searchTerm = '') {
  if (settings.platform === 'woocommerce')
    return settings.commerce.routes[kind].replace(
      /(?:%7Bquery%7D|\{query\})/gi,
      encodeURIComponent(searchTerm),
    );
  const routes = {
    catalog: '/collections/all',
    cart: '/cart',
    checkout: '/checkout',
    search: `/search?q=${encodeURIComponent(searchTerm)}&type=product`,
  };
  return base.replace(/\/$/, '') + routes[kind];
}
module.exports = {
  compatibleSpec,
  publicUrl,
  commerceSettings,
  storeApiUrl,
  productReferences,
  storefrontRoute,
};
