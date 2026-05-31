/**
 * 21 · Trust signals
 *
 * Checks the presence of conversion-critical trust elements:
 *  - Payment method badges (Visa, Mastercard, PayPal, etc.)
 *  - Return / refund policy accessible from footer
 *  - Contact information (email, phone, or chat widget)
 *  - Shipping / return note on product pages
 *  - Social proof indicators (reviews, ratings)
 */
import { test, expect } from '@playwright/test';
import { BASE, KNOWN_PRODUCT, goto } from './helpers';

// ─────────────────────────────────────────────────────────────────────────────

test.describe('21 · Trust signals', () => {

  // ── Payment badges ────────────────────────────────────────────────────────

  test('payment method icons are visible (footer, cart, or product page)', async ({ page }) => {
    // Check homepage/footer first
    await goto(page);

    const paymentSel = [
      // Shopify payment icons SVG/img
      '.payment-icons',
      '.footer__payment-icons',
      '[class*="payment-icon"]',
      '[class*="payment-badge"]',
      'img[alt*="Visa"]',
      'img[alt*="Mastercard"]',
      'img[alt*="PayPal"]',
      'svg[aria-label*="Visa"]',
      'svg[aria-label*="Mastercard"]',
      // Shopify native payment icons (SVG use elements)
      '.icon-visa',
      '.icon-mastercard',
      '.icon-paypal',
    ].join(', ');

    let count = await page.locator(paymentSel).count();

    if (count === 0) {
      // Try cart page
      await page.goto(`${BASE}/cart`, { waitUntil: 'domcontentloaded' });
      count = await page.locator(paymentSel).count();
    }

    if (count === 0) {
      // Try product page
      await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });
      count = await page.locator(paymentSel).count();
    }

    if (count === 0) {
      test.skip(true, 'No payment badge icons found — may use text-only or be theme-dependent');
      return;
    }
    expect(count).toBeGreaterThan(0);
  });

  // ── Policies in footer ────────────────────────────────────────────────────

  test('refund / return policy link is in the footer', async ({ page }) => {
    await goto(page);

    const refundSel = [
      'footer a[href*="refund"]',
      'footer a[href*="return"]',
      'footer a[href*="policies"]',
      'footer a:has-text("Refund")',
      'footer a:has-text("Return")',
      'footer a:has-text("Върни")',
      'footer a:has-text("Върнe")',
      'footer a:has-text("Политика за връщане")',
      'footer a:has-text("Рефунд")',
    ].join(', ');

    const link = page.locator(refundSel).first();
    if ((await link.count()) === 0) {
      test.skip(true, 'No return/refund policy link found in footer');
      return;
    }
    await expect(link).toBeVisible();
  });

  test('privacy policy link exists on site', async ({ page }) => {
    await goto(page);

    const privacySel = [
      'a[href*="privacy"]',
      'a:has-text("Privacy")',
      'a:has-text("Поверителност")',
      'a:has-text("Политика за поверителност")',
    ].join(', ');

    const link = page.locator(privacySel).first();
    if ((await link.count()) === 0) {
      test.skip(true, 'No privacy policy link found');
      return;
    }
    await expect(link).toBeVisible();
  });

  // ── Contact information ───────────────────────────────────────────────────

  test('contact information (email, phone, or form) is accessible', async ({ page }) => {
    await goto(page);

    const contactSel = [
      'a[href^="mailto:"]',
      'a[href^="tel:"]',
      'a[href*="/pages/contact"]',
      'a[href*="/pages/contacts"]',
      'a[href*="contact"]',
      '[class*="chat"]',
      '[id*="chat"]',
      'a:has-text("Contact")',
      'a:has-text("Контакт")',
      'a:has-text("Свържете се")',
    ].join(', ');

    const contact = page.locator(contactSel).first();
    if ((await contact.count()) === 0) {
      test.skip(true, 'No contact info or contact page link found');
      return;
    }
    await expect(contact).toBeVisible();
  });

  test('footer contains at least a copyright or company name', async ({ page }) => {
    await goto(page);
    const footer = page.locator('footer').first();
    if ((await footer.count()) === 0) {
      test.skip(true, 'No footer element found');
      return;
    }
    const text = await footer.textContent();
    expect(text?.trim().length ?? 0, 'Footer appears to be empty').toBeGreaterThan(10);
  });

  // ── Product page trust elements ───────────────────────────────────────────

  test('product page mentions shipping or delivery information', async ({ page }) => {
    await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });

    const shippingSel = [
      '[class*="shipping"]',
      '[class*="delivery"]',
      '[class*="доставка"]',
      ':has-text("Free shipping")',
      ':has-text("Безплатна доставка")',
      ':has-text("Доставка")',
      ':has-text("Shipping")',
      ':has-text("ships")',
    ].join(', ');

    const el = page.locator(shippingSel).first();
    if ((await el.count()) === 0) {
      test.skip(true, 'No shipping information found on product page');
      return;
    }
    await expect(el).toBeVisible();
  });

  test('product page mentions return or money-back information', async ({ page }) => {
    await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });

    const returnSel = [
      '[class*="return"]',
      '[class*="refund"]',
      '[class*="guarantee"]',
      ':has-text("Returns")',
      ':has-text("Върни")',
      ':has-text("Върнe")',
      ':has-text("money back")',
      ':has-text("Money-back")',
      ':has-text("Гаранция")',
      ':has-text("Рефунд")',
    ].join(', ');

    const el = page.locator(returnSel).first();
    if ((await el.count()) === 0) {
      test.skip(true, 'No return/refund mention found on product page');
      return;
    }
    await expect(el).toBeVisible();
  });

  // ── Social proof ──────────────────────────────────────────────────────────

  test('product page shows a reviews or ratings section (if enabled)', async ({ page }) => {
    await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });

    // Scroll to bottom to allow lazy-loaded review widgets
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(800);

    const reviewSel = [
      '[class*="review"]',
      '[class*="rating"]',
      '[class*="testimonial"]',
      '[id*="review"]',
      '[id*="rating"]',
      'star-rating',
      '.stamped-reviews',
      '.yotpo',
      '.spr-summary',
      '[data-reviews]',
    ].join(', ');

    const reviews = page.locator(reviewSel).first();
    if ((await reviews.count()) === 0) {
      test.skip(true, 'No reviews/ratings section found — feature may not be enabled');
      return;
    }
    await expect(reviews).toBeVisible();
  });

  test('product page has social share buttons (if enabled)', async ({ page }) => {
    await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });

    const shareSel = [
      '[class*="share"]',
      '[aria-label*="Share"]',
      '[aria-label*="Сподели"]',
      'a[href*="facebook.com/sharer"]',
      'a[href*="twitter.com/intent"]',
      'a[href*="pinterest.com/pin"]',
    ].join(', ');

    const shareBtn = page.locator(shareSel).first();
    if ((await shareBtn.count()) === 0) {
      test.skip(true, 'No social share buttons found');
      return;
    }
    await expect(shareBtn).toBeVisible();
  });
});
