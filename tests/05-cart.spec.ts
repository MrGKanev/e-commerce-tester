import { addProductToCart, cartAction, BASE, KNOWN_PRODUCTS, CART_ITEMS_SEL } from './helpers';
import { test, expect } from './fixtures';
import { verifyEmptyCart } from './storefront-assertions';
import { CommerceUnverified } from '../scripts/storefront-model';

// Helper: add the known product to cart and return to the cart page
async function addKnownProductToCart(page: import('@playwright/test').Page) {
  return addProductToCart(page);
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('05 · Cart', { tag: ['@full'] }, () => {
  // ── Cart page ─────────────────────────────────────────────────────────────

  test('cart page loads without errors', async ({ page }) => {
    const resp = await page.goto(`${BASE}/cart`, { waitUntil: 'domcontentloaded' });
    expect(resp?.status()).toBeLessThan(400);
    await expect(page).not.toHaveTitle(/404|not found/i);
  });

  test('empty cart has a visible empty indication, no UI rows and no public cart items', async ({
    page,
  }, info) => {
    try {
      await verifyEmptyCart(page, info);
    } catch (error) {
      if (!(error instanceof CommerceUnverified)) throw error;
      info.annotations.push({ type: 'cart-unverified', description: error.message });
      test.skip(true, error.message);
    }
  });

  test('cart link in header is visible and correct', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    const cartLink = page
      .locator(
        'a[href="/cart"], header a[href*="cart"], [aria-label*="Cart"], [aria-label*="Количка"]',
      )
      .first();
    await expect(cartLink).toBeVisible();
    const href = await cartLink.getAttribute('href');
    expect(href).toContain('cart');
  });

  // ── Add to cart ───────────────────────────────────────────────────────────

  test('can add a product to cart', { tag: '@smoke' }, async ({ page }) => {
    const added = await addKnownProductToCart(page);
    if (!added) test.skip(true, 'Configured product is sold out');

    const items = page.locator(CART_ITEMS_SEL);
    const count = await items.count();
    expect(count, 'Cart is empty after adding product').toBeGreaterThan(0);
  });

  test('cart shows product name after adding', async ({ page }) => {
    const added = await addKnownProductToCart(page);
    if (!added) test.skip(true, 'Configured product is sold out');

    const cartText = await page.textContent('body');
    // Z1 product handle should appear somewhere on the cart page
    const hasProductName =
      cartText?.toLowerCase().includes(KNOWN_PRODUCTS[0].handle.toLowerCase()) ?? false;
    expect(hasProductName, 'Product name not found in cart page').toBe(true);
  });

  test('cart shows a price / subtotal', async ({ page }) => {
    const added = await addKnownProductToCart(page);
    if (!added) test.skip(true, 'Configured product is sold out');

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
    if (!added) test.skip(true, 'Configured product is sold out');

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
      const increaseBtn = page
        .locator(
          'button[name="plus"], button[aria-label*="Increase"], .quantity__button:last-child, button:has-text("+")',
        )
        .first();
      if ((await increaseBtn.count()) === 0) {
        test.skip(true, 'No quantity controls found on cart page');
        return;
      }
      const oldText = await page.textContent('body');
      await cartAction(page, () => increaseBtn.click());
      await expect(page.locator('body')).not.toHaveText(oldText || '');
      return;
    }

    await expect(qtyInput).toBeVisible();
    const valueBefore = await qtyInput.inputValue();
    await qtyInput.fill(String(Number(valueBefore) + 1));
    await cartAction(page, () => qtyInput.press('Enter'));

    const valueAfter = await qtyInput.inputValue();
    expect(Number(valueAfter), 'Quantity did not increase').toBeGreaterThan(Number(valueBefore));
  });

  // ── Remove from cart ──────────────────────────────────────────────────────

  test('can remove an item from cart', async ({ page }) => {
    const added = await addKnownProductToCart(page);
    if (!added) test.skip(true, 'Configured product is sold out');

    const countBefore = await page.locator(CART_ITEMS_SEL).count();
    if (countBefore === 0) test.skip(true, 'No items in cart to remove');

    const removeBtn = page
      .locator(
        '[class*="remove"], [class*="delete"], a[href*="quantity=0"], button[aria-label*="Remove"], button[aria-label*="Премахни"], .cart__remove',
      )
      .first();

    await cartAction(page, async () => {
      if ((await removeBtn.count()) > 0) {
        await removeBtn.click();
      } else {
        const qtyInput = page.locator('input[name="updates[]"]').first();
        await expect(qtyInput).toBeVisible();
        await qtyInput.fill('0');
        const updateBtn = page.locator('[name="update"]').first();
        if (await updateBtn.isVisible()) await updateBtn.click();
        else await qtyInput.press('Enter');
      }
    });
    await expect.poll(() => page.locator(CART_ITEMS_SEL).count()).toBeLessThan(countBefore);

    const countAfter = await page.locator(CART_ITEMS_SEL).count();
    expect(
      countAfter,
      `Item count did not decrease (before: ${countBefore}, after: ${countAfter})`,
    ).toBeLessThan(countBefore);
  });

  // ── Checkout button ───────────────────────────────────────────────────────

  test('checkout button is visible when cart has items', async ({ page }) => {
    const added = await addKnownProductToCart(page);
    if (!added) test.skip(true, 'Configured product is sold out');

    const checkoutBtn = page
      .locator(
        '[name="checkout"], a[href*="/checkout"], button:has-text("Checkout"), button:has-text("Поръчай"), button:has-text("Към поръчката")',
      )
      .first();
    await expect(checkoutBtn).toBeVisible();
  });

  test('checkout button links to /checkout', async ({ page }) => {
    const added = await addKnownProductToCart(page);
    if (!added) test.skip(true, 'Configured product is sold out');

    const checkoutBtn = page
      .locator('[name="checkout"], a[href*="/checkout"], button:has-text("Checkout")')
      .first();
    const count = await checkoutBtn.count();
    if (count === 0) test.skip(true, 'No checkout button found');

    const tag = await checkoutBtn.evaluate(el => el.tagName.toLowerCase());
    if (tag === 'a') {
      const href = await checkoutBtn.getAttribute('href');
      expect(href).toContain('checkout');
    } else {
      // It's a submit button inside a form — check the form action
      const formAction = await checkoutBtn.evaluate(
        el => (el.closest('form') as HTMLFormElement)?.action ?? '',
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

    const checkoutBtn = page.locator('[name="checkout"], a[href*="/checkout"]').first();
    const count = await checkoutBtn.count();
    if (count > 0) await expect(checkoutBtn).toBeVisible();
  });
});
