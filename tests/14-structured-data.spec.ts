/**
 * Structured Data & Open Graph tests
 *
 * Validates JSON-LD schemas and OG meta tags for:
 *  - SEO rich snippets (Product, WebSite, Organization)
 *  - Social sharing previews (og:title, og:image, og:description)
 *  - Technical SEO (canonical URLs, sitemap, robots.txt)
 */
import { test, expect } from '@playwright/test';
import { BASE, KNOWN_PRODUCT } from './helpers';

// ─── Shared helpers ──────────────────────────────────────────────────────────

type AnyPage = import('@playwright/test').Page;

/** Parse all JSON-LD script tags on the current page. */
async function getJsonLd(page: AnyPage): Promise<unknown[]> {
  return page.$$eval('script[type="application/ld+json"]', (scripts) =>
    scripts
      .map((s) => {
        try { return JSON.parse(s.textContent ?? ''); }
        catch { return null; }
      })
      .filter(Boolean),
  );
}

/** Find the first schema of a given @type (also searches @graph arrays). */
function findSchema(
  schemas: unknown[],
  type: string,
): Record<string, unknown> | undefined {
  for (const s of schemas as Record<string, unknown>[]) {
    if (s['@type'] === type) return s;
    const graph = s['@graph'];
    if (Array.isArray(graph)) {
      const found = (graph as Record<string, unknown>[]).find((g) => g['@type'] === type);
      if (found) return found;
    }
  }
  return undefined;
}

