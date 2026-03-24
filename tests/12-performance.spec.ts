/**
 * Performance tests using two complementary approaches:
 *
 *  A) Browser Performance API  — built-in, no extra setup.
 *     Measures TTFB, DOM ready, full load for every key page.
 *
 *  B) Lighthouse audit         — full scores (Performance, SEO,
 *     Best Practices, Accessibility) via playwright-lighthouse.
 *     Requires launching a separate Chrome instance with a debug port.
 */
import { test, expect, chromium } from '@playwright/test';
import { playAudit } from 'playwright-lighthouse';
import { BASE } from './helpers';

// ─── Thresholds ──────────────────────────────────────────────────────────────

const PERF = {
  ttfb:              2_000,   // ms — Time to First Byte
  domInteractive:    5_000,   // ms — browser parses HTML
  domContentLoaded:  6_000,   // ms — deferred scripts done
  loadComplete:     12_000,   // ms — images / iframes done
};

const LIGHTHOUSE_PORT = 9_224;   // separate from any dev server

const LIGHTHOUSE_THRESHOLDS = {
  performance:      30,   // Shopify stores often score 30-50 on mobile
  accessibility:    70,
  'best-practices': 70,
  seo:              70,
};

// ─── Helper ──────────────────────────────────────────────────────────────────

async function getNavTiming(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return {
      ttfb:             Math.round(nav.responseStart  - nav.requestStart),
      domInteractive:   Math.round(nav.domInteractive),
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
      loadComplete:     Math.round(nav.loadEventEnd),
    };
  });
}

// ─── A) Performance API tests (fast, no extra setup) ─────────────────────────

test.describe('12a · Performance API', () => {

  test('homepage — TTFB < 2 s', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'load' });
    const t = await getNavTiming(page);
    console.log(`Homepage timing: TTFB ${t.ttfb}ms | DOMInteractive ${t.domInteractive}ms | DOMContentLoaded ${t.domContentLoaded}ms | Load ${t.loadComplete}ms`);
    expect(t.ttfb, `TTFB ${t.ttfb}ms exceeds ${PERF.ttfb}ms`).toBeLessThan(PERF.ttfb);
  });

  test('homepage — DOMContentLoaded < 6 s', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'load' });
    const t = await getNavTiming(page);
    expect(t.domContentLoaded, `DOMContentLoaded ${t.domContentLoaded}ms exceeds ${PERF.domContentLoaded}ms`).toBeLessThan(PERF.domContentLoaded);
  });

  test('homepage — full load < 12 s', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'load' });
    const t = await getNavTiming(page);
    expect(t.loadComplete, `Load ${t.loadComplete}ms exceeds ${PERF.loadComplete}ms`).toBeLessThan(PERF.loadComplete);
  });

  test('product page — TTFB < 2 s', async ({ page }) => {
    await page.goto(`${BASE}/products/zerno-z1`, { waitUntil: 'load' });
    const t = await getNavTiming(page);
    console.log(`Product timing: TTFB ${t.ttfb}ms | Load ${t.loadComplete}ms`);
    expect(t.ttfb).toBeLessThan(PERF.ttfb);
  });

  test('search results page — TTFB < 2 s', async ({ page }) => {
    await page.goto(`${BASE}/search?q=zerno&type=product`, { waitUntil: 'load' });
    const t = await getNavTiming(page);
    console.log(`Search timing: TTFB ${t.ttfb}ms | Load ${t.loadComplete}ms`);
    expect(t.ttfb).toBeLessThan(PERF.ttfb);
  });

  test('collections page — TTFB < 2 s', async ({ page }) => {
    await page.goto(`${BASE}/collections`, { waitUntil: 'load' });
    const t = await getNavTiming(page);
    console.log(`Collections timing: TTFB ${t.ttfb}ms | Load ${t.loadComplete}ms`);
    expect(t.ttfb).toBeLessThan(PERF.ttfb);
  });

  test('cart page — TTFB < 2 s', async ({ page }) => {
    await page.goto(`${BASE}/cart`, { waitUntil: 'load' });
    const t = await getNavTiming(page);
    console.log(`Cart timing: TTFB ${t.ttfb}ms | Load ${t.loadComplete}ms`);
    expect(t.ttfb).toBeLessThan(PERF.ttfb);
  });

  test('homepage — no render-blocking resources > 2 s', async ({ page }) => {
    const longResources: string[] = [];

    const startTime = Date.now();
    page.on('response', response => {
      const elapsed = Date.now() - startTime;
      if (elapsed > 2_000) {
        const url = response.url();
        if (/\.(js|css)(\?|$)/.test(url)) {
          longResources.push(`${url} (arrived at ~${elapsed}ms)`);
        }
      }
    });

    await page.goto(BASE, { waitUntil: 'load' });

    if (longResources.length > 0) {
      console.log('Slow JS/CSS resources:', longResources.join('\n  '));
    }

    expect(
      longResources.length,
      `${longResources.length} JS/CSS resource(s) took > 2 s to load`,
    ).toBe(0);
  });

  test('homepage — page weight: transfer size < 10 MB', async ({ page }) => {
    let totalBytes = 0;

    page.on('response', async response => {
      const headers = response.headers();
      const contentLength = parseInt(headers['content-length'] ?? '0', 10);
      if (contentLength > 0) totalBytes += contentLength;
    });

    await page.goto(BASE, { waitUntil: 'load' });

    const mb = (totalBytes / 1_048_576).toFixed(2);
    console.log(`Approximate page weight: ${mb} MB`);

    expect(totalBytes, `Page weight ${mb} MB exceeds 10 MB`).toBeLessThan(10 * 1_048_576);
  });
});

