import type { APIRequestContext, Page } from '@playwright/test';
import type { InventoryPage } from './inventory';
import { analyzeSeo, type SeoDocument, type SeoFinding } from './seo-audit';
import { assertNotLimited, isLimited } from './pacing';
import { publicUrl } from '../scripts/platform-config';
import { sitemapFindings } from './sitemap-audit';

type Finding = SeoFinding & { urls: string[] };
type Snapshot = {
  document: SeoDocument;
  collection: boolean;
  grid: boolean;
  unreadableGrid: boolean;
  products: string[];
  pagination: string[];
  dynamicPagination: boolean;
  total: number | null;
  empty: boolean;
  errorTemplate: boolean;
  links: string[];
};
type CrawledPage = Snapshot & { requested: string; redirects: string[] };
const key = (value: string) => {
  const url = new URL(value);
  url.hash = '';
  url.searchParams.sort();
  return url.href;
};
function isFiltered(value: string) {
  const url = new URL(value);
  return (
    [...url.searchParams.keys()].some(name =>
      /^(?:sort_by|orderby|order|filter[._].+|query_type_.+|min_price|max_price|rating_filter|q|s)$/i.test(
        name,
      ),
    ) ||
    /\/collections\/[^/]+\/[^/]+\/?$/.test(url.pathname) ||
    /\/search\/?$/.test(url.pathname)
  );
}

async function readHtml(
  page: Page,
  html: string,
  url: string,
  status: number,
  robots: string,
): Promise<Snapshot> {
  return page.evaluate(
    ({ html, url, status, robots }) => {
      const document = new DOMParser().parseFromString(html, 'text/html');
      const contents = (selector: string, attribute?: string) =>
        Array.from(document.querySelectorAll(selector)).map(node =>
          attribute ? node.getAttribute(attribute) || '' : node.textContent || '',
        );
      const hrefs = (selector: string) =>
        contents(selector, 'href').flatMap(href => {
          try {
            return [new URL(href, url).href];
          } catch {
            return [];
          }
        });
      const main = document.querySelector('main, [role="main"], #main-content') || document.body;
      const grid = main.querySelector(
        '#product-grid, .product-grid, [data-product-grid], ul.products, .wc-block-product-template',
      );
      const products = grid
        ? Array.from(grid.querySelectorAll('a[href]')).flatMap(node => {
            if (
              !node.matches(
                '.woocommerce-LoopProduct-link, .woocommerce-loop-product__link, .wc-block-components-product-name, .wc-block-components-product-name a',
              ) &&
              !/\/products\//.test(node.getAttribute('href') || '')
            )
              return [];
            const href = node.getAttribute('href') || '';
            try {
              const product = new URL(href, url);
              if (/\/(?:cart|checkout|account)(?:\/|$)/.test(product.pathname)) return [];
              product.search = '';
              product.hash = '';
              // Shopify links may be scoped to a collection; product identity is global.
              product.pathname = product.pathname.replace(
                /\/collections\/[^/]+\/products\//,
                '/products/',
              );
              return [product.href];
            } catch {
              return [];
            }
          })
        : [];
      const headings = contents('h1');
      const titles = contents('head title');
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
      const parts: string[] = [];
      while (walker.nextNode()) {
        if (!walker.currentNode.parentElement?.closest('script, style, [hidden]'))
          parts.push(walker.currentNode.textContent || '');
      }
      const text = parts.join(' ');
      const count =
        text.match(/\b(?:showing\s+\d+\s*[–-]\s*\d+\s+of|of)\s+(\d+)\s+(?:results|products)\b/i) ||
        text.match(/\b(\d+)\s+products\b/i);
      return {
        document: {
          url,
          status,
          titles,
          descriptions: contents('head meta[name="description" i]', 'content'),
          canonicals: contents('head link[rel~="canonical" i]', 'href'),
          robots: [
            ...contents('head meta[name="robots" i], head meta[name="googlebot" i]', 'content'),
            robots,
          ].filter(Boolean),
          ogUrls: contents('head meta[property="og:url" i]', 'content'),
          headings,
          jsonLd: contents('script[type="application/ld+json" i]'),
        },
        collection:
          /\/collections\/[^/]+(?:\/[^/]+)?\/?$/.test(new URL(url).pathname) ||
          /(?:^|\s)(?:tax-product_cat|post-type-archive-product)(?:\s|$)/.test(
            document.body.className,
          ),
        grid: Boolean(grid),
        unreadableGrid: Boolean(
          grid &&
          Array.from(
            grid.querySelectorAll(
              'li.product, li.grid__item, .product-card, .card-wrapper, .wc-block-product, [data-product-id]',
            ),
          ).some(
            card =>
              !card.querySelector(
                'a.woocommerce-LoopProduct-link, a.woocommerce-loop-product__link, a.wc-block-components-product-name, .wc-block-components-product-name a, a[href*="/products/"]',
              ),
          ),
        ),
        products: [...new Set(products)],
        pagination: hrefs(
          'a[rel~="next"], .pagination a[href], .woocommerce-pagination a[href], nav[aria-label*="pagination" i] a[href], nav[aria-label*="pages" i] a[href], .wc-block-pagination a[href]',
        ),
        dynamicPagination: Boolean(
          document.querySelector(
            '[data-infinite-scroll], infinite-scroll, [class*="infinite-scroll"], [class*="load-more"], [id*="load-more"], [data-load-more], .wc-block-product-button-load-more',
          ),
        ),
        total: count ? Number(count[1]) : null,
        empty:
          /\b(?:no products (?:were found|found|available)|there are no products|this collection is empty)\b|няма (?:намерени |налични )?продукти/i.test(
            text,
          ),
        errorTemplate:
          [...titles, ...headings].some(value =>
            /^\s*(?:404(?:\b.*)?|page (?:not found|doesn['’]t exist)|(?:sorry[,!]?\s*)?(?:we couldn['’]t find (?:that|this) page)|страницата не е намерена)\s*[.!]?(?:\s*[|–—-].*)?$/i.test(
              value,
            ),
          ) ||
          Boolean(
            document.querySelector('.error404, .template-404, [data-template="404"]') ||
            document.body.classList.contains('error404'),
          ),
        links: hrefs('a[href]'),
      };
    },
    { html, url, status, robots },
  );
}

