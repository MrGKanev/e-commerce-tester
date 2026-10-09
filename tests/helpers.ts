import { measureInteraction } from './web-vitals';
import { readSiteSettings } from '../config/site-settings';
import { pageInventory } from './inventory';
const settings = readSiteSettings();
import { Page, Locator, expect, errors } from '@playwright/test';

export const BASE = (process.env.STORE_URL ?? 'https://zerno.co').replace(/\/$/, '');

export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

export const LOCALE = settings.locale;
export const TIMEZONE_ID = settings.timezoneId;

/** Search term used by search-related tests — configurable via .env */
export const SEARCH_TERM = process.env.SEARCH_TERM ?? 'zerno';

/** Known products for targeted tests — configurable via .env */
const _handle1 = process.env.PRODUCT_HANDLE ?? 'zerno-z1';
const _handle2 = process.env.PRODUCT_HANDLE_2 ?? 'zerno-z2';

export const KNOWN_PRODUCTS = [
  { handle: _handle1, url: `${BASE}/products/${encodeURIComponent(_handle1)}` },
  { handle: _handle2, url: `${BASE}/products/${encodeURIComponent(_handle2)}` },
];
/** Backwards-compat shorthand */
export const KNOWN_PRODUCT = KNOWN_PRODUCTS[0].url;

