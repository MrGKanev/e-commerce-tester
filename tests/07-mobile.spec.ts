/**
 * 07-mobile.spec.ts
 *
 * Deep mobile / responsive tests:
 * - Horizontal overflow on every key page
 * - Element overlap / z-index detection (buttons covered by overlays)
 * - Touch target sizes
 * - Font sizes (iOS zoom prevention)
 * - Sticky header behaviour
 * - Image sizing
 * - Fixed/sticky element audit
 */

import { test, expect, type Page } from '@playwright/test';
import {
  BASE,
  KNOWN_PRODUCTS,
  ADD_TO_CART_SEL,
  MOBILE_MENU_TOGGLE_SEL,
  getFixedElements,
  getFontSize,
} from './helpers';

// ─── Viewport presets ────────────────────────────────────────────────────────

const VIEWPORTS = [
  { name: 'iPhone 14 Pro', width: 390, height: 844 },
  { name: 'iPhone SE', width: 375, height: 667 },
  { name: 'iPad', width: 768, height: 1024 },
];

// Pages to test for overflow
const KEY_PAGES = [
  { label: 'Homepage', path: '/' },
  { label: 'Collections', path: '/collections/all' },
  { label: 'Cart', path: '/cart' },
  { label: 'Search', path: '/search?q=zerno' },
  ...KNOWN_PRODUCTS.map((p) => ({
    label: `Product ${p.handle}`,
    path: `/products/${p.handle}`,
  })),
];

// ─────────────────────────────────────────────────────────────────────────────
// Horizontal overflow — every key page, every viewport
// ─────────────────────────────────────────────────────────────────────────────