// ─── B) Lighthouse audit ──────────────────────────────────────────────────────

test.describe('12b · Lighthouse', () => {

  test('homepage — Lighthouse scores meet thresholds', async () => {
    // Lighthouse requires its own Chrome instance with a debug port.
    // We launch one here, run the audit, then close it.
    const browser = await chromium.launch({
      args: [`--remote-debugging-port=${LIGHTHOUSE_PORT}`, '--no-sandbox'],
    });
    const context = await browser.newContext({
      locale: 'bg-BG',
      timezoneId: 'Europe/Sofia',
    });
    const page = await context.newPage();

    try {
      await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60_000 });

      await playAudit({
        page,
        port: LIGHTHOUSE_PORT,
        thresholds: LIGHTHOUSE_THRESHOLDS,
        reports: {
          formats: { html: true, json: true },
          name: 'lighthouse-homepage',
          directory: './reports/lighthouse',
        },
      });
    } finally {
      await browser.close();
    }
  });

  test('product page — Lighthouse scores meet thresholds', async () => {
    const browser = await chromium.launch({
      args: [`--remote-debugging-port=${LIGHTHOUSE_PORT + 1}`, '--no-sandbox'],
    });
    const context = await browser.newContext({
      locale: 'bg-BG',
      timezoneId: 'Europe/Sofia',
    });
    const page = await context.newPage();

    try {
      await page.goto(`${BASE}/products/zerno-z1`, {
        waitUntil: 'networkidle',
        timeout: 60_000,
      });

      await playAudit({
        page,
        port: LIGHTHOUSE_PORT + 1,
        thresholds: LIGHTHOUSE_THRESHOLDS,
        reports: {
          formats: { html: true, json: true },
          name: 'lighthouse-product',
          directory: './reports/lighthouse',
        },
      });
    } finally {
      await browser.close();
    }
  });

  test('collections page — Lighthouse scores meet thresholds', async () => {
    const browser = await chromium.launch({
      args: [`--remote-debugging-port=${LIGHTHOUSE_PORT + 2}`, '--no-sandbox'],
    });
    const context = await browser.newContext({
      locale: 'bg-BG',
      timezoneId: 'Europe/Sofia',
    });
    const page = await context.newPage();

    try {
      await page.goto(`${BASE}/collections`, {
        waitUntil: 'networkidle',
        timeout: 60_000,
      });

      await playAudit({
        page,
        port: LIGHTHOUSE_PORT + 2,
        thresholds: LIGHTHOUSE_THRESHOLDS,
        reports: {
          formats: { html: true, json: true },
          name: 'lighthouse-collections',
          directory: './reports/lighthouse',
        },
      });
    } finally {
      await browser.close();
    }
  });

  test('search results page — Lighthouse scores meet thresholds', async () => {
    const browser = await chromium.launch({
      args: [`--remote-debugging-port=${LIGHTHOUSE_PORT + 3}`, '--no-sandbox'],
    });
    const context = await browser.newContext({
      locale: 'bg-BG',
      timezoneId: 'Europe/Sofia',
    });
    const page = await context.newPage();

    try {
      await page.goto(`${BASE}/search?q=zerno&type=product`, {
        waitUntil: 'networkidle',
        timeout: 60_000,
      });

      await playAudit({
        page,
        port: LIGHTHOUSE_PORT + 3,
        thresholds: LIGHTHOUSE_THRESHOLDS,
        reports: {
          formats: { html: true, json: true },
          name: 'lighthouse-search',
          directory: './reports/lighthouse',
        },
      });
    } finally {
      await browser.close();
    }
  });
});
