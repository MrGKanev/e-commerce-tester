import { test, expect } from '@playwright/test';
import {
  analyzeSeo,
  inventorySeoFindings,
  readSeoDocument,
  type SeoDocument,
} from '../tests/seo-audit';
import type { InventoryPage } from '../tests/inventory';

const entry: InventoryPage = {
  url: 'https://store.example/product/a',
  type: 'product',
  language: 'en',
};
const good = (): SeoDocument => ({
  url: entry.url,
  status: 200,
  titles: ['Product A'],
  descriptions: ['Description A'],
  canonicals: [entry.url],
  robots: [],
  ogUrls: [entry.url],
  headings: ['Product A'],
  jsonLd: [
    JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'Product', name: 'Product A', url: entry.url }],
    }),
  ],
});
const codes = (document: SeoDocument, page = entry) =>
  analyzeSeo(page, document).findings.map(finding => finding.code);

test('valid product and graph have no findings', () => {
  expect(codes(good())).toEqual([]);
});

test('rejects duplicate/empty metadata and duplicate canonical', () => {
  expect(
    codes({ ...good(), titles: ['', 'A'], descriptions: [], canonicals: [entry.url, entry.url] }),
  ).toEqual(expect.arrayContaining(['title', 'description', 'canonical-count']));
});

test('rejects relative, malformed, credential and fragment canonicals', () => {
  for (const canonical of [
    '/product/a',
    'oops',
    'https://user:secret@store.example/',
    entry.url + '#a',
  ])
    expect(codes({ ...good(), canonicals: [canonical] })).toContain('canonical-url');
});

test('records alternate canonical and social URL mismatch as warnings', () => {
  const result = analyzeSeo(entry, { ...good(), canonicals: ['https://store.example/product/b'] });
  expect(result.findings.filter(finding => finding.severity === 'error')).toEqual([]);
  expect(result.findings.map(finding => finding.code)).toEqual(
    expect.arrayContaining(['alternate-canonical', 'og-url', 'jsonld-url']),
  );
});

test('invalid JSON-LD does not prevent parsing remaining scripts', () => {
  expect(codes({ ...good(), jsonLd: ['{bad}', 'null', ...good().jsonLd] })).toEqual([
    'jsonld-syntax',
    'jsonld-shape',
  ]);
});

test('JSON-LD arrays and nested graph expose visible-name discrepancy', () => {
  expect(
    codes({
      ...good(),
      jsonLd: [
        JSON.stringify([
          { '@graph': [{ '@type': ['Product'], name: 'Wrong', url: entry.url + '?variant=2' }] },
        ]),
      ],
    }),
  ).toEqual(['jsonld-name']);
});

test('noindex meta/header and none exempt indexable metadata requirements', () => {
  for (const robots of ['noindex, follow', 'googlebot: noindex', 'none']) {
    expect(codes({ ...good(), robots: [robots], descriptions: [], canonicals: [] })).toEqual([
      'noindex',
    ]);
  }
  expect(codes({ ...good(), robots: ['index, follow'], descriptions: [] })).toContain(
    'description',
  );
});

test('search/cart exempt canonical and description; syntax still checked', () => {
  for (const type of ['search', 'cart'] as const)
    expect(
      codes(
        { ...good(), descriptions: [], canonicals: [], jsonLd: ['broken'] },
        { ...entry, type },
      ),
    ).toEqual(['jsonld-syntax']);
});

test('cross-page duplicate metadata ignores alternate URLs and noindex', () => {
  const a = analyzeSeo(entry, good());
  const b = analyzeSeo(
    { ...entry, url: 'https://store.example/product/b' },
    {
      ...good(),
      url: 'https://store.example/product/b',
      canonicals: ['https://store.example/product/b'],
    },
  );
  expect(inventorySeoFindings([a, b]).map(finding => finding.code)).toEqual([
    'duplicate-titles',
    'duplicate-descriptions',
  ]);
  expect(
    inventorySeoFindings([a, analyzeSeo(entry, { ...good(), url: entry.url + '?variant=2' })]),
  ).toEqual([]);
  expect(
    inventorySeoFindings([a, analyzeSeo(entry, { ...b.document, robots: ['noindex'] })]),
  ).toEqual([]);
});

