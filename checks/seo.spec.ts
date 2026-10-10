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
