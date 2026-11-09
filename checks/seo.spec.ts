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
  const findings = sitemapFindings(paths.map(path => origin + path));
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
