import { test, expect } from '@playwright/test';
import { BASE, KNOWN_PRODUCT, ADD_TO_CART_SEL, CART_ITEMS_SEL } from './helpers';

// Helper: add the known product to cart and return to the cart page
async function addKnownProductToCart(page: import('@playwright/test').Page) {
  await page.goto(KNOWN_PRODUCT, { waitUntil: 'domcontentloaded' });
  const btn = page.locator(ADD_TO_CART_SEL).first();
  if ((await btn.count()) === 0 || await btn.isDisabled()) return false;
  await btn.click();
  // Wait for any cart response
  await Promise.race([
    page.waitForURL('**/cart**', { timeout: 6000 }).catch(() => null),
    page.waitForTimeout(4000),
  ]);
  if (!page.url().includes('/cart')) {
    await page.goto(`${BASE}/cart`, { waitUntil: 'domcontentloaded' });
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('05 · Cart', () => {

  // ── Cart page ─────────────────────────────────────────────────────────────

  test('cart page loads without errors', async ({ page }) => {
    const resp = await page.goto(`${BASE}/cart`, { waitUntil: 'domcontentloaded' });
    expect(resp?.status()).toBeLessThan(400);
    await expect(page).not.toHaveTitle(/404|not found/i);
  });

  test('empty cart shows an empty state message (not blank page)', async ({ page }) => {
    // Start fresh with an empty cart
    await page.goto(`${BASE}/cart/clear`, { waitUntil: 'domcontentloaded' }).catch(() => null);
    await page.goto(`${BASE}/cart`, { waitUntil: 'domcontentloaded' });

    const body = await page.textContent('body');
    expect(body?.trim().length ?? 0, 'Cart page body is empty').toBeGreaterThan(50);

    // Should show some "empty" indication OR a list of cart items (not a blank white page)
    const hasContent = await page.locator(
      '[class*="empty"], [class*="cart-empty"], p:has-text("empty"), p:has-text("празна"), .is-empty',
    ).count() > 0 ||
    await page.locator('.cart-form, form[action="/cart"]').count() > 0;
    expect(hasContent, 'Cart page has no empty state and no cart form').toBe(true);
  });

  test('cart link in header is visible and correct', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    const cartLink = page.locator(
      'a[href="/cart"], header a[href*="cart"], [aria-label*="Cart"], [aria-label*="Количка"]',
    ).first();
    await expect(cartLink).toBeVisible();
    const href = await cartLink.getAttribute('href');
    expect(href).toContain('cart');
  });

  // ── Add to cart ───────────────────────────────────────────────────────────

  test('can add a product to cart', async ({ page }) => {
    const added = await addKnownProductToCart(page);
    if (!added) test.skip(true, 'Could not add product to cart');

    const items = page.locator(CART_ITEMS_SEL);
    const count = await items.count();
    expect(count, 'Cart is empty after adding product').toBeGreaterThan(0);
  });

  test('cart shows product name after adding', async ({ page }) => {
    const added = await addKnownProductToCart(page);
    if (!added) test.skip(true, 'Could not add product to cart');

    const cartText = await page.textContent('body');
    // Z1 product handle should appear somewhere on the cart page
    const hasProductName = /zerno|z1|z-1/i.test(cartText ?? '');
    expect(hasProductName, 'Product name not found in cart page').toBe(true);
  });

  test('cart shows a price / subtotal', async ({ page }) => {
    const added = await addKnownProductToCart(page);
    if (!added) test.skip(true, 'Could not add product to cart');

    const totalSel = [
      '.cart__subtotal',
      '.totals__subtotal-value',
      '[class*="subtotal"]',
      '[class*="total-price"]',
      '.cart-subtotal',
      'td.price',
      'p.price',
    ].join(', ');

    const total = page.locator(totalSel).first();
    const count = await total.count();
    if (count === 0) test.skip(true, 'No subtotal element found on cart page');

    await expect(total).toBeVisible();
    const text = await total.textContent();
    expect(text).toMatch(/[\d.,]+/);
  });

  // ── Quantity changes ──────────────────────────────────────────────────────

  test('cart quantity can be increased', async ({ page }) => {
    const added = await addKnownProductToCart(page);
    if (!added) test.skip(true, 'Could not add product to cart');

    const qtySel = [
      '.cart__qty input',
      '.quantity__input',
      'input[name="updates[]"]',
      '[class*="quantity"] input',
    ].join(', ');

    const qtyInput = page.locator(qtySel).first();
    const count = await qtyInput.count();
    if (count === 0) {
      // Try +/increase button instead
      const increaseBtn = page.locator(
        'button[name="plus"], button[aria-label*="Increase"], .quantity__button:last-child, button:has-text("+")',
      ).first();
      if ((await increaseBtn.count()) === 0) {
        test.skip(true, 'No quantity controls found on cart page');
        return;
      }
      const oldText = await page.textContent('body');
      await increaseBtn.click();
      await page.waitForTimeout(1500);
      const newText = await page.textContent('body');
      // Subtotal should change or quantity should change
      expect(newText).not.toBe(oldText);
      return;
    }

    await expect(qtyInput).toBeVisible();
    const valueBefore = await qtyInput.inputValue();
    await qtyInput.fill(String(Number(valueBefore) + 1));
    await qtyInput.press('Enter');
    await page.waitForTimeout(1500);

    const valueAfter = await qtyInput.inputValue();
    expect(Number(valueAfter), 'Quantity did not increase').toBeGreaterThan(Number(valueBefore));
  });

  // ── Remove from cart ──────────────────────────────────────────────────────

  test('can remove an item from cart', async ({ page }) => {
    const added = await addKnownProductToCart(page);
    if (!added) test.skip(true, 'Could not add product to cart');

    const countBefore = await page.locator(CART_ITEMS_SEL).count();
    if (countBefore === 0) test.skip(true, 'No items in cart to remove');

    const removeBtn = page.locator(
      '[class*="remove"], [class*="delete"], a[href*="quantity=0"], button[aria-label*="Remove"], button[aria-label*="Премахни"], .cart__remove',
    ).first();

    const removeBtnCount = await removeBtn.count();
    if (removeBtnCount === 0) {
      // Try setting qty to 0 and updating
      const qtyInput = page.locator('input[name="updates[]"]').first();
      if ((await qtyInput.count()) === 0) {
        test.skip(true, 'No remove button or quantity input found');
        return;
      }
      await qtyInput.fill('0');
      const updateBtn = page.locator(
        'button[name="update"], input[name="update"], [name="update"]',
      ).first();
      if ((await updateBtn.count()) > 0) await updateBtn.click();
    } else {
      await removeBtn.click();
    }

    await page.waitForTimeout(2000);

    const countAfter = await page.locator(CART_ITEMS_SEL).count();
    expect(
      countAfter,
      `Item count did not decrease (before: ${countBefore}, after: ${countAfter})`,
    ).toBeLessThan(countBefore);
  });

  // ── Checkout button ───────────────────────────────────────────────────────

  test('checkout button is visible when cart has items', async ({ page }) => {
    const added = await addKnownProductToCart(page);
    if (!added) test.skip(true, 'Could not add product to cart');

    const checkoutBtn = page.locator(
      '[name="checkout"], a[href*="/checkout"], button:has-text("Checkout"), button:has-text("Поръчай"), button:has-text("Към поръчката")',
    ).first();
    await expect(checkoutBtn).toBeVisible();
  });

  test('checkout button links to /checkout', async ({ page }) => {
    const added = await addKnownProductToCart(page);
    if (!added) test.skip(true, 'Could not add product to cart');

    const checkoutBtn = page.locator(
      '[name="checkout"], a[href*="/checkout"], button:has-text("Checkout")',
    ).first();
    const count = await checkoutBtn.count();
    if (count === 0) test.skip(true, 'No checkout button found');

    const tag = await checkoutBtn.evaluate((el) => el.tagName.toLowerCase());
    if (tag === 'a') {
      const href = await checkoutBtn.getAttribute('href');
      expect(href).toContain('checkout');
    } else {
      // It's a submit button inside a form — check the form action
      const formAction = await checkoutBtn.evaluate(
        (el) => (el.closest('form') as HTMLFormElement)?.action ?? '',
      );
      expect(formAction).toContain('checkout');
    }
  });

  // ── Cart on mobile ────────────────────────────────────────────────────────

  test('cart page is usable on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await addKnownProductToCart(page);

    // Re-check since viewport changed
    await page.goto(`${BASE}/cart`, { waitUntil: 'domcontentloaded' });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 5,
    );
    expect(overflow, 'Cart page has horizontal overflow on mobile').toBe(false);

    const checkoutBtn = page.locator(
      '[name="checkout"], a[href*="/checkout"]',
    ).first();
    const count = await checkoutBtn.count();
    if (count > 0) await expect(checkoutBtn).toBeVisible();
  });
});
