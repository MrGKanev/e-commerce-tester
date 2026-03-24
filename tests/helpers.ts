import { Page, expect } from '@playwright/test';

export const BASE = 'https://zerno.co';

/** Known products for targeted tests */
export const KNOWN_PRODUCTS = [
  { handle: 'zerno-z1', url: `${BASE}/products/zerno-z1` },
  { handle: 'zerno-z2', url: `${BASE}/products/zerno-z2` },
];
/** Backwards-compat shorthand */
export const KNOWN_PRODUCT = KNOWN_PRODUCTS[0].url;

/** Shopify add-to-cart button selectors — covers Dawn, Debut, Empire, and custom themes */
export const ADD_TO_CART_SEL = [
  'form[action*="/cart/add"] button[type="submit"]',
  'button[name="add"]',
  '#AddToCart',
  '#product-submit-button',
  '[data-add-to-cart]',
  '.product-form__submit',
  'button:has-text("Add to cart")',
  'button:has-text("Добавяне в количката")',
  'button:has-text("Добавяне")',
  'button:has-text("В количката")',
  'button:has-text("Купи")',
].join(', ');

export const PRODUCT_TITLE_SEL = [
  '.product__title h1',
  '.product__title',
  'h1.product-single__title',
  'h1.title',
  '.product-title h1',
  'h1',
].join(', ');

export const PRICE_SEL = [
  '.price__regular .price-item',
  '.price__regular',
  '.product__price',
  '[data-product-price]',
  '.price:not(.price--unavailable)',
  '.price-item--regular',
  'span.money',
].join(', ');

export const CART_COUNT_SEL = [
  '#cart-icon-bubble',
  '[data-cart-count]',
  '.cart-count',
  '#CartCount',
  '.header__cart-count',
  '.cart__count',
].join(', ');

export const CART_ITEMS_SEL = [
  '.cart__item',
  '.cart-item',
  'tr.cart__row',
  '[data-cart-item]',
  '.cart__items > *',
  '.cart-items > *',
].join(', ');

export const MOBILE_MENU_TOGGLE_SEL = [
  'summary[aria-controls="menu-drawer"]',
  'button[aria-controls="mobile-menu"]',
  '.header__icon--menu',
  '.mobile-nav__toggle',
  '.hamburger',
  '[data-nav-toggle]',
  'button[aria-label*="Menu"]',
  'button[aria-label*="menu"]',
  'button[aria-label*="меню"]',
  'button[aria-label*="Меню"]',
  'button[aria-label*="навигация"]',
].join(', ');

export const MOBILE_MENU_OPEN_SEL = [
  '#menu-drawer[open]',
  '#mobile-menu[open]',
  '.mobile-nav--open',
  '.mobile-nav.is-open',
  '.drawer--open',
  'nav.mobile-nav',
  '[aria-expanded="true"]',
].join(', ');

/** Navigate and wait for DOM */
export async function goto(page: Page, path = '/'): Promise<void> {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
}

/** Returns unique internal pathnames from a CSS selector scope */
export async function internalLinks(page: Page, scope: string): Promise<string[]> {
  return page.$$eval(
    `${scope} a[href]`,
    (anchors, base) => {
      const paths = anchors
        .map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? '')
        .filter((h) => h.startsWith('/') || h.startsWith(base as string))
        .map((h) => (h.startsWith('http') ? new URL(h).pathname : h))
        .filter(
          (h) =>
            !h.startsWith('/cdn') &&
            !h.startsWith('/s/') &&
            !h.startsWith('#') &&
            h.trim() !== '/',
        );
      return [...new Set(paths)] as string[];
    },
    BASE,
  );
}

/**
 * Checks if an element is truly interactable — not covered by another element.
 * Returns the tag/class of whatever element sits on top at the element's center.
 */
export async function getTopElementAt(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return 'element not found';
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const top = document.elementFromPoint(cx, cy);
    if (!top) return 'nothing at coordinates';
    const classes = top.className ? `.${String(top.className).split(' ').join('.')}` : '';
    return `${top.tagName.toLowerCase()}${classes}`;
  }, selector);
}

/**
 * Returns the computed font-size (px) of an element.
 */
export async function getFontSize(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return 0;
    return parseFloat(window.getComputedStyle(el).fontSize);
  }, selector);
}

/**
 * Checks whether the page has horizontal overflow (scrollbar).
 */
export async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 5);
}

/**
 * Returns all fixed/sticky positioned elements (potential overlay culprits).
 */
export async function getFixedElements(page: Page): Promise<Array<{ tag: string; classes: string; zIndex: string; rect: string }>> {
  return page.evaluate(() => {
    const fixed: Array<{ tag: string; classes: string; zIndex: string; rect: string }> = [];
    document.querySelectorAll('*').forEach((el) => {
      const style = window.getComputedStyle(el);
      if (style.position === 'fixed' || style.position === 'sticky') {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          fixed.push({
            tag: el.tagName.toLowerCase(),
            classes: el.className.toString().slice(0, 80),
            zIndex: style.zIndex,
            rect: `${Math.round(rect.width)}x${Math.round(rect.height)} at (${Math.round(rect.left)},${Math.round(rect.top)})`,
          });
        }
      }
    });
    return fixed;
  });
}

/** Returns the pixel height of an element — useful for touch target checks */
export async function elementHeight(page: Page, selector: string): Promise<number> {
  const el = page.locator(selector).first();
  const box = await el.boundingBox();
  return box?.height ?? 0;
}

/** Returns the pixel width of an element */
export async function elementWidth(page: Page, selector: string): Promise<number> {
  const el = page.locator(selector).first();
  const box = await el.boundingBox();
  return box?.width ?? 0;
}

/** Check all images on current page — returns array of broken src URLs */
export async function findBrokenImages(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    return imgs
      .filter((img) => !img.complete || img.naturalWidth === 0)
      .map((img) => img.src || img.getAttribute('data-src') || '(no src)')
      .filter((src) => !src.startsWith('data:'));
  });
}

/** Scroll page to element and screenshot it — helper for visual verification */
export async function scrollAndScreenshot(page: Page, selector: string, label: string): Promise<void> {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded().catch(() => null);
  await page.screenshot({ path: `${label}.png`, fullPage: false });
}