export async function auditSeoPages(
  page: Page,
  request: APIRequestContext,
  base: string,
  sitemapUrls: string[],
  inventory: InventoryPage[] = [],
) {
  const origin = new URL(base).origin;
  const sitemap = new Set(sitemapUrls.map(key));
  const pending = [
    ...new Set(
      [
        ...sitemapUrls,
        ...inventory.filter(entry => entry.type !== 'cart').map(entry => entry.url),
      ].map(key),
    ),
  ];
  const cache = new Map<string, CrawledPage | null>();
  const findings: Finding[] = [];
  const errors: { url: string; message: string }[] = [];
  const collections: {
    url: string;
    products: string[];
    pages: string[];
    complete: boolean;
    indexable: boolean;
    canonical: string | null;
  }[] = [];
  const add = (severity: Finding['severity'], code: string, detail: string, urls: string[]) =>
    findings.push({ severity, code, detail, urls });
  function safe(value: string) {
    const url = new URL(publicUrl(value, origin, 'SEO crawl'));
    if (
      /\/(?:cart|checkout|my-account|account)(?:\/|$)/i.test(url.pathname) ||
      [...url.searchParams.keys()].some(name =>
        /^(?:add[-_]to[-_]cart|remove_item|undo_item|wc-ajax|action|_wpnonce)$/i.test(name),
      )
    )
      throw new Error('Skipped a session/action URL; only public content is crawled.');
    return url.href;
  }
  async function visit(value: string): Promise<CrawledPage | null> {
    value = key(value);
    if (isLimited()) return null;
    if (cache.has(value)) return cache.get(value)!;
    // shortcut: cap public HTML reads at 200 per audit, increase for larger sites.
    if (cache.size >= 200) {
      if (!errors.some(error => error.message.startsWith('Page limit')))
        errors.push({ url: value, message: 'Page limit (200) reached; coverage is incomplete.' });
      return null;
    }
    cache.set(value, null);
    try {
      let target = safe(value);
      const redirects: string[] = [];
      let response = await request.get(target, { maxRedirects: 0 });
      assertNotLimited();
      while (response.status() >= 300 && response.status() < 400) {
        if (redirects.length >= 5 || !response.headers().location)
          throw new Error('Invalid or excessive page redirects');
        redirects.push(target);
        target = safe(new URL(response.headers().location, target).href);
        await response.dispose();
        response = await request.get(target, { maxRedirects: 0 });
        assertNotLimited();
      }
      if (response.status() >= 400)
        add('error', 'page-http-status', `HTTP ${response.status()}`, [value]);
      if (sitemap.has(value) && redirects.length)
        add(
          'warning',
          'sitemap-redirect',
          `Sitemap URL redirects (${redirects.length} hop(s)); list the final URL instead.`,
          [value, target],
        );
      if (redirects.length > 1)
        add('warning', 'redirect-chain', 'Multiple redirects before reaching content.', [
          ...redirects,
          target,
        ]);
      if (
        !/\b(?:text\/html|application\/xhtml\+xml)\b/i.test(
          response.headers()['content-type'] || '',
        )
      )
        throw new Error('Response is not HTML; content checks incomplete.');
      const snapshot = await readHtml(
        page,
        await response.text(),
        target,
        response.status(),
        response.headers()['x-robots-tag'] || '',
      );
      await response.dispose();
      const result = analyzeSeo({ url: target, type: 'static', language: '' }, snapshot.document);
      if (sitemap.has(value) && !result.indexable)
        add(
          'error',
          'sitemap-noindex',
          'Sitemap URL declares noindex/none in meta or X-Robots-Tag.',
          [value],
        );
      if (sitemap.has(value) && result.canonical && key(result.canonical) !== key(target))
        add('warning', 'sitemap-canonical', 'Sitemap URL canonicalizes to a different URL.', [
          value,
          result.canonical,
        ]);
      if (response.status() === 200 && snapshot.errorTemplate)
        add(
          'warning',
          'soft-404',
          'HTTP 200 with a likely error-page title, heading or template marker.',
          [value],
        );
      if (
        isFiltered(value) &&
        response.status() === 200 &&
        result.indexable &&
        (!result.canonical || key(result.canonical) === key(target))
      )
        add(
          'warning',
          'indexable-filter',
          'Filter/sort/search URL has no noindex and no canonical consolidation in public HTML. Review whether it should be indexed.',
          [value],
        );
      for (const link of snapshot.links) {
        if (new URL(link).origin !== origin || !isFiltered(link)) continue;
        try {
          const url = key(safe(key(link)));
          if (!cache.has(url) && !pending.includes(url)) pending.push(url);
        } catch {
          /* Action and external URLs are never followed. */
        }
      }
      const crawled = { ...snapshot, requested: value, redirects };
      cache.set(value, crawled);
      return crawled;
    } catch (error) {
      errors.push({ url: value, message: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }
  for (let index = 0; index < pending.length; index++) {
    if (isLimited()) break;
    const url = pending[index];
    const root = await visit(url);
    if (
      !root ||
      !(
        root.collection ||
        inventory.some(entry => entry.type === 'collection' && key(entry.url) === url)
      ) ||
      isFiltered(url) ||
      /\/page\/\d+\/?$/.test(new URL(url).pathname) ||
      ['page', 'paged', 'product-page'].some(name => new URL(url).searchParams.has(name)) ||
      root.redirects.length
    )
      continue;
    const seo = analyzeSeo({ url, type: 'collection', language: '' }, root.document);
    const collection = {
      url,
      products: [] as string[],
      pages: [] as string[],
      complete: true,
      indexable: seo.indexable && root.document.status === 200,
      canonical: seo.canonical,
    };
    const queue = [url];
    const visited = new Set<string>();
    const products = new Set<string>();
    let expected: number | null = null;
    while (queue.length) {
      const next = queue.shift()!;
      if (visited.has(next)) continue;
      if (visited.size >= 50 || isLimited()) {
        collection.complete = false;
        break;
      }
      visited.add(next);
      const current = await visit(next);
      if (
        !current ||
        current.document.status !== 200 ||
        current.redirects.length ||
        current.errorTemplate
      ) {
        collection.complete = false;
        continue;
      }
      if (!current.grid || current.unreadableGrid || current.dynamicPagination)
        collection.complete = false;
      if (current.total !== null) expected = Math.max(expected || 0, current.total);
      for (const product of current.products) {
        try {
          products.add(key(safe(product)));
        } catch {
          collection.complete = false;
        }
      }
      for (const link of current.pagination) {
        const candidate = new URL(link);
        const rootUrl = new URL(url);
        const path = candidate.pathname.replace(/\/page\/\d+\/?$/, '').replace(/\/$/, '');
        const rootPath = rootUrl.pathname.replace(/\/$/, '');
        const names = [...candidate.searchParams.keys()];
        if (
          path !== rootPath ||
          names.some(name => !['page', 'paged', 'product-page'].includes(name))
        ) {
          collection.complete = false;
          continue;
        }
        try {
          queue.push(key(safe(key(link))));
        } catch {
          collection.complete = false;
        }
      }
    }
    collection.products = [...products].sort();
    collection.pages = [...visited];
    if (expected !== null && expected !== products.size) collection.complete = false;
    if (
      !products.size &&
      collection.indexable &&
      (root.empty || collection.complete || root.total === 0)
    )
      add(
        'warning',
        'empty-collection',
        'Indexable category has an empty product grid, zero total, or explicit empty-product message.',
        [url],
      );
    if (!collection.complete)
      add(
        'warning',
        'collection-incomplete',
        'Product set could not be verified completely (grid, pagination, count or read limit); excluded from duplicate comparison.',
        [url],
      );
    collections.push(collection);
  }
  const groups = new Map<string, typeof collections>();
  for (const collection of collections) {
    if (!collection.complete || !collection.indexable || !collection.products.length) continue;
    const signature = JSON.stringify(collection.products);
    groups.set(signature, [...(groups.get(signature) || []), collection]);
  }
  for (const group of groups.values()) {
    if (new Set(group.map(collection => key(collection.canonical || collection.url))).size > 1)
      add(
        'warning',
        'duplicate-collection-products',
        `Identical complete observed product sets (${group[0].products.length} products) across categories with different canonicals. Review content and intended category structure.`,
        group.map(collection => collection.url),
      );
  }
  findings.push(
    ...sitemapFindings(pending.filter(url => !sitemap.has(key(url)))).filter(
      finding => finding.code === 'url-year',
    ),
  );
  return {
    schemaVersion: 1,
    unreadUrls: pending.filter(url => !cache.get(key(url))),
    pages: [...cache.values()].filter(value => value !== null),
    collections,
    findings,
    errors,
  };
}
