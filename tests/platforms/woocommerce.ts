import { expect, type Page, type Locator, type TestInfo, type APIResponse } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { readSiteSettings } from '../../config/site-settings';
import { publicUrl, storeApiUrl } from '../../scripts/platform-config';
import { CommerceUnverified, parseMoney, schemaPrice } from '../../scripts/storefront-model';
import {
  prices,
  sellability,
  cartFacts,
  amount,
  type WooProduct,
  type WooVariation,
  type WooCart,
} from '../../scripts/woocommerce-model';
import { assertCheckoutField } from '../storefront-assertions';
import { assertNotLimited, isLimited } from '../pacing';
import {
  waitForContent,
  dismissCookieConsent,
  BASE,
  CART_URL,
  CHECKOUT_URL,
  ADD_TO_CART_SEL,
  CART_ITEMS_SEL,
} from '../helpers';

const settings = readSiteSettings();
const sessions = new WeakMap<Page, WooSession>();
export class WooSession {
  private token = '';
  private nonce = '';
  private frontendVersion = 0;
  constructor(readonly page: Page) {
    if (settings.platform !== 'woocommerce')
      throw new Error('WooCommerce adapter cannot run against Shopify');
    page.on('request', request => {
      if (request.url().startsWith(settings.commerce.apiRoot + '/cart')) {
        const headers = request.headers();
        if (headers['cart-token'] && headers['cart-token'] !== this.token) {
          this.token = headers['cart-token'];
          this.frontendVersion++;
        }
        if (headers.nonce) this.nonce = headers.nonce;
      }
    });
  }
  private async decode<T>(response: APIResponse, cart = false): Promise<T> {
    assertNotLimited();
    if ([401, 403, 404].includes(response.status()))
      throw new CommerceUnverified(
        `Public WooCommerce Store API unavailable: HTTP ${response.status()}`,
      );
    expect(response.ok(), `WooCommerce Store API returned HTTP ${response.status()}`).toBe(true);
    if (cart && response.headers()['cart-token']) this.token = response.headers()['cart-token'];
    if (cart && response.headers().nonce) this.nonce = response.headers().nonce;
    return (await response.json()) as T;
  }
  async product(id: number): Promise<WooProduct> {
    const product = await this.decode<WooProduct>(
      await this.page.context().request.get(storeApiUrl(settings, `products/${id}`)),
    );
    if (product.id !== id || !product.permalink)
      throw new Error('Store API returned a different product ID');
    publicUrl(product.permalink, BASE, 'WooCommerce permalink');
    return product;
  }
  async cart(): Promise<WooCart> {
    const version = this.frontendVersion;
    const headers: Record<string, string> = this.token ? { 'Cart-Token': this.token } : {};
    const response = await this.page
      .context()
      .request.get(storeApiUrl(settings, 'cart'), { headers });
    if (version !== this.frontendVersion)
      throw new CommerceUnverified(
        'Frontend cart session changed while reading it; no cart mutation attempted',
      );
    return this.decode<WooCart>(response, true);
  }
  async clearCart() {
    const cart = await this.cart();
    if (!cart.items.length) return;
    // The token was obtained from this page's frontend or its cookie-bound cart.
    const headers: Record<string, string> | null = this.token
      ? { 'Cart-Token': this.token }
      : this.nonce
        ? { Nonce: this.nonce }
        : null;
    if (!headers)
      throw new CommerceUnverified('Cart cleanup requires the same-session Cart-Token or Nonce');
    const cleared = await this.decode<WooCart | unknown[]>(
      await this.page.context().request.delete(storeApiUrl(settings, 'cart/items'), { headers }),
      true,
    );
    expect(
      Array.isArray(cleared) ? cleared : cleared.items,
      'WooCommerce cart items did not clear',
    ).toEqual([]);
    expect((await this.cart()).items, 'WooCommerce session cart remained non-empty').toEqual([]);
  }
}
export function wooSession(page: Page): WooSession {
  if (!sessions.has(page)) sessions.set(page, new WooSession(page));
  return sessions.get(page)!;
}
async function root(page: Page): Promise<Locator> {
  const scoped = page
    .locator(
      settings.selectors.commerceRoot ||
        'main .product, main .wp-block-woocommerce-product, main [data-woo-product]',
    )
    .filter({ visible: true });
  if ((await scoped.count()) === 1) return scoped;
  const main = page.locator('main, [role="main"]').filter({ visible: true });
  if ((await main.count()) !== 1)
    throw new CommerceUnverified('Configure a unique WooCommerce commerceRoot selector');
  return main;
}
async function parentId(scope: Locator): Promise<number> {
  const ids = await scope.evaluate(node => {
    const result: number[] = [];
    for (const element of node.querySelectorAll(
      '[data-product_id], [name="add-to-cart"], [data-wp-context]',
    )) {
      const direct = element.getAttribute('data-product_id') || element.getAttribute('value');
      if (direct && /^\d+$/.test(direct)) result.push(Number(direct));
      const context = element.getAttribute('data-wp-context');
      if (context) {
        try {
          const data = JSON.parse(context);
          if (data.productId) result.push(Number(data.productId));
        } catch {
          /* Not a product context. */
        }
      }
    }
    return [...new Set(result.filter(Number.isSafeInteger).filter(id => id > 0))];
  });
  if (ids.length !== 1)
    throw new CommerceUnverified(
      'Frontend does not expose one product ID; configure product URLs with discoverable forms',
    );
  return ids[0];
}
async function variations(scope: Locator): Promise<WooVariation[]> {
  const form = scope.locator('form.variations_form');
  if (!(await form.count())) return [];
  const embedded = await form.getAttribute('data-product_variations');
  if (!embedded || embedded === 'false') {
    // Classic AJAX variation lookup will resolve a live ID after choosing options.
    const selects = form.locator('select[name^="attribute_"]');
    for (const select of await selects.all()) {
      const option = await select
        .locator('option')
        .evaluateAll(options =>
          options
            .find(
              option =>
                (option as HTMLOptionElement).value && !(option as HTMLOptionElement).disabled,
            )
            ?.getAttribute('value'),
        );
      if (!option)
        throw new CommerceUnverified('No selectable WooCommerce variation option exposed');
      await select.selectOption(option);
    }
    const id = form.locator('input[name="variation_id"]');
    try {
      await expect
        .poll(async () => Number(await id.inputValue()), {
          message: 'WooCommerce AJAX picker did not resolve a variation ID',
        })
        .toBeGreaterThan(0);
    } catch (error) {
      throw new CommerceUnverified(
        `No verified AJAX variation combination resolved: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const attributes: Record<string, string> = {};
    for (const select of await selects.all())
      attributes[(await select.getAttribute('name'))!] = await select.inputValue();
    return [
      {
        variation_id: Number(await id.inputValue()),
        attributes,
        is_purchasable: true,
        is_in_stock: true,
      },
    ];
  }
  const data = JSON.parse(embedded);
  if (!Array.isArray(data)) throw new Error('Invalid frontend variation data');
  return data;
}
async function selectVariation(scope: Locator, variation: WooVariation): Promise<boolean> {
  const form = scope.locator('form.variations_form');
  for (const [name, target] of Object.entries(variation.attributes)) {
    const select = form.locator('select').filter({ visible: true });
    let field: Locator | undefined;
    for (const candidate of await select.all())
      if ((await candidate.getAttribute('name')) === name) field = candidate;
    if (!field) throw new CommerceUnverified('Unsupported WooCommerce variation picker');
    const options = await field.locator('option').evaluateAll(options =>
      options.map(option => ({
        value: (option as HTMLOptionElement).value,
        disabled: (option as HTMLOptionElement).disabled,
      })),
    );
    const chosen = target || options.find(option => option.value && !option.disabled)?.value;
    const option = options.find(option => option.value === chosen);
    if (!option) throw new CommerceUnverified('Variation attribute is not represented by the UI');
    if (option.disabled) return false;
    await field.selectOption(option.value);
  }
  const selected = form.locator('input[name="variation_id"]');
  await expect
    .poll(async () => Number(await selected.inputValue()), {
      message: 'Wrong variation resolved after UI selection',
    })
    .toBe(variation.variation_id);
  return true;
}
async function displayedMoney(
  scope: Locator,
  selectors: string[],
  data: ReturnType<typeof prices>,
) {
  for (const selector of selectors) {
    const values = scope.locator(selector).filter({ visible: true });
    const texts: string[] = [];
    for (const element of await values.all()) {
      if (!(await element.evaluate(node => Boolean(node.closest('del, s')))))
        texts.push(await element.innerText());
    }
    if (!texts.length) continue;
    const parsed = [...new Set(texts)].map(text =>
      parseMoney(text, data.currency, settings.locale, {
        precision: data.precision,
        decimalSeparator: data.decimalSeparator,
      }),
    );
    if (new Set(parsed.map(item => `${item.amount}:${item.currency}`)).size !== 1)
      throw new CommerceUnverified(
        'WooCommerce price is ambiguous; configure the active price selector',
      );
    if (parsed[0].currencyEvidence === 'session-only')
      throw new CommerceUnverified('WooCommerce UI price does not identify its currency');
    return parsed[0];
  }
  throw new CommerceUnverified('No supported visible WooCommerce price; configure selectors.price');
}
async function cartTaxMode(page: Page): Promise<'auto' | 'including' | 'excluding'> {
  if (settings.commerce.taxDisplay !== 'auto') return settings.commerce.taxDisplay;
  const value = await page.evaluate(() => {
    const windowSettings = window as unknown as {
      wcSettings?: { displayCartPricesIncludingTax?: boolean };
      wc?: { wcSettings?: { getSetting?: (key: string, fallback: unknown) => unknown } };
    };
    return (
      windowSettings.wcSettings?.displayCartPricesIncludingTax ??
      windowSettings.wc?.wcSettings?.getSetting?.('displayCartPricesIncludingTax', null)
    );
  });
  return value === true ? 'including' : value === false ? 'excluding' : 'auto';
}
async function openProduct(page: Page, url: string) {
  publicUrl(url, BASE, 'WooCommerce product URL');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitForContent(page);
  await dismissCookieConsent(page);
  return root(page);
}
async function stable(session: WooSession, before: WooProduct) {
  const after = await session.product(before.id);
  if (
    JSON.stringify(prices(after)) !== JSON.stringify(prices(before)) ||
    after.is_in_stock !== before.is_in_stock ||
    after.is_purchasable !== before.is_purchasable
  )
    throw new CommerceUnverified('WooCommerce price or sellability changed during the check');
}
export type WooKind = 'price' | 'schema' | 'available' | 'unavailable' | 'checkout';
export async function auditWooCommerce(page: Page, info: TestInfo, url: string, kind: WooKind) {
  const session = wooSession(page),
    observations: Record<string, unknown>[] = [];
  let failure: unknown,
    mutated = false;
  try {
    let scope = await openProduct(page, url);
    const parent = await session.product(await parentId(scope));
    const isVariable = (await scope.locator('form.variations_form').count()) > 0;
    if (parent.type && !['simple', 'variable', 'variation'].includes(parent.type))
      throw new CommerceUnverified(`WooCommerce ${parent.type} products need a dedicated adapter`);
    if (parent.has_options && !isVariable)
      throw new CommerceUnverified(
        'WooCommerce block/custom option picker requires a variation-ID adapter',
      );
    const all = isVariable ? await variations(scope) : [];
    const available = all.filter(
      item => item.is_purchasable && (item.is_in_stock || item.backorders_allowed),
    );
    const unavailable = all.filter(
      item => !item.is_purchasable || (!item.is_in_stock && !item.backorders_allowed),
    );
    const sample =
      kind === 'unavailable'
        ? unavailable.slice(0, 1)
        : available.length
          ? [
              available[0],
              ...available
                .filter(item => item.display_price !== available[0].display_price)
                .slice(0, kind === 'price' || kind === 'schema' ? 1 : 0),
            ]
          : [];
    if (isVariable && !sample.length)
      throw new CommerceUnverified('No suitable variation exposed for this WooCommerce scenario');
    for (const [index, variation] of (isVariable ? sample : [undefined]).entries()) {
      if (index) scope = await openProduct(page, url);
      if (variation && !(await selectVariation(scope, variation))) {
        if (kind !== 'unavailable')
          throw new Error('Purchasable WooCommerce variation is disabled in its UI');
        observations.push({
          productId: parent.id,
          variationId: variation.variation_id,
          state: 'disabled-option',
        });
        continue;
      }
      const product = variation ? await session.product(variation.variation_id) : parent;
      const state = sellability(product, variation);
      observations.push({
        productId: parent.id,
        selectedId: product.id,
        state,
        attributes: variation?.attributes || {},
      });
      const button = scope.locator(ADD_TO_CART_SEL).filter({ visible: true }).first();
      if (kind === 'unavailable') {
        if (state.available)
          throw new CommerceUnverified(
            'Product is purchasable, including permitted backorders; no unavailable sample',
          );
        if (await button.count())
          await expect(button, 'Unavailable WooCommerce product allows purchase').toBeDisabled();
        await expect(
          scope
            .locator(
              settings.selectors.soldOut ||
                '.stock.out-of-stock, .woocommerce-variation-availability, [data-stock-status]',
            )
            .filter({ visible: true })
            .first(),
          'No unavailable indication',
        ).toBeVisible();
        await stable(session, product);
        continue;
      }
      if (!state.available)
        throw new CommerceUnverified('No purchasable WooCommerce test product available');
      const price = prices(product);
      if (kind === 'schema') {
        const schemas = (
          await page.locator('script[type="application/ld+json"]').allTextContents()
        ).map(text => JSON.parse(text));
        const normalizedVariants = isVariable
          ? all.map(item => ({
              id: item.variation_id,
              sku: item.variation_id === product.id ? product.sku : item.sku,
            }))
          : [{ id: parent.id, price: price.price, sku: parent.sku }];
        const range = parent.prices.price_range;
        const normalized = {
          title: parent.name,
          handle: parent.slug,
          price_min: range
            ? amount(range.min_amount, 'WooCommerce minimum price')
            : isVariable
              ? Number.NaN
              : prices(parent).price,
          price_max: range
            ? amount(range.max_amount, 'WooCommerce maximum price')
            : isVariable
              ? Number.NaN
              : prices(parent).price,
          variants: normalizedVariants,
        };
        observations.push({
          jsonLd: schemaPrice(
            schemas,
            normalized,
            { id: product.id, price: price.price, sku: product.sku },
            price.currency,
            page.url(),
            {
              precision: price.precision,
              platform: 'woocommerce',
              productUrls: [parent.permalink, product.permalink],
            },
          ),
        });
        await stable(session, product);
        continue;
      }
      await expect(button, 'WooCommerce purchase control missing').toBeVisible();
      await expect(button, 'Purchasable WooCommerce product is disabled').toBeEnabled();
      if (kind === 'price') {
        const selectors = settings.selectors.price
          ? [settings.selectors.price]
          : [
              '.single_variation .price ins .amount',
              '.single_variation .price .amount',
              '.summary > .price ins .amount',
              '.summary > .price .amount',
              '.wp-block-woocommerce-product-price .amount',
              '[data-woo-price]',
            ];
        await expect
          .poll(
            async () => {
              const value = await displayedMoney(scope, selectors, price);
              return { amount: value.amount, currency: value.currency };
            },
            { message: 'WooCommerce selected price did not update' },
          )
          .toEqual({ amount: price.price, currency: price.currency });
        observations.push({
          publicPrice: price,
          uiPrice: await displayedMoney(scope, selectors, price),
        });
      }
      await session.clearCart();
      const quantity = scope
        .locator('input.qty, input[name="quantity"]')
        .filter({ visible: true })
        .first();
      if (await quantity.count()) {
        const min = Number((await quantity.getAttribute('min')) || 1);
        if (min > 1)
          throw new CommerceUnverified('WooCommerce minimum quantity requires a separate scenario');
        await quantity.fill('1');
      }
      mutated = true;
      await button.click();
      // The UI may use a classic form or Store API request; inspect the same session cart.
      await expect
        .poll(
          async () =>
            (await session.cart()).items.map(item => ({ id: item.id, quantity: item.quantity })),
          { message: 'WooCommerce UI did not add the exact product/variation' },
        )
        .toEqual([{ id: product.id, quantity: 1 }]);
      await stable(session, product);
      const cart = await session.cart();
      if (kind === 'price') {
        await page.goto(CART_URL, { waitUntil: 'domcontentloaded' });
        await waitForContent(page);
        const facts = cartFacts(await session.cart(), product, await cartTaxMode(page));
        observations.push({ cart: facts });
        if (facts.displaySubtotal === null)
          throw new CommerceUnverified(
            'Cart tax display is unknown; configure commerce.taxDisplay',
          );
        const rows = page.locator(CART_ITEMS_SEL).filter({ visible: true });
        if ((await rows.count()) !== 1)
          throw new CommerceUnverified('Configure a unique WooCommerce cartItems selector');
        const productName = await page.evaluate(name => {
          const document = new DOMParser().parseFromString(name, 'text/html');
          return document.body.textContent || name;
        }, parent.name);
        await expect(rows, 'WooCommerce cart UI identifies a different product').toContainText(
          productName,
        );
        const unit = await displayedMoney(
          rows,
          settings.selectors.cartUnitPrice
            ? [settings.selectors.cartUnitPrice]
            : [
                '.product-price .amount',
                '.wc-block-cart-item__prices .wc-block-components-product-price__value',
                '[data-woo-cart-price]',
              ],
          price,
        );
        const line = await displayedMoney(
          rows,
          settings.selectors.cartLinePrice
            ? [settings.selectors.cartLinePrice]
            : [
                '.product-subtotal .amount',
                '.wc-block-cart-item__total-price-and-sale-badge-wrapper .wc-block-components-product-price__value',
                '[data-woo-cart-subtotal]',
              ],
          price,
        );
        expect(
          { amount: unit.amount, currency: unit.currency },
          'WooCommerce cart unit price mismatch',
        ).toEqual({ amount: facts.displaySubtotal, currency: price.currency });
        expect(
          { amount: line.amount, currency: line.currency },
          'WooCommerce cart subtotal display mismatch',
        ).toEqual({ amount: facts.displaySubtotal, currency: price.currency });
        observations.push({ cartUI: { unit, line } });
      } else
        observations.push({
          cart: { productId: cart.items[0].id, quantity: cart.items[0].quantity },
        });
      if (kind === 'checkout') {
        await page.goto(CHECKOUT_URL, { waitUntil: 'domcontentloaded' });
        await waitForContent(page);
        await assertCheckoutField(page, info, 'contact');
        observations.push({ checkout: 'contact-form-ready; no order submitted' });
      }
    }
  } catch (error) {
    failure = error;
  } finally {
    if (mutated && !isLimited()) {
      try {
        await session.clearCart();
      } catch (error) {
        observations.push({
          cleanup: 'failed',
          reason: error instanceof Error ? error.message : String(error),
        });
        failure ||= error;
      }
    }
    const report = {
      schemaVersion: 1,
      platform: 'woocommerce',
      source: 'public-storefront-session',
      kind,
      productHandle: url,
      project: info.project.name,
      scenario: info.title,
      status: failure instanceof CommerceUnverified ? 'unverified' : failure ? 'failed' : 'passed',
      reason: failure instanceof Error ? failure.message : null,
      observations,
    };
    const file = info.outputPath('commerce-consistency.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    await info.attach('commerce-consistency.json', { path: file, contentType: 'application/json' });
  }
  if (failure) throw failure;
}
export async function addWooProductToCart(page: Page, url: string) {
  const scope = await openProduct(page, url),
    session = wooSession(page);
  await session.clearCart();
  await scope.locator(ADD_TO_CART_SEL).filter({ visible: true }).first().click();
  await expect.poll(async () => (await session.cart()).items.length).toBeGreaterThan(0);
}

/** WooCommerce primitives retain their own session, variation and tax semantics. */
export const wooCommerce = {
  root,
  parentId,
  variations,
  selectVariation,
  displayedMoney,
  cartTaxMode,
  stable,
};
