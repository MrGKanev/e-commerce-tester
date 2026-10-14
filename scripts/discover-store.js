'use strict';
const { chromium } = require('@playwright/test');
async function discoverStore(input) {
  const url = new URL(input.url);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /(?:^|\/)(wp-admin|admin)(?:\/|$)/i.test(decodeURIComponent(url.pathname))
  )
    throw new Error('Enter a public storefront URL without credentials, query or fragment');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const request = route.request();
      const target = new URL(request.url());
      const mutation =
        /\/(?:cart\/(?:add|change|update|clear)|checkout|orders?)(?:\/|\.|$)/i.test(
          target.pathname,
        ) ||
        target.searchParams.has('add-to-cart') ||
        target.searchParams.has('wc-ajax');
      return request.method() === 'GET' && target.origin === url.origin && !mutation
        ? route.continue()
        : route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
    if (!response?.ok()) throw new Error('Storefront could not be loaded');
    const html = await page.content();
    const platform = /wp-content|woocommerce/i.test(html)
      ? 'woocommerce'
      : /cdn\.shopify\.com|\bShopify\s*[.=]/i.test(html)
        ? 'shopify'
        : null;
    if (!platform)
      return {
        platform: null,
        products: [],
        checks: [],
        message: 'Platform could not be recognized. Choose it and configure products manually.',
      };
    const api =
      platform === 'shopify'
        ? new URL('/products.json?limit=6', url)
        : new URL(
            url.pathname.replace(/\/$/, '') + '/wp-json/wc/store/v1/products?per_page=6',
            url.origin,
          );
    const result = await context.request.get(api.href, { timeout: 10000, maxRedirects: 0 });
    if (!result.ok())
      throw new Error(
        `Public product discovery returned HTTP ${result.status()}; enter product URLs manually`,
      );
    if (Number(result.headers()['content-length']) > 2000000)
      throw new Error('Product response is too large');
    const body = await result.body();
    if (body.length > 2000000) throw new Error('Product response is too large');
    const payload = JSON.parse(body.toString());
    const products = platform === 'shopify' ? payload.products : payload;
    if (!Array.isArray(products)) throw new Error('Unsupported product response');
    const candidates = products
      .slice(0, 6)
      .filter(p =>
        platform === 'shopify'
          ? typeof p?.handle === 'string' &&
            /^[^\s/?#]+$/.test(p.handle) &&
            Array.isArray(p.variants) &&
            p.variants.some(v => v?.available === true)
          : p?.is_in_stock === true && p.is_purchasable === true,
      )
      .map(p => ({
        title: String(p.title || p.name),
        url:
          platform === 'shopify'
            ? new URL('/products/' + encodeURIComponent(p.handle), url).href
            : p.permalink,
        handle: platform === 'shopify' ? String(p.handle) : undefined,
      }))
      .filter(p => {
        try {
          const candidate = new URL(p.url);
          return (
            candidate.origin === url.origin &&
            !candidate.username &&
            !candidate.password &&
            !candidate.search &&
            !candidate.hash
          );
        } catch {
          return false;
        }
      });
    const checks = [];
    if (candidates.length) {
      const product = await page.goto(candidates[0].url, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      if (!product?.ok()) throw new Error('Discovered product could not be loaded');
      for (const [name, fallback] of Object.entries({
        productTitle: 'h1',
        price: '[data-product-price], .price .amount, .price-item--regular',
        addToCart: 'button[name="add"], .single_add_to_cart_button',
        searchInput: 'input[type="search"], input[name="q"], input[name="s"]',
      })) {
        const selector = input.selectors?.[name] || fallback;
        if (typeof selector !== 'string' || selector.length > 1000)
          throw new Error('Invalid selector');
        const count = await page.locator(selector).filter({ visible: true }).count();
        checks.push({
          name,
          selector,
          count,
          status: count === 1 ? 'ready' : 'needs-configuration',
        });
      }
    }
    return {
      platform,
      products: candidates,
      checks,
      language: await page.locator('html').getAttribute('lang'),
      message:
        'Read-only sample of up to six public products. Review suggestions before applying; no cart or forms were submitted.',
    };
  } finally {
    await browser.close();
  }
}
module.exports = { discoverStore };
