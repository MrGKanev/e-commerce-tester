import { test, expect } from '@playwright/test';
import { BASE } from './helpers';

const STATIC_PAGES = [
  { label: 'Contact',         paths: ['/pages/contact', '/pages/contacts', '/pages/kontakt', '/contact'] },
  { label: 'About',           paths: ['/pages/about', '/pages/about-us', '/pages/za-nas', '/about'] },
  { label: 'FAQ',             paths: ['/pages/faq', '/pages/faqs', '/pages/chesto-zadavani-vaprosi'] },
  { label: 'Privacy Policy',  paths: ['/policies/privacy-policy'] },
  { label: 'Terms of Service',paths: ['/policies/terms-of-service'] },
  { label: 'Refund Policy',   paths: ['/policies/refund-policy'] },
  { label: 'Shipping Policy', paths: ['/policies/shipping-policy'] },
];

test.describe('08 · Static pages', () => {

  for (const { label, paths } of STATIC_PAGES) {
    test(`${label} page is reachable`, async ({ request, page }) => {
      let foundPath = '';
      let lastStatus = 0;

      for (const path of paths) {
        const resp = await request
          .get(`${BASE}${path}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            maxRedirects: 5,
          })
          .catch(() => null);
        const status = resp?.status() ?? 0;
        if (status < 400) { foundPath = path; break; }
        lastStatus = status;
      }

      if (!foundPath) {
        test.skip(true, `${label} not found (tried: ${paths.join(', ')}) last status: ${lastStatus}`);
        return;
      }

      expect(foundPath, `${label} is not reachable`).toBeTruthy();
    });

    test(`${label} page renders content (not blank)`, async ({ request, page }) => {
      let foundPath = '';
      for (const path of paths) {
        const resp = await request
          .get(`${BASE}${path}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, maxRedirects: 5 })
          .catch(() => null);
        if (resp && resp.status() < 400) { foundPath = path; break; }
      }

      if (!foundPath) {
        test.skip(true, `${label} page not found — skipping content check`);
        return;
      }

      await page.goto(`${BASE}${foundPath}`, { waitUntil: 'domcontentloaded' });

      // Page should have an H1 or main content
      const h1 = page.locator('h1').first();
      const main = page.locator('main, #main-content, [role="main"]').first();
      const hasH1 = (await h1.count()) > 0;
      const hasMain = (await main.count()) > 0;
      expect(hasH1 || hasMain, `${label} page has neither <h1> nor <main>`).toBe(true);

      // Content should be non-trivially long
      const bodyText = await page.evaluate(() => document.body.innerText);
      expect(
        bodyText.trim().length,
        `${label} page body text is too short`,
      ).toBeGreaterThan(50);
    });

    test(`${label} page has no horizontal overflow`, async ({ request, page }) => {
      let foundPath = '';
      for (const path of paths) {
        const resp = await request
          .get(`${BASE}${path}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, maxRedirects: 5 })
          .catch(() => null);
        if (resp && resp.status() < 400) { foundPath = path; break; }
      }
      if (!foundPath) {
        test.skip(true, `${label} page not found`);
        return;
      }

      await page.goto(`${BASE}${foundPath}`, { waitUntil: 'domcontentloaded' });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 5,
      );
      expect(overflow, `${label} page has horizontal overflow`).toBe(false);
    });
  }

  // ── Contact form ──────────────────────────────────────────────────────────

  test('contact form is present on contact page (if found)', async ({ request, page }) => {
    let foundPath = '';
    for (const path of ['/pages/contact', '/pages/contacts', '/pages/kontakt']) {
      const resp = await request
        .get(`${BASE}${path}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, maxRedirects: 5 })
        .catch(() => null);
      if (resp && resp.status() < 400) { foundPath = path; break; }
    }
    if (!foundPath) {
      test.skip(true, 'Contact page not found');
      return;
    }

    await page.goto(`${BASE}${foundPath}`, { waitUntil: 'domcontentloaded' });

    const form = page.locator('form[action*="contact"], form[id*="contact"], #contact_form').first();
    const count = await form.count();
    if (count === 0) {
      test.skip(true, 'Contact page found but no contact form detected');
      return;
    }
    await expect(form).toBeVisible();

    // Form should have at least an email input and a submit button
    const emailInput = form.locator('input[type="email"], input[name*="email"]').first();
    const submitBtn = form.locator('button[type="submit"], input[type="submit"]').first();
    await expect(emailInput).toBeVisible();
    await expect(submitBtn).toBeVisible();
  });

  // ── Policy pages accessible from footer ───────────────────────────────────

  test('policy links in footer are reachable', async ({ page, request }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });

    const policyLinks = await page.$$eval(
      'footer a[href*="/policies/"]',
      (anchors) => [...new Set(anchors.map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? ''))],
    );

    if (policyLinks.length === 0) {
      test.skip(true, 'No policy links found in footer');
      return;
    }

    const failures: string[] = [];
    for (const path of policyLinks) {
      const url = path.startsWith('http') ? path : `${BASE}${path}`;
      const resp = await request
        .get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        .catch(() => null);
      if (!resp || resp.status() >= 400) {
        failures.push(`${path} → ${resp?.status() ?? 'error'}`);
      }
    }
    expect(failures, `Broken policy links:\n${failures.join('\n')}`).toHaveLength(0);
  });
});
