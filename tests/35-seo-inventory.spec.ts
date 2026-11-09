import { test, expect } from './fixtures';
import { pageInventory } from './inventory';
import { analyzeSeo, inventorySeoFindings, readSeoDocument, type SeoResult } from './seo-audit';
import { BASE, waitForContent } from './helpers';
import { assertNotLimited } from './pacing';
import { auditSitemaps } from './sitemap-audit';
import { auditSeoPages } from './seo-crawl';

test(
  'SEO — metadata and JSON-LD across page inventory',
  { tag: ['@full', '@pages', '@seo'] },
  async ({ page }, testInfo) => {
    const entries = pageInventory();
    test.setTimeout(Math.max(120000, entries.length * 60000));
    const pages: SeoResult[] = [];
    const navigationErrors: { url: string; message: string }[] = [];
    try {
      for (const entry of entries) {
        await test.step(entry.url, async () => {
          try {
            const response = await page.goto(entry.url, { waitUntil: 'domcontentloaded' });
            await waitForContent(page);
            pages.push(
              analyzeSeo(
                entry,
                await readSeoDocument(
                  page,
                  response?.status() || 0,
                  response?.headers()['x-robots-tag'],
                ),
              ),
            );
          } catch (error) {
            navigationErrors.push({
              url: entry.url,
              message: error instanceof Error ? error.message : String(error),
            });
          }
          assertNotLimited();
        });
      }
    } finally {
      const inventoryFindings = inventorySeoFindings(pages);
      await testInfo.attach('seo-inventory.json', {
        body: JSON.stringify(
          { schemaVersion: 1, pages, inventoryFindings, navigationErrors },
          null,
          2,
        ),
        contentType: 'application/json',
      });
    }
    expect(
      inventorySeoFindings(pages).filter(finding => finding.severity === 'error'),
      'Canonical target errors within audited inventory',
    ).toEqual([]);
    expect(navigationErrors, 'Inventory pages could not be audited').toEqual([]);
    expect(
      pages.flatMap(result =>
        result.findings
          .filter(finding => finding.severity === 'error')
          .map(finding => ({ url: result.document.url, ...finding })),
      ),
      'SEO errors; review warnings and metadata in seo-inventory.json',
    ).toEqual([]);
  },
);

test(
  'SEO — sitemap URLs, category duplication and indexable filters',
  { tag: ['@full', '@pages', '@seo'] },
  async ({ page, request }, testInfo) => {
    test.setTimeout(1800000);
    const audit = await auditSitemaps(page, request, BASE);
    await testInfo.attach('seo-sitemaps.json', {
      body: JSON.stringify(audit, null, 2),
      contentType: 'application/json',
    });
    const crawl = await auditSeoPages(page, request, BASE, audit.urls, pageInventory());
    await testInfo.attach('seo-crawl.json', {
      body: JSON.stringify(crawl, null, 2),
      contentType: 'application/json',
    });
    for (const finding of [...audit.findings, ...crawl.findings])
      testInfo.annotations.push({
        type: finding.severity,
        description: `${finding.code}: ${finding.urls.join(' ↔ ')}. ${finding.detail}`,
      });
    assertNotLimited();
    expect.soft(audit.errors, 'Sitemap scan incomplete; see seo-sitemaps.json').toEqual([]);
    expect.soft(crawl.errors, 'Page scan incomplete; see seo-crawl.json').toEqual([]);
    expect(
      crawl.findings.filter(finding => finding.severity === 'error'),
      'SEO crawl errors; see seo-crawl.json',
    ).toEqual([]);
  },
);