test('HTTP failures and missing/multiple visible headings are recorded', () => {
  expect(codes({ ...good(), status: 404, headings: [] })).toEqual(
    expect.arrayContaining(['http-status', 'h1-missing']),
  );
  expect(codes({ ...good(), headings: ['A', 'B'] })).toContain('h1-multiple');
});

test('reads rendered DOM, header robots and all JSON-LD without image requests', async ({
  page,
}) => {
  let requests = 0;
  await page.route('**/*', route => {
    requests++;
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><head><title>Product A</title><meta name="DESCRIPTION" content="Description A"><link rel="canonical" href="${entry.url}"><meta name="robots" content="follow"><meta property="og:url" content="${entry.url}"></head><body><h1 hidden>Hidden</h1><h1>Product A</h1><script type="application/ld+json">${good().jsonLd[0]}</script><script>document.title='Rendered product';</script></body>`,
    });
  });
  await page.goto(entry.url);
  const document = await readSeoDocument(page, 200, 'noindex');
  expect(document.titles).toEqual(['Rendered product']);
  expect(document.headings).toEqual(['Product A']);
  expect(document.robots).toEqual(['follow', 'noindex']);
  expect(document.jsonLd).toHaveLength(1);
  expect(requests).toBe(1);
});

test('canonical targets in inventory expose HTTP errors, noindex and chains', () => {
  const a = analyzeSeo(entry, { ...good(), canonicals: ['https://store.example/product/b'] });
  const bDocument = {
    ...good(),
    url: 'https://store.example/product/b',
    canonicals: ['https://store.example/product/c'],
  };
  for (const document of [
    { ...bDocument, status: 404 },
    { ...bDocument, robots: ['noindex'] },
  ]) {
    expect(
      inventorySeoFindings([a, analyzeSeo(entry, document)]).map(finding => finding.code),
    ).toEqual(expect.arrayContaining(['canonical-target', 'canonical-chain']));
  }
});

test('malformed social URL does not misreport a valid canonical as invalid', () => {
  expect(codes({ ...good(), ogUrls: ['https://[invalid'] })).toEqual(['og-url-invalid']);
});

// All network fixtures below bind only to loopback; no storefront is contacted.
test('sitemap suffix candidates cover both platforms without treating every suffix as a duplicate', async () => {
  const { sitemapFindings } = await import('../tests/sitemap-audit');
  const origin = 'https://store.example';
  const paths = [
    '/collections/gifts',
    '/collections/gifts-1',
    '/collections/gifts-2',
    '/product-category/gifts/',
    '/product-category/gifts-old/',
    '/products/mug',
    '/products/mug-new',
    '/products/mug-copy-2',
    '/products/mug-backup',
    '/products/mug-draft',
    '/products/mug-test',
    '/products/mug-duplicate',
    '/products/mug-temp',
    '/products/mug-tmp',
    '/pages/about',
    '/pages/about-copy',
    '/products/standalone-old',
    '/products/model-2026',
    '/fr/collections/gifts-old',
    '/collections/gifts/products/mug-old',
  ];
  const findings = sitemapFindings(paths.map(path => origin + path)).filter(
    finding => finding.code === 'sitemap-suffix-pair',
  );
  expect(findings).toHaveLength(12);
  expect(findings.every(finding => finding.severity === 'warning')).toBe(true);
  expect(findings.every(finding => finding.urls.length === 2)).toBe(true);
  expect(
    sitemapFindings([
      origin + '/a',
      origin + '/a/',
      origin + '/a?sort=price',
      origin + '/b#top',
    ]).map(finding => finding.code),
  ).toEqual(['sitemap-duplicate-url', 'sitemap-parameters', 'sitemap-parameters']);
});

test('sitemap scanner handles Shopify/Woo indexes, XML entities, fallback, redirects and failures locally', async ({
  page,
  request,
}) => {
  const { createServer } = await import('node:http');
  const { auditSitemaps } = await import('../tests/sitemap-audit');
  let mode = 'shopify';
  const requested: string[] = [];
  const server = createServer((req, res) => {
    requested.push(req.url!);
    res.setHeader('Content-Type', 'application/xml');
    if (req.url === '/sitemap.xml') {
      if (mode === 'fallback') {
        res.writeHead(404).end();
        return;
      }
      if (mode === 'redirect') {
        res.writeHead(301, { Location: '/index.xml' }).end();
        return;
      }
      if (mode === 'external-redirect') {
        res.writeHead(302, { Location: 'https://external.invalid/sitemap.xml' }).end();
        return;
      }
      if (mode === 'invalid') {
        res.end('<urlset><broken>');
        return;
      }
      if (mode === 'missing-loc') {
        res.end('<urlset><url/></urlset>');
        return;
      }
      if (mode === 'http') {
        res.writeHead(503).end();
        return;
      }
      if (mode === 'external') {
        res.end(
          '<sitemapindex><sitemap><loc>https://external.invalid/map.xml</loc></sitemap></sitemapindex>',
        );
        return;
      }
    }
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No fixture port');
    const origin = `http://127.0.0.1:${address.port}`;
    if (mode === 'limit') {
      const next = Number(req.url!.match(/map(\d+)/)?.[1] || 0) + 1;
      res.end(
        `<sitemapindex><sitemap><loc>${origin}/map${next}.xml</loc></sitemap></sitemapindex>`,
      );
      return;
    }
    if (req.url === '/sitemap.xml' || req.url === '/index.xml') {
      res.end(
        `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${origin}/catalog.xml</loc></sitemap><sitemap><loc>${origin}/index.xml</loc></sitemap></sitemapindex>`,
      );
    } else {
      const path = mode === 'shopify' ? '/collections/gifts' : '/product-category/gifts';
      res.end(
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}${path}</loc><image:image xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"><image:loc>https://images.invalid/a.jpg</image:loc></image:image></url><url><loc>${origin}${path}-old</loc></url><url><loc>${origin}${path}?a=1&amp;b=2</loc></url></urlset>`,
      );
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No fixture port');
    const origin = `http://127.0.0.1:${address.port}`;
    for (mode of ['shopify', 'woo', 'fallback', 'redirect']) {
      requested.length = 0;
      const audit = await auditSitemaps(page, request, origin);
      expect(audit.errors).toEqual([]);
      expect(audit.urls).toHaveLength(3);
      expect(audit.findings.map(finding => finding.code)).toEqual([
        'sitemap-suffix-pair',
        'sitemap-parameters',
      ]);
      expect(audit.urls[2]).toContain('?a=1&b=2');
      expect(new Set(requested).size).toBe(requested.length);
    }
    mode = 'limit';
    requested.length = 0;
    const limited = await auditSitemaps(page, request, origin);
    expect(limited.errors).toHaveLength(1);
    expect(limited.errors[0].message).toContain('coverage is incomplete');
    expect(requested).toHaveLength(100);
    for (mode of ['invalid', 'missing-loc', 'http', 'external', 'external-redirect']) {
      const audit = await auditSitemaps(page, request, origin);
      expect(audit.errors).toHaveLength(1);
      expect(audit.urls).toEqual([]);
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  }
});

test('year warnings cover dated paths and queries without matching longer numbers', async () => {
  const { sitemapFindings } = await import('../tests/sitemap-audit');
  const urls = ['/sale-2024', '/blog/1999/post', '/offers?year=2026', '/sku-120260', '/model-1899'];
  expect(
    sitemapFindings(urls.map(path => 'https://store.example' + path))
      .filter(finding => finding.code === 'url-year')
      .map(finding => finding.urls[0]),
  ).toEqual(urls.slice(0, 3).map(path => 'https://store.example' + path));
});

test('public SEO crawl verifies full paginated sets, sitemap health, soft errors and linked filters for both platforms', async ({
  page,
  request,
}) => {
  const { createServer } = await import('node:http');
  const { auditSeoPages } = await import('../tests/seo-crawl');
  let origin = '';
  const requested: string[] = [];
  const products = (ids: string[], woo = false) =>
    `<ul ${woo ? 'class="products"' : 'id="product-grid"'}>${ids.map(id => `<li class="product"><a ${woo ? 'class="woocommerce-LoopProduct-link"' : ''} href="${woo ? '/goods/' : id === 'b' ? '/collections/example/products/' : '/products/'}${id}${id === 'a' ? '?variant=42&utm_source=test' : ''}">${id}</a><a href="/?add-to-cart=1">Add</a><a href="/product-category/unrelated">Other category</a></li>`).join('')}</ul>`;
  const html = (path: string, body: string, extra = '', classes = '') =>
    `<!doctype html><html><head><title>Fixture</title><link rel="canonical" href="${origin}${path}">${extra}</head><body class="${classes}"><main>${body}</main><aside><a href="/products/recommendation">Recommendation outside grid</a></aside><script>fetch("/executed-script")</script><img src="/media.jpg"></body></html>`;
  const server = createServer((req, res) => {
    const path = req.url!;
    requested.push(path);
    res.setHeader('Content-Type', 'text/html');
    if (path === '/products/missing') {
      res.writeHead(404).end(html(path, '<h1>Page not found</h1>'));
      return;
    }
    if (path === '/products/redirect' || path === '/products/redirect2') {
      res
        .writeHead(301, {
          Location: path.endsWith('redirect2') ? '/products/target' : '/products/redirect2',
        })
        .end();
      return;
    }
    if (path === '/external') {
      res.writeHead(302, { Location: 'https://external.invalid/content' }).end();
      return;
    }
    if (path === '/products/header') res.setHeader('X-Robots-Tag', 'googlebot: noindex');
    const responses: Record<string, string> = {
      '/collections/gifts': html(
        '/collections/gifts',
        products(['a']) +
          '<a rel="next" href="?page=2">Next</a><a href="?sort_by=price">Sort</a><a href="?sort_by=title">Sort consolidated</a><a href="?filter.v.availability=1">Filter</a><a href="/?orderby=price">Woo sort</a><a href="/?orderby=price&add-to-cart=1">Unsafe</a><a href="https://external.invalid/?sort_by=price">External</a>',
      ),
      '/collections/gifts?page=2': html(
        '/collections/gifts?page=2',
        products(['b']) + '<a rel="next" href="/collections/gifts">Previous cycle</a>',
      ),
      '/collections/gifts-old': html(
        '/collections/gifts-old',
        products(['b']) + '<nav class="pagination"><a href="?page=2">2</a></nav>',
      ),
      '/collections/gifts-old?page=2': html('/collections/gifts-old?page=2', products(['a'])),
      '/collections/different': html('/collections/different', products(['a', 'c'])),
      '/collections/infinite': html(
        '/collections/infinite',
        products(['a', 'b']) + '<button data-load-more>Load more</button>',
      ),
      '/collections/partial': html(
        '/collections/partial',
        products(['a', 'b']) + '<p>3 products</p>',
      ),
      '/collections/empty': html(
        '/collections/empty',
        products([]) + '<p>No products were found</p>',
      ),
      '/collections/noindex': html(
        '/collections/noindex',
        products(['a', 'b']),
        '<meta name="robots" content="noindex">',
      ),
      '/products/error': html('/products/error', '<h1>Page not found</h1>'),
      '/products/normal': html('/products/normal', '<h1>Gift for a page not found enthusiast</h1>'),
      '/products/header': html('/products/header', '<h1>Product</h1>'),
      '/products/alternate': html('/products/target', '<h1>Alternate</h1>'),
      '/collections/gifts?sort_by=price': html(
        '/collections/gifts?sort_by=price',
        products(['a', 'b']),
      ),
      '/collections/gifts?sort_by=title': html('/collections/gifts', products(['a', 'b'])),
      '/collections/gifts?filter.v.availability=1': html(
        '/collections/gifts?filter.v.availability=1',
        products(['a']),
        '<meta name="robots" content="none">',
      ),
      '/?orderby=price': html('/?orderby=price', '<h1>Sort</h1>'),
      '/departments/cups/': html(
        '/departments/cups/',
        products(['x'], true) +
          '<p>Showing 1–1 of 2 results</p><nav class="woocommerce-pagination"><a href="/departments/cups/page/2/">2</a></nav>',
        '',
        'archive tax-product_cat',
      ),
      '/departments/cups/page/2/': html(
        '/departments/cups/page/2',
        products(['y'], true) + '<p>Showing 2–2 of 2 results</p>',
        '',
        'archive tax-product_cat',
      ),
      '/departments/cups-copy': html(
        '/departments/cups-copy',
        products(['y', 'x'], true),
        '',
        'archive tax-product_cat',
      ),
    };
    res.end(responses[path] || html(path, '<h1>Product</h1>'));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No fixture port');
    origin = `http://127.0.0.1:${address.port}`;
    const paths = [
      '/collections/gifts',
      '/collections/gifts-old',
      '/collections/different',
      '/collections/infinite',
      '/collections/partial',
      '/collections/empty',
      '/collections/noindex',
      '/products/error',
      '/products/normal',
      '/products/missing',
      '/products/redirect',
      '/products/header',
      '/products/alternate',
      '/departments/cups/',
      '/departments/cups-copy',
      '/external',
    ];
    const crawl = await auditSeoPages(
      page,
      request,
      origin,
      paths.map(path => origin + path),
    );
    expect(crawl.errors).toHaveLength(1);
    expect(crawl.errors[0].message).toContain('storefront origin');
    const findings = (code: string) => crawl.findings.filter(finding => finding.code === code);
    expect(
      findings('duplicate-collection-products').map(finding =>
        finding.urls.map(url => new URL(url).pathname),
      ),
    ).toEqual([
      ['/collections/gifts', '/collections/gifts-old'],
      ['/departments/cups/', '/departments/cups-copy'],
    ]);
    expect(
      findings('collection-incomplete').map(finding => new URL(finding.urls[0]).pathname),
    ).toEqual(['/collections/infinite', '/collections/partial']);
    expect(findings('empty-collection')).toHaveLength(1);
    expect(findings('page-http-status')).toHaveLength(1);
    expect(findings('sitemap-noindex')).toHaveLength(2);
    expect(findings('sitemap-canonical')).toHaveLength(1);
    expect(findings('sitemap-redirect')).toHaveLength(1);
    expect(findings('redirect-chain')).toHaveLength(1);
    expect(findings('soft-404').map(finding => new URL(finding.urls[0]).pathname)).toEqual([
      '/products/error',
    ]);
    expect(findings('indexable-filter').map(finding => finding.urls[0])).toEqual([
      origin + '/collections/gifts?sort_by=price',
      origin + '/?orderby=price',
    ]);
    expect(
      crawl.collections.find(collection => collection.url === origin + '/collections/gifts')
        ?.products,
    ).toEqual([origin + '/products/a', origin + '/products/b']);
    expect(
      crawl.collections.find(collection => collection.url === origin + '/departments/cups/')
        ?.products,
    ).toEqual([origin + '/goods/x', origin + '/goods/y']);
    expect(requested.some(path => path.includes('add-to-cart'))).toBe(false);
    expect(requested).not.toContain('/products/recommendation');
    expect(requested).not.toContain('/executed-script');
    expect(requested).not.toContain('/media.jpg');
    expect(requested).not.toContain('/product-category/unrelated');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  }
});

test('crawl limits and unreadable pagination are explicit; common canonicals avoid duplicate warnings', async ({
  page,
  request,
}) => {
  const { createServer } = await import('node:http');
  const { auditSeoPages } = await import('../tests/seo-crawl');
  let origin = '';
  let mode = 'canonical';
  let reads = 0;
  const server = createServer((req, res) => {
    reads++;
    res.setHeader('Content-Type', 'text/html');
    const path = req.url!;
    if (mode === 'bad-page' && path.includes('page=2')) {
      res.writeHead(503).end('Unavailable');
      return;
    }
    if (mode === 'non-html') {
      res.setHeader('Content-Type', 'application/json');
      res.end('{}');
      return;
    }
    const pageNumber = Number(new URL(path, origin).searchParams.get('page') || 1);
    const next =
      mode === 'pagination' || mode === 'bad-page'
        ? `<a rel="next" href="?page=${pageNumber + 1}">Next</a>`
        : '';
    if (mode === 'empty' || mode === 'unreadable-card') {
      res.end(
        `<html><head><title>Category</title></head><body><main><ul id="product-grid">${mode === 'empty' ? '' : '<li class="product"><a href="/custom-product">Product</a></li>'}</ul></main></body></html>`,
      );
      return;
    }
    res.end(
      `<html><head><title>Category</title><link rel="canonical" href="${origin}/collections/a"></head><body><main>${mode === 'unknown-grid' ? '<div>Custom unsupported grid</div>' : `<ul id="product-grid"><li><a href="/products/${pageNumber}">Product</a></li></ul>`}${next}</main></body></html>`,
    );
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No fixture port');
    origin = `http://127.0.0.1:${address.port}`;
    const urls = ['/collections/a', '/collections/b'].map(path => origin + path);
    const same = await auditSeoPages(page, request, origin, urls);
    expect(same.collections).toHaveLength(2);
    expect(
      same.findings.filter(finding => finding.code === 'duplicate-collection-products'),
    ).toEqual([]);
    mode = 'bad-page';
    const bad = await auditSeoPages(page, request, origin, [urls[0]]);
    expect(bad.collections[0].complete).toBe(false);
    expect(bad.findings.map(finding => finding.code)).toContain('page-http-status');
    mode = 'unknown-grid';
    const unknown = await auditSeoPages(page, request, origin, [urls[0]]);
    expect(unknown.collections[0].complete).toBe(false);
    expect(unknown.findings.map(finding => finding.code)).not.toContain('empty-collection');
    mode = 'empty';
    const empty = await auditSeoPages(page, request, origin, [urls[0]]);
    expect(empty.findings.map(finding => finding.code)).toContain('empty-collection');
    mode = 'unreadable-card';
    const unreadable = await auditSeoPages(page, request, origin, [urls[0]]);
    expect(unreadable.collections[0].complete).toBe(false);
    expect(unreadable.findings.map(finding => finding.code)).not.toContain('empty-collection');
    mode = 'pagination';
    reads = 0;
    const paginated = await auditSeoPages(page, request, origin, [urls[0]]);
    expect(paginated.collections[0].complete).toBe(false);
    expect(paginated.collections[0].pages).toHaveLength(50);
    expect(reads).toBe(50);
    mode = 'limit';
    reads = 0;
    const limited = await auditSeoPages(
      page,
      request,
      origin,
      Array.from({ length: 201 }, (_, index) => origin + '/page-' + index),
    );
    expect(limited.errors).toHaveLength(1);
    expect(limited.errors[0].message).toContain('Page limit');
    expect(limited.unreadUrls).toEqual([origin + '/page-200']);
    expect(reads).toBe(200);
    mode = 'non-html';
    const nonHtml = await auditSeoPages(page, request, origin, [origin + '/json']);
    expect(nonHtml.errors[0].message).toContain('not HTML');
    expect(nonHtml.unreadUrls).toEqual([origin + '/json']);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  }
});
