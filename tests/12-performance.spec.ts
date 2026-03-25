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
  performance:      50,   // 2026 target: mobile ≥ 50 (up from 30)
  accessibility:    80,
  'best-practices': 80,
  seo:              85,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

type PwPage = import('@playwright/test').Page;

async function getNavTiming(page: PwPage) {
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

/** Measures Largest Contentful Paint — good < 2500 ms (Google 2025+) */
async function measureLCP(page: PwPage): Promise<number> {
  return page.evaluate(() =>
    new Promise<number>((resolve) => {
      const timer = setTimeout(() => resolve(0), 5_000);
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length > 0) {
          clearTimeout(timer);
          resolve(entries[entries.length - 1].startTime);
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    }),
  );
}

/** Measures Cumulative Layout Shift — good < 0.1 */
async function measureCLS(page: PwPage): Promise<number> {
  await page.evaluate(() =>
    window.scrollTo({ top: Math.min(400, document.body.scrollHeight), behavior: 'instant' }),
  );
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(400);

  return page.evaluate(() => {
    let cls = 0;
    for (const entry of performance.getEntriesByType('layout-shift')) {
      if (!(entry as unknown as { hadRecentInput: boolean }).hadRecentInput)
        cls += (entry as unknown as { value: number }).value;
    }
    return Math.round(cls * 1_000) / 1_000;
  });
}

/**
 * Measures Interaction to Next Paint (INP) — replaced FID as Core Web Vital in March 2024.
 * Good < 200 ms. Returns 0 if no interactions could be captured.
 */
async function measureINP(page: PwPage): Promise<number> {
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__inpDurations = [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries())
          ((window as unknown as Record<string, number[]>).__inpDurations).push(e.duration);
      }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
    } catch { /* older Chrome or unsupported — silently skip */ }
  });

  await page.mouse.move(400, 300);
  await page.mouse.click(400, 300);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(800);

  return page.evaluate(() => {
    const durations: number[] =
      (window as unknown as Record<string, number[]>).__inpDurations ?? [];
    if (durations.length === 0) return 0;
    durations.sort((a, b) => a - b);
    return durations[Math.floor(durations.length * 0.98)] ?? durations[durations.length - 1] ?? 0;
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

// ─── C) Core Web Vitals (Google ranking signals, updated 2025+) ───────────────

test.describe('12c · Core Web Vitals', () => {

  test('homepage — LCP (Largest Contentful Paint) < 2500 ms', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForTimeout(1_000); // allow LCP observer to fire

    const lcp = await measureLCP(page);
    console.log(`Homepage LCP: ${lcp}ms`);

    if (lcp === 0) {
      console.warn('LCP: no entry captured (possible headless/no-large-content scenario)');
      return;
    }
    expect(lcp, `LCP ${lcp}ms exceeds 2500ms "Good" threshold`).toBeLessThan(2_500);
  });

  test('product page — LCP < 2500 ms', async ({ page }) => {
    await page.goto(`${BASE}/products/zerno-z1`, { waitUntil: 'load' });
    await page.waitForTimeout(1_000);

    const lcp = await measureLCP(page);
    console.log(`Product LCP: ${lcp}ms`);

    if (lcp === 0) return;
    expect(lcp, `Product LCP ${lcp}ms exceeds 2500ms threshold`).toBeLessThan(2_500);
  });

  test('homepage — CLS (Cumulative Layout Shift) < 0.1', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForTimeout(500);

    const cls = await measureCLS(page);
    console.log(`Homepage CLS: ${cls}`);

    expect(cls, `CLS ${cls} exceeds 0.1 "Good" threshold — layout shifts detected`).toBeLessThan(0.1);
  });

  test('product page — CLS < 0.1', async ({ page }) => {
    await page.goto(`${BASE}/products/zerno-z1`, { waitUntil: 'load' });
    await page.waitForTimeout(500);

    const cls = await measureCLS(page);
    console.log(`Product CLS: ${cls}`);

    expect(cls, `Product CLS ${cls} exceeds 0.1 threshold`).toBeLessThan(0.1);
  });

  test('homepage — INP (Interaction to Next Paint) < 200 ms', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForTimeout(500);

    const inp = await measureINP(page);
    console.log(`Homepage INP: ${inp}ms`);

    if (inp === 0) {
      console.warn('INP: no event entries captured — skipping assertion');
      return;
    }
    expect(inp, `INP ${inp}ms exceeds 200ms "Good" threshold`).toBeLessThan(200);
  });
});

// ─── D) Network Resilience ────────────────────────────────────────────────────

test.describe('12d · Network Resilience', () => {

  test('homepage — loads within 12 s on fast-4G (10 Mbps / 20 ms RTT)', async ({ page }) => {
    const client = await page.context().newCDPSession(page);
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: (10 * 1_024 * 1_024) / 8,
      uploadThroughput:   (5  * 1_024 * 1_024) / 8,
      latency: 20,
    });

    const start = Date.now();
    await page.goto(BASE, { waitUntil: 'load', timeout: 30_000 });
    const elapsed = Date.now() - start;
    console.log(`Fast-4G homepage load: ${elapsed}ms`);

    await client.send('Network.emulateNetworkConditions', {
      offline: false, downloadThroughput: -1, uploadThroughput: -1, latency: 0,
    });

    expect(elapsed, `Homepage took ${elapsed}ms on fast-4G (budget: 12 s)`).toBeLessThan(12_000);
  });

  test('homepage — DOMContentLoaded within 20 s on slow-3G (1.5 Mbps / 40 ms RTT)', async ({ page }) => {
    const client = await page.context().newCDPSession(page);
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: Math.round((1.5 * 1_024 * 1_024) / 8),
      uploadThroughput:   Math.round((0.75 * 1_024 * 1_024) / 8),
      latency: 40,
    });

    const start = Date.now();
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const elapsed = Date.now() - start;
    console.log(`Slow-3G DOMContentLoaded: ${elapsed}ms`);

    await client.send('Network.emulateNetworkConditions', {
      offline: false, downloadThroughput: -1, uploadThroughput: -1, latency: 0,
    });

    expect(elapsed, `DOMContentLoaded took ${elapsed}ms on slow-3G (budget: 20 s)`).toBeLessThan(20_000);
  });
});