/** Shopify add-to-cart button selectors — covers Dawn, Debut, Empire, and custom themes */
export const ADD_TO_CART_SEL =
  settings.selectors.addToCart ||
  [
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

export const PRODUCT_TITLE_SEL =
  settings.selectors.productTitle ||
  [
    '.product__title h1',
    '.product__title',
    'h1.product-single__title',
    'h1.title',
    '.product-title h1',
    'h1',
  ].join(', ');

export const PRICE_SEL =
  settings.selectors.price ||
  [
    '.price__regular .price-item',
    '.price__regular',
    '.product__price',
    '[data-product-price]',
    '.price:not(.price--unavailable)',
    '.price-item--regular',
    'span.money',
  ].join(', ');

export const CART_COUNT_SEL =
  settings.selectors.cartCount ||
  [
    '#cart-icon-bubble',
    '[data-cart-count]',
    '.cart-count',
    '#CartCount',
    '.header__cart-count',
    '.cart__count',
  ].join(', ');

export const CART_ITEMS_SEL =
  settings.selectors.cartItems ||
  [
    '.cart__item',
    '.cart-item',
    'tr.cart__row',
    '[data-cart-item]',
    '.cart__items > *',
    '.cart-items > *',
  ].join(', ');

export const MOBILE_MENU_TOGGLE_SEL =
  settings.selectors.mobileMenuToggle ||
  [
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

/** Cookie consent accept button selectors — covers common Shopify/EU consent tools */
export const COOKIE_CONSENT_SEL =
  settings.selectors.consentAccept ||
  [
    '#onetrust-accept-btn-handler',
    '#accept-cookies',
    '#cookie-accept',
    'button[id*="accept"][id*="cookie"]',
    'button[id*="cookie"][id*="accept"]',
    'button[class*="cookie"][class*="accept"]',
    'button[class*="accept"][class*="cookie"]',
    '[data-cookiebanner] button',
    '[data-cookie-consent] button',
    '.cookie-banner button',
    '.cookie-consent button',
    '.cc-btn.cc-allow',
    'button:has-text("Accept all")',
    'button:has-text("Accept")',
    'button:has-text("Приемам всички")',
    'button:has-text("Приемам")',
    'button:has-text("Приемане")',
    'button:has-text("Съгласен съм")',
    'button:has-text("Разрешаване на всички")',
  ].join(', ');

/** Optional feature discovery catches only absence, never page/action failures. */
export async function optionalVisible(locator: Locator, timeout = 1500): Promise<boolean> {
  try {
    await locator.waitFor({ state: 'visible', timeout });
    return true;
  } catch (error) {
    if (error instanceof errors.TimeoutError && !locator.page().isClosed()) return false;
    throw error;
  }
}

/** Returning sessions probe immediately; only setup explicitly waits for a new banner. */
export async function dismissCookieConsent(page: Page, appearanceTimeout = 0): Promise<void> {
  const button = page.locator(COOKIE_CONSENT_SEL).filter({ visible: true }).first();
  if (appearanceTimeout > 0) {
    if (!(await optionalVisible(button, appearanceTimeout))) return;
  } else if (!(await button.isVisible())) return;
  await button.click();
  await expect(button, 'Consent action did not dismiss the banner').toBeHidden();
}

export async function waitForContent(page: Page): Promise<void> {
  const main = page
    .locator(settings.selectors.main || 'main, #main-content, [role="main"]')
    .first();
  const content = (await main.count()) > 0 ? main : page.locator('body');
  await expect(content).toBeVisible();
  await expect
    .poll(
      () =>
        content.evaluate(element => {
          if ((element as HTMLElement).innerText?.trim()) return true;
          return Array.from(element.querySelectorAll('img, canvas, svg, video')).some(media => {
            const rect = media.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        }),
      { message: 'Main content has neither visible text nor media' },
    )
    .toBe(true);
}

/** Wait only for images in the viewport; off-screen lazy images need an explicit scroll. */
export async function waitForImages(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.locator('img:visible').evaluateAll(images =>
          images
            .filter(image => {
              const rect = image.getBoundingClientRect();
              return (
                rect.bottom > 0 &&
                rect.right > 0 &&
                rect.top < innerHeight &&
                rect.left < innerWidth
              );
            })
            .every(image => (image as HTMLImageElement).complete),
        ),
      { message: 'Visible images did not finish loading' },
    )
    .toBe(true);
}

/** Image audits explicitly trigger lazy loads and wait for each inspected image. */
export async function loadPageImages(page: Page): Promise<void> {
  const images = page.locator('img:visible');
  for (let index = 0; index < (await images.count()); index++) {
    const image = images.nth(index);
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() => image.evaluate((element: HTMLImageElement) => element.complete), {
        message: `Image ${index + 1} did not finish loading`,
      })
      .toBe(true);
  }
}

export async function waitForVisualReady(page: Page): Promise<void> {
  await waitForContent(page);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await waitForImages(page);
}

/** Pacing lives in fixtures/pacing.ts; content readiness is independent of traffic. */
export async function goto(page: Page, path = '/'): Promise<void> {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await waitForContent(page);
  await dismissCookieConsent(page);
}

/** Register response before the action to catch even immediate AJAX/form responses. */
export async function cartAction(page: Page, action: () => Promise<unknown>): Promise<void> {
  await measureInteraction(page, 'cart mutation', async () => {
    const [response] = await Promise.all([
      page.waitForResponse(response => {
        const url = new URL(response.url());
        return (
          /\/cart(?:\/(?:add|change|update|clear))?(?:\.js)?\/?$/.test(url.pathname) &&
          (response.request().method() === 'POST' ||
            (response.request().isNavigationRequest() &&
              /\/cart\/(?:add|change|update|clear)/.test(url.pathname)))
        );
      }),
      action(),
    ]);
    expect(response.status(), 'Cart operation failed').toBeLessThan(400);
  });
}

export async function clearCart(page: Page): Promise<void> {
  const response = await page.context().request.post(`${BASE}/cart/clear.js`);
  expect(response.ok(), 'Could not clear cart').toBe(true);
}

export async function addProductToCart(page: Page, url = KNOWN_PRODUCT): Promise<boolean> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const button = page.locator(ADD_TO_CART_SEL).first();
  await expect(button, 'Product add-to-cart control is missing').toBeVisible();
  await expect(button, 'Configured product cannot be added to cart').toBeEnabled();
  await cartAction(page, () => button.click());
  await page.goto(`${BASE}/cart`, { waitUntil: 'domcontentloaded' });
  await expect(
    page.locator(CART_ITEMS_SEL).first(),
    'Cart is empty after adding product',
  ).toBeVisible();
  return true;
}

/** Returns true if the product page has an enabled add-to-cart button */
export async function isProductAvailable(page: Page): Promise<boolean> {
  const btn = page.locator(ADD_TO_CART_SEL).first();
  if ((await btn.count()) === 0) return false;
  return !(await btn.isDisabled());
}

/** Returns unique internal pathnames from a CSS selector scope */
export async function internalLinks(page: Page, scope: string): Promise<string[]> {
  // Use :is(...) so comma-separated scopes all get the a[href] descendant combinator applied
  const selector = scope.includes(',') ? `:is(${scope}) a[href]` : `${scope} a[href]`;
  return page.$$eval(
    selector,
    (anchors, base) => {
      const paths = anchors
        .map(a => (a as HTMLAnchorElement).getAttribute('href') ?? '')
        .filter(h => h.startsWith('/') || h.startsWith(base as string))
        .map(h => (h.startsWith('http') ? new URL(h).pathname : h))
        .filter(
          h =>
            !h.startsWith('/cdn') && !h.startsWith('/s/') && !h.startsWith('#') && h.trim() !== '/',
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
  return page.evaluate(sel => {
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
  return page.evaluate(sel => {
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
export async function getFixedElements(
  page: Page,
): Promise<Array<{ tag: string; classes: string; zIndex: string; rect: string }>> {
  return page.evaluate(() => {
    const fixed: Array<{ tag: string; classes: string; zIndex: string; rect: string }> = [];
    document.querySelectorAll('*').forEach(el => {
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
  await loadPageImages(page);
  return page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    return imgs
      .filter(img => img.getClientRects().length > 0 && (!img.complete || img.naturalWidth === 0))
      .map(img => img.src || img.getAttribute('data-src') || '(no src)')
      .filter(src => !src.startsWith('data:'));
  });
}

/**
 * Reads handles from the shared inventory without further catalogue requests.
 * Discovery, if enabled, is performed once during global setup.
 */
export async function fetchProductHandles(
  limit = 10,
): Promise<Array<{ handle: string; url: string }>> {
  return pageInventory()
    .filter(page => page.type === 'product' && page.handle)
    .slice(0, limit)
    .map(page => ({ handle: page.handle!, url: page.url }));
}

/** Flush a paint after DOM/scroll changes before synchronous geometry inspection. */
export async function waitForPaint(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
