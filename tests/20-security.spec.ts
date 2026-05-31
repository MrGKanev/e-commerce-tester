/**
 * 20 · Security headers & HTTPS
 *
 * Uses the Playwright request API (no browser rendering) so checks run fast.
 * All tests send a HEAD/GET to the store and inspect response headers.
 *
 * References:
 *  - OWASP Secure Headers Project
 *  - Google Security Score (2026 criteria)
 */
import { test, expect } from '@playwright/test';
import { BASE } from './helpers';

// ─── Shared: fetch headers once per describe block ───────────────────────────

async function fetchHeaders(request: import('@playwright/test').APIRequestContext, path = '/') {
  const resp = await request.get(`${BASE}${path}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; security-check/1.0)' },
    maxRedirects: 10,
  });
  return { status: resp.status(), headers: resp.headers() };
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('20 · Security headers', () => {

  // ── HTTPS enforcement ─────────────────────────────────────────────────────

  test('HTTP request redirects to HTTPS (no plain-HTTP serving)', async ({ request }) => {
    const httpBase = BASE.replace(/^https:\/\//, 'http://');
    if (!BASE.startsWith('https://')) {
      test.skip(true, 'BASE is not HTTPS — skipping HTTP→HTTPS redirect check');
      return;
    }
    const resp = await request.get(httpBase, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      maxRedirects: 0,
    }).catch(() => null);

    if (!resp) {
      test.skip(true, 'HTTP endpoint not reachable (may already block port 80)');
      return;
    }
    // Should redirect (3xx) or refuse (connection refused handled above)
    expect(resp.status(), 'HTTP endpoint returned 200 — not redirecting to HTTPS').not.toBe(200);
  });

  test('final URL after redirects is HTTPS', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    expect(page.url(), 'Final URL is not HTTPS').toMatch(/^https:\/\//);
  });

  // ── HSTS ─────────────────────────────────────────────────────────────────

  test('Strict-Transport-Security header is present', async ({ request }) => {
    const { headers } = await fetchHeaders(request);
    const hsts = headers['strict-transport-security'];
    expect(hsts, 'Strict-Transport-Security header missing').toBeTruthy();
  });

  test('HSTS max-age is at least 6 months (15768000 s)', async ({ request }) => {
    const { headers } = await fetchHeaders(request);
    const hsts = headers['strict-transport-security'] ?? '';
    if (!hsts) test.skip(true, 'HSTS header not present');

    const match = hsts.match(/max-age=(\d+)/i);
    if (!match) {
      throw new Error('HSTS header present but has no max-age directive');
    }
    expect(
      parseInt(match[1], 10),
      `HSTS max-age ${match[1]}s is less than 6 months (15768000 s)`,
    ).toBeGreaterThanOrEqual(15_768_000);
  });

  // ── Content-type sniffing ─────────────────────────────────────────────────

  test('X-Content-Type-Options: nosniff is set', async ({ request }) => {
    const { headers } = await fetchHeaders(request);
    const val = headers['x-content-type-options'];
    expect(val?.toLowerCase(), 'X-Content-Type-Options is not "nosniff"').toBe('nosniff');
  });

  // ── Framing ───────────────────────────────────────────────────────────────

  test('X-Frame-Options or CSP frame-ancestors prevents clickjacking', async ({ request }) => {
    const { headers } = await fetchHeaders(request);
    const xfo = headers['x-frame-options'];
    const csp = headers['content-security-policy'] ?? '';
    const hasFrameAncestors = csp.toLowerCase().includes('frame-ancestors');

    expect(
      xfo || hasFrameAncestors,
      'Neither X-Frame-Options nor CSP frame-ancestors is set — clickjacking risk',
    ).toBeTruthy();
  });

  // ── Mixed content ─────────────────────────────────────────────────────────

  test('homepage has no mixed-content HTTP resources', async ({ page }) => {
    if (!BASE.startsWith('https://')) {
      test.skip(true, 'Store is not on HTTPS — skipping mixed-content check');
      return;
    }

    const httpRequests: string[] = [];
    page.on('request', req => {
      if (req.url().startsWith('http://')) httpRequests.push(req.url());
    });

    await page.goto(BASE, { waitUntil: 'networkidle' });

    expect(
      httpRequests,
      `Mixed HTTP requests on HTTPS page:\n${httpRequests.join('\n')}`,
    ).toHaveLength(0);
  });

  // ── Cookie flags ──────────────────────────────────────────────────────────

  test('session cookies have Secure flag on HTTPS', async ({ page }) => {
    if (!BASE.startsWith('https://')) {
      test.skip(true, 'Not on HTTPS');
      return;
    }

    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    const cookies = await page.context().cookies();
    const sessionCookies = cookies.filter(c =>
      /session|cart|_secure|shopify/i.test(c.name),
    );

    if (sessionCookies.length === 0) {
      test.skip(true, 'No session/cart cookies found to inspect');
      return;
    }

    const insecure = sessionCookies.filter(c => !c.secure).map(c => c.name);
    expect(
      insecure,
      `Session cookies without Secure flag: ${insecure.join(', ')}`,
    ).toHaveLength(0);
  });

  test('cookies have SameSite attribute set', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    const cookies = await page.context().cookies();
    const shopifyCookies = cookies.filter(c => /shopify|cart|session/i.test(c.name));

    if (shopifyCookies.length === 0) {
      test.skip(true, 'No Shopify cookies found');
      return;
    }

    const noSameSite = shopifyCookies
      .filter(c => !c.sameSite || c.sameSite === 'None')
      .map(c => c.name);

    if (noSameSite.length > 0) {
      console.warn(`Cookies with SameSite=None or unset: ${noSameSite.join(', ')}`);
    }
    // Soft check — SameSite=None is acceptable if paired with Secure
    const problematic = shopifyCookies.filter(
      c => (!c.sameSite || c.sameSite === 'None') && !c.secure,
    ).map(c => c.name);
    expect(
      problematic,
      `Cookies with SameSite=None without Secure flag: ${problematic.join(', ')}`,
    ).toHaveLength(0);
  });

  // ── Server information disclosure ─────────────────────────────────────────

  test('Server header does not expose version details', async ({ request }) => {
    const { headers } = await fetchHeaders(request);
    const server = headers['server'] ?? '';
    // Shopify typically returns "Shopify" without a version
    expect(server).not.toMatch(/\d+\.\d+/);
  });

  test('X-Powered-By header is not present', async ({ request }) => {
    const { headers } = await fetchHeaders(request);
    const powered = headers['x-powered-by'];
    expect(powered, `X-Powered-By header exposes: ${powered}`).toBeFalsy();
  });

  // ── Robots.txt & sensitive paths ──────────────────────────────────────────

  test('robots.txt is accessible and non-empty', async ({ request }) => {
    const resp = await request.get(`${BASE}/robots.txt`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    expect(resp.status()).toBeLessThan(400);
    const body = await resp.text();
    expect(body.trim()).not.toBe('');
    expect(body).toMatch(/user-agent/i);
  });

  test('/admin is not publicly accessible (redirects or 401/403/404)', async ({ request }) => {
    const resp = await request.get(`${BASE}/admin`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      maxRedirects: 5,
    });
    // Shopify admin redirects to myshopify.com — any non-200 is correct
    expect(resp.status(), '/admin returned 200 — admin panel may be exposed').not.toBe(200);
  });
});