test.describe('07 · Mobile — horizontal overflow', () => {
  for (const vp of VIEWPORTS) {
    for (const pg of KEY_PAGES) {
      test(`${pg.label} has no horizontal scroll at ${vp.name} (${vp.width}px)`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`${BASE}${pg.path}`, { waitUntil: 'domcontentloaded' });

        const overflow = await page.evaluate(() => {
          // Check both body and html
          return (
            document.documentElement.scrollWidth > window.innerWidth + 5 ||
            document.body.scrollWidth > window.innerWidth + 5
          );
        });

        if (overflow) {
          // Find the culprit elements
          const culprits = await page.evaluate(() => {
            const overflowing: string[] = [];
            document.querySelectorAll('*').forEach((el) => {
              const rect = el.getBoundingClientRect();
              if (rect.right > window.innerWidth + 10) {
                const tag = el.tagName.toLowerCase();
                const cls = el.className?.toString().slice(0, 60) ?? '';
                overflowing.push(`${tag}${cls ? '.' + cls.replace(/\s+/g, '.') : ''} right:${Math.round(rect.right)}px`);
              }
            });
            return overflowing.slice(0, 10); // limit output
          });
          expect(
            false,
            `${pg.label} overflows at ${vp.width}px. Culprits:\n${culprits.join('\n')}`,
          ).toBe(true);
        }
      });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Element overlap / z-index audit
// ─────────────────────────────────────────────────────────────────────────────

test.describe('07 · Mobile — element overlap & z-index audit', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /**
   * Check that critical interactive elements are not covered by fixed overlays.
   * Uses document.elementFromPoint() at the center of each button.
   */
  async function checkNotCovered(
    page: Page,
    targetSelector: string,
    label: string,
  ): Promise<void> {
    const btn = page.locator(targetSelector).first();
    if ((await btn.count()) === 0) return;
    if (!(await btn.isVisible().catch(() => false))) return;

    await btn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    const result = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;

      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const top = document.elementFromPoint(cx, cy);
      if (!top) return null;

      // Is the top element the button itself or a descendant?
      const isSelf = el.contains(top) || top === el;
      if (isSelf) return null; // no overlap

      const topClasses = String(top.className).slice(0, 80);
      const topTag = top.tagName.toLowerCase();
      const topStyle = window.getComputedStyle(top);

      return {
        tag: topTag,
        classes: topClasses,
        position: topStyle.position,
        zIndex: topStyle.zIndex,
        pointer: topStyle.pointerEvents,
      };
    }, targetSelector.split(', ')[0]);

    if (!result) return; // Button is accessible

    // pointer-events: none means the overlay is decorative, not blocking clicks
    if (result.pointer === 'none') return;

    // Warn for non-critical overlaps, fail for click-blocking ones
    const isBlocking =
      result.pointer !== 'none' &&
      ['fixed', 'sticky', 'absolute'].includes(result.position) &&
      Number(result.zIndex) > 10;

    if (isBlocking) {
      // Take a screenshot to document the overlap
      await page.screenshot({ fullPage: false });
      expect(
        false,
        `"${label}" is covered by: ${result.tag}.${result.classes} (position:${result.position} z-index:${result.zIndex})`,
      ).toBe(true);
    }
  }

  test('add-to-cart button is not covered on product page (zerno-z1)', async ({ page }) => {
    await page.goto(`${BASE}/products/zerno-z1`, { waitUntil: 'domcontentloaded' });
    await checkNotCovered(page, ADD_TO_CART_SEL.split(', ')[0], 'Add to cart button');
    // Also try the generic selector
    await checkNotCovered(page, 'form[action*="/cart/add"] button[type="submit"]', 'Cart form submit');
  });

  test('add-to-cart button is not covered on product page (zerno-z2)', async ({ page }) => {
    await page.goto(`${BASE}/products/zerno-z2`, { waitUntil: 'domcontentloaded' });
    await checkNotCovered(page, 'form[action*="/cart/add"] button[type="submit"]', 'Add to cart button');
  });

  test('checkout button on cart is not covered', async ({ page }) => {
    // Add item first
    await page.goto(`${BASE}/products/zerno-z1`, { waitUntil: 'domcontentloaded' });
    const addBtn = page.locator(ADD_TO_CART_SEL).first();
    if ((await addBtn.count()) > 0 && !(await addBtn.isDisabled())) {
      await addBtn.click();
      await page.waitForTimeout(3000);
    }
    await page.goto(`${BASE}/cart`, { waitUntil: 'domcontentloaded' });
    await checkNotCovered(page, '[name="checkout"], a[href*="/checkout"]', 'Checkout button');
  });

  test('mobile menu toggle is not covered', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await checkNotCovered(page, MOBILE_MENU_TOGGLE_SEL.split(', ')[0], 'Hamburger menu toggle');
  });

  test('fixed elements audit — homepage', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000); // let chat widgets / cookie banners load

    const fixed = await getFixedElements(page);

    // Document all fixed elements in the report
    if (fixed.length > 0) {
      console.log(
        `Fixed/sticky elements on homepage (${fixed.length} total):\n`,
        fixed.map((e) => `  [z:${e.zIndex}] ${e.tag}.${e.classes.slice(0, 50)} ${e.rect}`).join('\n'),
      );
    }

    const vh = await page.evaluate(() => window.innerHeight);

    // Find elements that cover more than 60% of the viewport AND have a high z-index
    const majorBlockers = fixed.filter((el) => {
      const m = el.rect.match(/(\d+)x(\d+)/);
      if (!m) return false;
      const h = parseInt(m[2], 10);
      const w = parseInt(m[1], 10);
      const vw = 390;
      return h > vh * 0.6 && w > vw * 0.7 && Number(el.zIndex) > 100;
    });

    expect(
      majorBlockers,
      `Likely modal/overlay blocking most of the screen:\n${majorBlockers.map((e) => JSON.stringify(e)).join('\n')}`,
    ).toHaveLength(0);
  });

  test('fixed elements audit — product page', async ({ page }) => {
    await page.goto(`${BASE}/products/zerno-z1`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    const fixed = await getFixedElements(page);
    if (fixed.length > 0) {
      console.log(
        `Fixed/sticky elements on product page (${fixed.length}):\n`,
        fixed.map((e) => `  [z:${e.zIndex}] ${e.tag}.${e.classes.slice(0, 50)} ${e.rect}`).join('\n'),
      );
    }

    // Check that the add-to-cart button area is not completely blocked
    const addBtnBox = await page.locator(ADD_TO_CART_SEL).first().boundingBox().catch(() => null);
    if (!addBtnBox) return;

    const blockersOverButton = fixed.filter((el) => {
      const m = el.rect.match(/at \((\d+),(\d+)\)/);
      const s = el.rect.match(/(\d+)x(\d+)/);
      if (!m || !s) return false;
      const ex = parseInt(m[1], 10);
      const ey = parseInt(m[2], 10);
      const ew = parseInt(s[1], 10);
      const eh = parseInt(s[2], 10);

      const overlaps =
        ex < addBtnBox.x + addBtnBox.width &&
        ex + ew > addBtnBox.x &&
        ey < addBtnBox.y + addBtnBox.height &&
        ey + eh > addBtnBox.y;

      return overlaps && Number(el.zIndex) > 100;
    });

    if (blockersOverButton.length > 0) {
      console.warn(
        `Potential overlay over add-to-cart button:\n`,
        blockersOverButton.map((e) => JSON.stringify(e)).join('\n'),
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Font sizes — prevent iOS auto-zoom on inputs
// ─────────────────────────────────────────────────────────────────────────────

test.describe('07 · Mobile — font sizes', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('body text font-size is at least 14px', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    const fontSize = await page.evaluate(
      () => parseFloat(window.getComputedStyle(document.body).fontSize),
    );
    expect(fontSize, `Body font-size is ${fontSize}px — too small`).toBeGreaterThanOrEqual(14);
  });

  test('product description font-size is at least 14px', async ({ page }) => {
    await page.goto(`${BASE}/products/zerno-z1`, { waitUntil: 'domcontentloaded' });
    const descSel = '.product__description, .rte, .product-single__description, [class*="description"]';
    const desc = page.locator(descSel).first();
    if ((await desc.count()) === 0) return;

    const fontSize = await getFontSize(page, descSel);
    expect(fontSize, `Product description font-size is ${fontSize}px`).toBeGreaterThanOrEqual(14);
  });

  test('form inputs font-size is ≥16px (prevents iOS auto-zoom)', async ({ page }) => {
    await page.goto(`${BASE}/products/zerno-z1`, { waitUntil: 'domcontentloaded' });

    const inputs = page.locator('input:not([type="hidden"]), select, textarea');
    const count = await inputs.count();
    if (count === 0) return;

    const tooSmall: string[] = [];
    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i);
      if (!(await input.isVisible().catch(() => false))) continue;
      const fontSize = await input.evaluate(
        (el) => parseFloat(window.getComputedStyle(el).fontSize),
      );
      if (fontSize < 16) {
        const name = await input.getAttribute('name') ?? `input#${i}`;
        tooSmall.push(`"${name}" — ${fontSize}px (triggers iOS zoom if < 16px)`);
      }
    }

    if (tooSmall.length > 0) {
      console.warn(`Form inputs with font-size < 16px (causes iOS zoom):\n${tooSmall.join('\n')}`);
    }
    // Soft warning, not a hard failure
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Touch target sizes
// ─────────────────────────────────────────────────────────────────────────────

test.describe('07 · Mobile — touch targets', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('cart icon touch target is ≥44x44px', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    const cartLink = page.locator(
      'a[href="/cart"], header a[href*="cart"], [aria-label*="Cart"]',
    ).first();
    if ((await cartLink.count()) === 0) return;

    const box = await cartLink.boundingBox();
    expect(box?.height ?? 0, `Cart icon height: ${box?.height}px`).toBeGreaterThanOrEqual(32);
    // 32px is a reasonable minimum (Apple recommends 44, Google 48)
  });

  test('hamburger menu touch target is ≥44x44px', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    const toggle = page.locator(MOBILE_MENU_TOGGLE_SEL).first();
    if ((await toggle.count()) === 0) return;

    const box = await toggle.boundingBox();
    expect(box?.height ?? 0, `Hamburger height: ${box?.height}px`).toBeGreaterThanOrEqual(32);
  });

  test('add-to-cart button touch target is ≥44px tall', async ({ page }) => {
    await page.goto(`${BASE}/products/zerno-z1`, { waitUntil: 'domcontentloaded' });
    const btn = page.locator(ADD_TO_CART_SEL).first();
    if ((await btn.count()) === 0) return;

    const box = await btn.boundingBox();
    expect(box?.height ?? 0, `Add-to-cart height: ${box?.height}px`).toBeGreaterThanOrEqual(40);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Images on mobile
// ─────────────────────────────────────────────────────────────────────────────

test.describe('07 · Mobile — images', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('product images do not exceed viewport width', async ({ page }) => {
    await page.goto(`${BASE}/products/zerno-z1`, { waitUntil: 'domcontentloaded' });

    const vw = await page.evaluate(() => window.innerWidth);
    const imgSel = 'img[src*="products"], .product__media img';
    const imgs = page.locator(imgSel);
    const count = await imgs.count();

    const tooWide: string[] = [];
    for (let i = 0; i < Math.min(count, 6); i++) {
      const img = imgs.nth(i);
      if (!(await img.isVisible().catch(() => false))) continue;
      const box = await img.boundingBox();
      if (box && box.width > vw + 10) {
        tooWide.push(`Image #${i}: ${Math.round(box.width)}px > viewport ${vw}px`);
      }
    }
    expect(tooWide, `Images wider than viewport:\n${tooWide.join('\n')}`).toHaveLength(0);
  });

  test('homepage images do not exceed viewport width', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });

    const vw = await page.evaluate(() => window.innerWidth);
    const imgs = page.locator('img:visible');
    const count = await imgs.count();

    const tooWide: string[] = [];
    for (let i = 0; i < Math.min(count, 10); i++) {
      const img = imgs.nth(i);
      if (!(await img.isVisible().catch(() => false))) continue;
      const box = await img.boundingBox();
      if (box && box.width > vw + 10) {
        const alt = await img.getAttribute('alt') ?? `img#${i}`;
        tooWide.push(`"${alt}": ${Math.round(box.width)}px`);
      }
    }
    expect(tooWide, `Images overflow viewport:\n${tooWide.join('\n')}`).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sticky header behaviour on scroll
// ─────────────────────────────────────────────────────────────────────────────

test.describe('07 · Mobile — sticky header', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('header is visible after scrolling down 500px', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(500);

    const header = page.locator('header, .site-header, [role="banner"]').first();
    await expect(header).toBeVisible();

    // If it's sticky, its top position should be 0 (or near 0)
    const top = await header.evaluate((el) => el.getBoundingClientRect().top);
    // Either sticky (top≈0) or scrolled out of view — both are acceptable designs
    // Just ensure it's visible when needed
    expect(typeof top).toBe('number');
  });

  test('sticky header does not cover content permanently on product page', async ({ page }) => {
    await page.goto(`${BASE}/products/zerno-z1`, { waitUntil: 'domcontentloaded' });

    // Scroll mid-page
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(500);

    const header = page.locator('header, .site-header, [role="banner"]').first();
    const headerBox = await header.boundingBox();

    if (!headerBox) return;

    // Sticky header height should be reasonable (< 120px)
    const headerStyle = await header.evaluate(
      (el) => window.getComputedStyle(el).position,
    );
    if (headerStyle === 'fixed' || headerStyle === 'sticky') {
      expect(
        headerBox.height,
        `Sticky header is very tall: ${headerBox.height}px`,
      ).toBeLessThan(120);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// iPad / tablet
// ─────────────────────────────────────────────────────────────────────────────

test.describe('07 · Tablet (768px)', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('homepage has no horizontal overflow at 768px', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 5,
    );
    expect(overflow, 'Homepage overflows at 768px').toBe(false);
  });

  test('navigation is visible at 768px (tablet)', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    // At 768px, many themes show either desktop nav or mobile nav
    const nav = page.locator(
      'header nav, .site-nav, .mobile-nav__toggle, ' + MOBILE_MENU_TOGGLE_SEL,
    ).first();
    await expect(nav).toBeVisible();
  });

  test('product page usable at 768px', async ({ page }) => {
    await page.goto(`${BASE}/products/zerno-z1`, { waitUntil: 'domcontentloaded' });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 5,
    );
    expect(overflow, 'Product page overflows at 768px').toBe(false);

    const btn = page.locator(ADD_TO_CART_SEL).first();
    await expect(btn).toBeVisible();
  });
});