/** Read a <meta property|name="…"> content attribute. */
async function getMeta(page: AnyPage, prop: string): Promise<string | null> {
  return page
    .$eval(
      `meta[property="${prop}"], meta[name="${prop}"]`,
      (el) => el.getAttribute('content'),
    )
    .catch(() => null);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('14 · Structured Data & Open Graph', () => {

  // ── Homepage JSON-LD ───────────────────────────────────────────────────────

  test('homepage — has WebSite, Organization, or Store JSON-LD', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    const schemas = await getJsonLd(page);
    console.log(`Homepage JSON-LD types: ${(schemas as Record<string, unknown>[]).map(s => s['@type']).join(', ')}`);

    const found = findSchema(schemas, 'WebSite')
      ?? findSchema(schemas, 'Organization')
      ?? findSchema(schemas, 'Store');

    expect(
      found,
      `No WebSite / Organization / Store schema found on homepage`,
    ).toBeDefined();
  });

  test('homepage — og:title and og:description are present', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });

    const ogTitle       = await getMeta(page, 'og:title');
    const ogDescription = await getMeta(page, 'og:description');

    expect(ogTitle,       'og:title meta tag is missing or empty').toBeTruthy();
    expect(ogDescription, 'og:description meta tag is missing or empty').toBeTruthy();
  });

  test('homepage — og:image is an absolute URL', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });

    const ogImage = await getMeta(page, 'og:image');
    console.log(`Homepage og:image: ${ogImage?.slice(0, 80)}`);

    expect(ogImage, 'og:image meta tag is missing').toBeTruthy();
    expect(
      ogImage?.startsWith('http') || ogImage?.startsWith('//'),
      `og:image "${ogImage}" is not an absolute URL`,
    ).toBe(true);
  });

  // ── Product page JSON-LD ──────────────────────────────────────────────────

  test('product page — has Product JSON-LD schema', async ({ page }) => {
    await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });
    const schemas = await getJsonLd(page);

    const product = findSchema(schemas, 'Product');
    expect(
      product,
      `No Product schema found. Schemas: ${(schemas as Record<string, unknown>[]).map(s => s['@type']).join(', ')}`,
    ).toBeDefined();
  });

  test('product page — Product schema has name and offers', async ({ page }) => {
    await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });
    const schemas = await getJsonLd(page);
    const product = findSchema(schemas, 'Product');

    if (!product) {
      test.skip(true, 'No Product schema — covered by previous test');
      return;
    }

    expect(product['name'], 'Product schema missing "name"').toBeTruthy();
    expect(product['offers'], 'Product schema missing "offers"').toBeDefined();

    // Validate offers fields
    const raw = product['offers'];
    const offer = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown>;
    if (offer && typeof offer === 'object') {
      expect(
        offer['price'] ?? offer['lowPrice'],
        'Offer missing "price" or "lowPrice"',
      ).toBeDefined();
      expect(offer['priceCurrency'], 'Offer missing "priceCurrency"').toBeTruthy();
    }
  });

  test('product page — Product schema has image field', async ({ page }) => {
    await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });
    const schemas = await getJsonLd(page);
    const product = findSchema(schemas, 'Product');

    if (!product) {
      test.skip(true, 'No Product schema');
      return;
    }

    expect(product['image'], 'Product schema missing "image"').toBeDefined();

    if (!product['description']) {
      console.warn('Product schema is missing "description" (recommended for rich snippets)');
    }
  });

  test('product page — og:title and og:image are present', async ({ page }) => {
    await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });

    const ogTitle = await getMeta(page, 'og:title');
    const ogImage = await getMeta(page, 'og:image');
    const ogType  = await getMeta(page, 'og:type');

    console.log(`Product OG: title="${ogTitle}", type="${ogType}", image="${ogImage?.slice(0, 60)}"`);

    expect(ogTitle, 'og:title missing on product page').toBeTruthy();
    expect(ogImage, 'og:image missing on product page').toBeTruthy();

    if (ogType) {
      expect(
        ['product', 'website'].includes(ogType),
        `og:type "${ogType}" should be "product" or "website"`,
      ).toBe(true);
    }
  });

  test('product page — has absolute canonical URL', async ({ page }) => {
    await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });

    const canonical = await page
      .$eval('link[rel="canonical"]', (el) => el.getAttribute('href'))
      .catch(() => null);

    expect(canonical, 'Missing <link rel="canonical"> on product page').toBeTruthy();
    expect(
      canonical?.startsWith('http'),
      `Canonical URL "${canonical}" should be absolute`,
    ).toBe(true);
  });

  // ── Collections page ──────────────────────────────────────────────────────

  test('collections page — og:title is set', async ({ page }) => {
    await page.goto(`${BASE}/collections`, { waitUntil: 'domcontentloaded' });
    const ogTitle = await getMeta(page, 'og:title');
    expect(ogTitle, 'og:title missing on collections page').toBeTruthy();
  });

  // ── Technical SEO ─────────────────────────────────────────────────────────

  test('sitemap.xml is accessible and valid', async ({ page }) => {
    const resp = await page.goto(`${BASE}/sitemap.xml`, { waitUntil: 'domcontentloaded' });
    expect(resp?.status(), 'sitemap.xml should return HTTP 200').toBe(200);

    const body = await page.evaluate(() => document.documentElement.innerHTML);
    expect(
      body.includes('urlset') || body.includes('sitemapindex'),
      'sitemap.xml does not contain expected XML elements',
    ).toBe(true);
  });

  test('robots.txt is accessible and does not block all crawlers', async ({ page }) => {
    const resp = await page.goto(`${BASE}/robots.txt`, { waitUntil: 'domcontentloaded' });
    expect(resp?.status(), 'robots.txt should return HTTP 200').toBe(200);

    const body = await page.evaluate(() => document.body.innerText ?? document.documentElement.innerHTML);
    expect(body.toLowerCase().includes('user-agent'), 'robots.txt should contain User-agent directive').toBe(true);

    // Must NOT block everything — "Disallow: /" on its own line blocks all crawlers
    const blocksAll = /disallow\s*:\s*\/\s*(\n|$)/i.test(body);
    expect(blocksAll, 'robots.txt has "Disallow: /" — all crawlers are blocked').toBe(false);
  });
});
