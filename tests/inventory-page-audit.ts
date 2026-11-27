import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures';
import type { InventoryPage } from './inventory';
import { configuredPages } from './inventory';
import { clearCart, waitForContent, loadPageImages, waitForVisualReady } from './helpers';
import { analyzeSeo, readSeoDocument } from './seo-audit';
import { auditSpelling } from './spelling';
import { inspectModernWeb, attachModernWeb, safeAuditUrl } from './modern-web';
import { prepareInteractionProbe } from './modern-web-interactions';
import { auditModernWebProbes } from './modern-web-page-audit';
import { inventoryScreenshot } from './inventory-visual';
import { pageCheck } from './page-check';
import { observeScriptInventory } from './script-inventory';
import { readSiteSettings } from '../config/site-settings';

/** One fresh context per URL; passive evidence and screenshots precede frozen probes. */
export async function auditInventoryPage(page: Page, entry: InventoryPage, info: TestInfo) {
  const configured = configuredPages().some(candidate => candidate.url === entry.url);
  const sizes: Array<Promise<number | null>> = [];
  let requests = 0,
    failed = 0;
  page.on('request', () => requests++);
  page.on('requestfailed', () => failed++);
  page.on('requestfinished', request => {
    sizes.push(
      request
        .sizes()
        .then(size => size.responseHeadersSize + size.responseBodySize)
        .catch(() => null),
    );
  });
  // The fixture has already installed Web Vitals. Install quarantine before any document scripts.
  const isolation = configured ? await prepareInteractionProbe(page, true) : undefined;
  const attachScripts =
    entry.type === 'home' && readSiteSettings().monitorScripts
      ? observeScriptInventory(page)
      : undefined;
  try {
    if (entry.type === 'cart') await clearCart(page);
    const response = await page.goto(entry.url, { waitUntil: 'domcontentloaded' });
    expect(response?.status(), 'Inventory page must load').toBeLessThan(400);
    await waitForContent(page);
    const headers = await response?.allHeaders();
    if (attachScripts)
      await pageCheck('Third-party script inventory', async () => attachScripts(info));
    else if (entry.type === 'home')
      await test.step.skip('Third-party script inventory — monitoring disabled', async () => {});
    const seo = await pageCheck('SEO metadata and JSON-LD', async () =>
      analyzeSeo(
        entry,
        await readSeoDocument(page, response?.status() || 0, headers?.['x-robots-tag']),
      ),
    );
    if (configured) {
      await pageCheck('Passive Modern Web', async () => {
        const report = await inspectModernWeb(page, headers);
        await attachModernWeb(report, info);
        expect(
          report.findings.filter(finding => finding.severity === 'error'),
          'Broken form description references; see modern-web.txt',
        ).toEqual([]);
      });
    }
    const visualReady = await pageCheck('Load visual media', async () => {
      await loadPageImages(page);
      await page.evaluate(() => scrollTo(0, 0));
      await waitForVisualReady(page);
      return true;
    });
    await pageCheck('Content spelling', async () => auditSpelling(page, info, entry.language));
    if (visualReady)
      await pageCheck('Inventory visual snapshot', async () =>
        inventoryScreenshot(page, entry, info, !configured),
      );
    else await test.step.skip('Inventory visual snapshot — media readiness failed', async () => {});
    // Probes are terminal: this context is closed even after incomplete restoration.
    if (isolation)
      await pageCheck('Guarded Modern Web probes', async () =>
        auditModernWebProbes(page, info, isolation),
      );
    return seo;
  } finally {
    const completed = await Promise.all(sizes);
    await info.attach('page-visit.json', {
      body: JSON.stringify({
        schemaVersion: 1,
        url: safeAuditUrl(entry.url),
        requests,
        failed,
        completedResponses: completed.length,
        responseBytesLowerBound: completed.reduce<number>((sum, value) => sum + (value ?? 0), 0),
        incompleteSizeMeasurements: completed.filter(value => value === null).length,
        blockedProbeRequests: isolation?.counts().blockedRequests || 0,
        applicationResetVerified: false,
      }),
      contentType: 'application/json',
    });
  }
}
