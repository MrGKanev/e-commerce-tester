import { test, expect } from './fixtures';
import { pageCheck } from './page-check';
import { BASE } from './helpers';

const STATIC_PAGES = [
  { label: 'Contact', paths: ['/pages/contact', '/pages/contacts', '/pages/kontakt', '/contact'] },
  { label: 'About', paths: ['/pages/about', '/pages/about-us', '/pages/za-nas', '/about'] },
  { label: 'FAQ', paths: ['/pages/faq', '/pages/faqs', '/pages/chesto-zadavani-vaprosi'] },
  { label: 'Privacy Policy', paths: ['/policies/privacy-policy'] },
  { label: 'Terms of Service', paths: ['/policies/terms-of-service'] },
  { label: 'Refund Policy', paths: ['/policies/refund-policy'] },
  { label: 'Shipping Policy', paths: ['/policies/shipping-policy'] },
];

test.describe('08 · Static pages', { tag: '@full' }, () => {
  for (const { label, paths } of STATIC_PAGES)
    test(`${label} — shared page checks`, async ({ request, page }) => {
      let foundPath = '',
        lastStatus = 0;
      for (const path of paths) {
        const response = await request.get(`${BASE}${path}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          maxRedirects: 5,
        });
        lastStatus = response.status();
        if (lastStatus < 400) {
          foundPath = path;
          break;
        }
      }
      test.skip(
        !foundPath,
        `${label} not found (tried: ${paths.join(', ')}) last status: ${lastStatus}`,
      );
      await pageCheck(`${label} page is reachable`, async () => {
        expect(foundPath, `${label} is not reachable`).toBeTruthy();
      });
      await page.goto(`${BASE}${foundPath}`, { waitUntil: 'domcontentloaded' });
      await pageCheck(`${label} page renders content (not blank)`, async () => {
        const h1 = page.locator('h1').first(),
          main = page.locator('main, #main-content, [role="main"]').first();
        expect(
          (await h1.count()) > 0 || (await main.count()) > 0,
          `${label} page has neither <h1> nor <main>`,
        ).toBe(true);
        expect(
          (await page.evaluate(() => document.body.innerText)).trim().length,
          `${label} page body text is too short`,
        ).toBeGreaterThan(50);
      });
      await pageCheck(`${label} page has no horizontal overflow`, async () => {
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 5),
          `${label} page has horizontal overflow`,
        ).toBe(false);
      });
      if (label === 'Contact')
        await pageCheck('contact form is present on contact page (if found)', async step => {
          step.skip(
            !['/pages/contact', '/pages/contacts', '/pages/kontakt'].includes(foundPath),
            'Contact form candidate page not found',
          );
          const form = page
            .locator('form[action*="contact"], form[id*="contact"], #contact_form')
            .first();
          const count = await form.count();
          if (count === 0) {
            step.skip(true, 'Contact page found but no contact form detected');
            return;
          }
          await expect(form).toBeVisible();

          // Form should have at least an email input and a submit button
          const emailInput = form.locator('input[type="email"], input[name*="email"]').first();
          const submitBtn = form.locator('button[type="submit"], input[type="submit"]').first();
          await expect(emailInput).toBeVisible();
          await expect(submitBtn).toBeVisible();
        });
    });

  test('policy links in footer are reachable', async ({ page, request }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });

    const policyLinks = await page.$$eval('footer a[href*="/policies/"]', anchors => [
      ...new Set(anchors.map(a => (a as HTMLAnchorElement).getAttribute('href') ?? '')),
    ]);

    if (policyLinks.length === 0) {
      test.skip(true, 'No policy links found in footer');
      return;
    }

    const failures: string[] = [];
    for (const path of policyLinks) {
      const url = path.startsWith('http') ? path : `${BASE}${path}`;
      const resp = await request.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!resp || resp.status() >= 400) {
        failures.push(`${path} → ${resp?.status() ?? 'error'}`);
      }
    }
    expect(failures, `Broken policy links:\n${failures.join('\n')}`).toHaveLength(0);
  });
});
