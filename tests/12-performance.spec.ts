/**
 * Opt-in audits that require a separate navigation/browser or network profile.
 * Passive metrics are collected by fixtures during existing page visits.
 */
import { test, expect } from './fixtures';
import { readSiteSettings } from '../config/site-settings';
import { BASE, SEARCH_TERM, KNOWN_PRODUCT } from './helpers';
import { runLighthouseAudit } from './lighthouse';
const LIGHTHOUSE_THRESHOLDS = readSiteSettings().thresholds.lighthouse;

// ─── B) Lighthouse audit ──────────────────────────────────────────────────────

test.describe('12b · Lighthouse', { tag: ['@audit'] }, () => {
  test.describe.configure({ retries: 0 });
  test.skip(({ browserName }) => browserName !== 'chromium', 'Lighthouse runs only in Chromium');

  test.beforeEach(async ({}, testInfo) => {
    const owner = testInfo.config.projects.find(
      project => (project.use.browserName ?? 'chromium') === 'chromium',
    );
    test.skip(
      testInfo.project.name !== owner?.name,
      'Only the first Chromium project runs Lighthouse',
    );
  });

  const audits = [
    { title: 'homepage', name: 'lighthouse-homepage', url: BASE },
    { title: 'product page', name: 'lighthouse-product', url: KNOWN_PRODUCT },
    { title: 'collections page', name: 'lighthouse-collections', url: `${BASE}/collections` },
    {
      title: 'search results page',
      name: 'lighthouse-search',
      url: `${BASE}/search?q=${encodeURIComponent(SEARCH_TERM)}&type=product`,
    },
  ];

  for (const audit of audits) {
    test(`${audit.title} — Lighthouse scores meet thresholds`, async ({}, testInfo) => {
      await runLighthouseAudit(audit.url, audit.name, testInfo, LIGHTHOUSE_THRESHOLDS);
    });
  }
});

// ─── D) Network Resilience ────────────────────────────────────────────────────

test.describe('12d · Network Resilience', { tag: ['@audit'] }, () => {
  test('homepage — loads within 12 s on fast-4G (10 Mbps / 20 ms RTT)', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'CDP network throttling is Chromium-only');
    const client = await page.context().newCDPSession(page);
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: (10 * 1_024 * 1_024) / 8,
      uploadThroughput: (5 * 1_024 * 1_024) / 8,
      latency: 20,
    });

    const start = Date.now();
    await page.goto(BASE, { waitUntil: 'load', timeout: 30_000 });
    const elapsed = Date.now() - start;
    console.log(`Fast-4G homepage load: ${elapsed}ms`);

    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: -1,
      uploadThroughput: -1,
      latency: 0,
    });

    expect(elapsed, `Homepage took ${elapsed}ms on fast-4G (budget: 12 s)`).toBeLessThan(12_000);
  });

  test('homepage — DOMContentLoaded within 20 s on slow-3G (1.5 Mbps / 40 ms RTT)', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'CDP network throttling is Chromium-only');
    const client = await page.context().newCDPSession(page);
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: Math.round((1.5 * 1_024 * 1_024) / 8),
      uploadThroughput: Math.round((0.75 * 1_024 * 1_024) / 8),
      latency: 40,
    });

    const start = Date.now();
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const elapsed = Date.now() - start;
    console.log(`Slow-3G DOMContentLoaded: ${elapsed}ms`);

    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: -1,
      uploadThroughput: -1,
      latency: 0,
    });

    expect(elapsed, `DOMContentLoaded took ${elapsed}ms on slow-3G (budget: 20 s)`).toBeLessThan(
      20_000,
    );
  });
});
