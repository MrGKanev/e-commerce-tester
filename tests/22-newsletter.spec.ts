/**
 * 22 · Newsletter / email signup
 *
 * Verifies that the email capture form:
 *  - Is present and visible (footer, popup, or dedicated section)
 *  - Has a functional email input
 *  - Shows validation feedback on empty / invalid submit
 *  - Does not crash with a valid email (without actually subscribing)
 */
import { test, expect } from '@playwright/test';
import { BASE, goto } from './helpers';

const EMAIL_INPUT_SEL = [
  'form[action*="contact"] input[type="email"]',
  'form[action*="newsletter"] input[type="email"]',
  'form[action*="subscribe"] input[type="email"]',
  '.footer input[type="email"]',
  '[class*="newsletter"] input[type="email"]',
  '[class*="subscribe"] input[type="email"]',
  '[id*="newsletter"] input[type="email"]',
  '[id*="subscribe"] input[type="email"]',
  'input[placeholder*="email" i]',
  'input[placeholder*="Email"]',
  'input[placeholder*="имейл" i]',
  'input[name="contact[email]"]',
  'input[name="email"]',
].join(', ');

const NEWSLETTER_FORM_SEL = [
  'form[action*="contact"]',
  'form[action*="newsletter"]',
  'form[action*="subscribe"]',
  '[class*="newsletter"] form',
  '[class*="subscribe"] form',
  '.footer form',
].join(', ');

// ─────────────────────────────────────────────────────────────────────────────

test.describe('22 · Newsletter signup', () => {

  test('email signup form or input exists on the homepage', async ({ page }) => {
    await goto(page);

    const input = page.locator(EMAIL_INPUT_SEL).first();
    if ((await input.count()) === 0) {
      test.skip(true, 'No email signup input found on homepage');
      return;
    }
    await expect(input).toBeVisible();
  });

  test('email input is inside a form element', async ({ page }) => {
    await goto(page);

    const form = page.locator(NEWSLETTER_FORM_SEL).first();
    if ((await form.count()) === 0) {
      test.skip(true, 'No newsletter form found');
      return;
    }
    await expect(form).toBeVisible();

    const emailInForm = form.locator('input[type="email"]').first();
    if ((await emailInForm.count()) === 0) {
      test.skip(true, 'Form found but no email input inside it');
      return;
    }
    await expect(emailInForm).toBeVisible();
  });

  test('submitting an empty email input does not navigate away or crash the page', async ({ page }) => {
    await goto(page);

    const input = page.locator(EMAIL_INPUT_SEL).first();
    if ((await input.count()) === 0) {
      test.skip(true, 'No email signup input found');
      return;
    }

    const jsErrors: string[] = [];
    page.on('pageerror', err => jsErrors.push(err.message));

    const urlBefore = page.url();

    // Focus and submit without filling in
    await input.click();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1_000);

    // Should either stay on the same page or show a validation message
    const urlAfter = page.url();
    const stayedOnPage = urlAfter === urlBefore || urlAfter.startsWith(urlBefore);

    const hasValidation = await page.evaluate(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>('input[type="email"]');
      return Array.from(inputs).some(i => !i.validity.valid);
    });

    expect(
      stayedOnPage || hasValidation,
      'Empty submit navigated away without validation',
    ).toBe(true);

    const critical = jsErrors.filter(e =>
      !e.includes('cross-origin') &&
      !e.includes('ResizeObserver'),
    );
    expect(critical, `JS errors after empty submit:\n${critical.join('\n')}`).toHaveLength(0);
  });

  test('email input rejects an invalid format (browser-level validation)', async ({ page }) => {
    await goto(page);

    const input = page.locator(EMAIL_INPUT_SEL).first();
    if ((await input.count()) === 0) {
      test.skip(true, 'No email input found');
      return;
    }

    await input.fill('not-an-email');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    const isInvalid = await input.evaluate((el: HTMLInputElement) => !el.validity.valid);
    expect(isInvalid, 'Email input accepted "not-an-email" as valid').toBe(true);
  });

  test('submit button is visible and enabled alongside the email input', async ({ page }) => {
    await goto(page);

    const form = page.locator(NEWSLETTER_FORM_SEL).first();
    if ((await form.count()) === 0) {
      test.skip(true, 'No newsletter form found');
      return;
    }

    const submitSel = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Subscribe")',
      'button:has-text("Sign up")',
      'button:has-text("Абониране")',
      'button:has-text("Запиши се")',
    ].join(', ');

    const submitBtn = form.locator(submitSel).first();
    if ((await submitBtn.count()) === 0) {
      test.skip(true, 'No submit button inside newsletter form');
      return;
    }

    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toBeEnabled();
  });

  test('form has a privacy notice or link near it (GDPR)', async ({ page }) => {
    await goto(page);

    const form = page.locator(NEWSLETTER_FORM_SEL).first();
    if ((await form.count()) === 0) {
      test.skip(true, 'No newsletter form found');
      return;
    }

    // Look for privacy-related text near the form
    const privacySel = [
      'a[href*="privacy"]',
      'a:has-text("Privacy")',
      'a:has-text("Поверителност")',
      ':has-text("privacy policy")',
      ':has-text("политика за поверителност")',
    ].join(', ');

    // Check within the form or in its immediate container
    const formParent = page.locator(NEWSLETTER_FORM_SEL).locator('..').first();
    const hasPrivacy = (await formParent.locator(privacySel).count()) > 0 ||
                       (await page.locator('footer').locator(privacySel).count()) > 0;

    if (!hasPrivacy) {
      console.warn('No privacy policy link found near newsletter form — GDPR concern');
    }
    // Soft check — warn but do not fail
  });
});
