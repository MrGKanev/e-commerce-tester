import { expect, type Page, type Locator } from '@playwright/test';
import { shopifyCommerce as shop } from './commerce-consistency';
import { wooCommerce as woo, wooSession } from './platforms/woocommerce';
import { BASE, ADD_TO_CART_SEL, CART_ITEMS_SEL, waitForContent } from './helpers';
import { readSiteSettings } from '../config/site-settings';
import {
  CommerceUnverified,
  cartPrice,
  type PublicProduct,
  type PublicCart,
} from '../scripts/commerce-model';
import {
  prices,
  sellability,
  cartFacts,
  type WooProduct,
  type WooVariation,
} from '../scripts/woocommerce-model';
import { storefrontRoute } from '../scripts/platform-config';
import type { InventoryPage } from './inventory';
const settings = readSiteSettings();
export type JourneyTarget = {
  url: string;
  title: string;
  productId: string;
  variantId: string;
  options: string[];
  currency: string;
  precision: number;
  unitPrice: number;
  hasVariants: boolean;
};
export type CartObservation = {
  productId: string;
  variantId: string;
  quantity: number;
  currency: string;
  unitPrice: number;
  linePrice: number;
  details: Record<string, unknown>;
};
export interface JourneyAdapter {
  target: JourneyTarget;
  searchUrl: string;
  cartUrl: string;
  select(): Promise<void>;
  add(): Promise<void>;
  cart(quantity: number): Promise<CartObservation>;
  cartUI(facts: CartObservation): Promise<void>;
  stable(): Promise<void>;
  clear(): Promise<void>;
}
async function cartRow(page: Page) {
  const rows = page.locator(CART_ITEMS_SEL).filter({ visible: true });
  if ((await rows.count()) !== 1)
    throw new CommerceUnverified(
      'Cart UI does not expose one readable cart row; configure selectors.cartItems',
    );
  return rows;
}
async function initialQuantity(scope: Locator) {
  const quantity = scope.locator('input[name="quantity"], input.qty').filter({ visible: true });
  if ((await quantity.count()) > 1)
    throw new CommerceUnverified('Product quantity control is ambiguous');
  if ((await quantity.count()) === 1) {
    const min = Number((await quantity.getAttribute('min')) || 1);
    const max = Number((await quantity.getAttribute('max')) || Infinity);
    if (min > 1 || max < 2)
      throw new CommerceUnverified('Product quantity constraints do not support the 1 → 2 journey');
    await quantity.fill('1');
  }
}
export async function planShopify(page: Page, entry: InventoryPage): Promise<JourneyAdapter> {
  const route = await shop.routeRoot(page);
  const handle =
    entry.handle ||
    decodeURIComponent(new URL(entry.url).pathname.split('/').filter(Boolean).at(-1)!);
  const product = await shop.publicJson<PublicProduct>(
    page,
    route + `products/${encodeURIComponent(handle)}.js`,
  );
  shop.validateProduct(product, handle);
  const variant = product.variants.find(
    item =>
      item.available &&
      (!item.quantity_rule ||
        (item.quantity_rule.min <= 1 &&
          item.quantity_rule.increment <= 1 &&
          (!item.quantity_rule.max || item.quantity_rule.max >= 2))),
  );
  if (!variant)
    throw new CommerceUnverified('No available Shopify variant supporting quantity 1 → 2');
  const session = await shop.publicJson<PublicCart>(page, route + 'cart.js');
  if (!/^[A-Z]{3}$/.test(session.currency))
    throw new CommerceUnverified('Shopify session currency unavailable');
  const target: JourneyTarget = {
    url: page.url(),
    title: product.title,
    productId: String(product.id),
    variantId: String(variant.id),
    options: variant.options.filter(option => option !== 'Default Title'),
    currency: session.currency,
    precision: 2,
    unitPrice: variant.price,
    hasVariants:
      product.variants.length > 1 || variant.options.some(option => option !== 'Default Title'),
  };
  const cart = async (quantity: number) => {
    const data = await shop.publicJson<PublicCart>(page, route + 'cart.js');
    expect(data.currency, 'Cart currency changed').toBe(target.currency);
    expect(
      data.items.map(item => ({
        variantId: String(item.variant_id ?? item.id),
        quantity: item.quantity,
      })),
      'Cart product/variant/quantity mismatch',
    ).toEqual([{ variantId: target.variantId, quantity }]);
    const details = cartPrice(data, variant, quantity);
    return {
      productId: target.productId,
      variantId: target.variantId,
      quantity,
      currency: data.currency,
      unitPrice: Number(details.finalPrice),
      linePrice: Number(details.finalLinePrice),
      details,
    };
  };
  return {
    target,
    searchUrl: route + 'search',
    cartUrl: route + 'cart',
    async select() {
      const current = await shop.publicJson<PublicProduct>(
        page,
        route + `products/${encodeURIComponent(handle)}.js`,
      );
      expect(String(current.id), 'Search opened another product').toBe(target.productId);
      const scope = await shop.productRoot(page);
      expect(await shop.selectVariant(scope, product, variant), 'Available variant disabled').toBe(
        true,
      );
      const form = await shop.productForm(scope);
      for (const field of await form.locator('[name="selling_plan"]').all())
        if (await field.inputValue())
          throw new CommerceUnverified('Selling plan requires a dedicated buyer journey');
      await expect
        .poll(async () => (await shop.activePrice(scope, target.currency)).amount, {
          message: 'Selected UI price mismatch',
        })
        .toBe(target.unitPrice);
    },
    async add() {
      const form = await shop.productForm(await shop.productRoot(page));
      await initialQuantity(form);
      const button = form.locator(ADD_TO_CART_SEL).filter({ visible: true }).first();
      await expect(button).toBeEnabled();
      await button.click();
    },
    cart,
    async cartUI(facts) {
      const row = await cartRow(page);
      await expect(row).toContainText(target.title);
      for (const option of target.options) await expect(row).toContainText(option);
      const unit = await shop.readPrice(row, target.currency, [
        settings.selectors.cartUnitPrice ||
          '[data-cart-item-price], .cart-item__final-price, .cart-item__price-wrapper .price',
      ]);
      const line = await shop.readPrice(row, target.currency, [
        settings.selectors.cartLinePrice ||
          '[data-cart-item-total], .cart-item__totals .price, .cart-item__total .money',
      ]);
      expect(
        { unit: unit.amount, line: line.amount },
        'Cart UI amounts differ from public cart',
      ).toEqual({ unit: facts.unitPrice, line: facts.linePrice });
    },
    async stable() {
      await shop.ensureStable(page, route, handle, variant);
    },
    async clear() {
      await shop.clearSession(page, route);
    },
  };
}
export async function planWoo(page: Page, _entry: InventoryPage): Promise<JourneyAdapter> {
  const session = wooSession(page);
  const scope = await woo.root(page);
  const parent = await session.product(await woo.parentId(scope));
  if (parent.type && !['simple', 'variable'].includes(parent.type))
    throw new CommerceUnverified(`Unsupported Woo product type ${parent.type}`);
  const all = await woo.variations(scope);
  const hasVariants = parent.type === 'variable' || Boolean(parent.has_options);
  if (hasVariants && !all.length) throw new CommerceUnverified('No supported Woo variation picker');
  const variation: WooVariation | undefined = all.find(
    item => item.is_purchasable && (item.is_in_stock || item.backorders_allowed),
  );
  if (hasVariants && !variation) throw new CommerceUnverified('No available Woo variation');
  const product: WooProduct = variation ? await session.product(variation.variation_id) : parent;
  if (!sellability(product, variation).available)
    throw new CommerceUnverified('Woo product unavailable');
  const rules = product.add_to_cart;
  if (
    rules &&
    ((rules.minimum || 1) > 1 ||
      (rules.multiple_of || 1) > 1 ||
      (rules.maximum !== undefined && rules.maximum < 2))
  )
    throw new CommerceUnverified('Woo quantity rules do not support 1 → 2');
  const price = prices(product);
  const title = await page.evaluate(
    name => new DOMParser().parseFromString(name, 'text/html').body.textContent || name,
    parent.name,
  );
  const target: JourneyTarget = {
    url: page.url(),
    title,
    productId: String(parent.id),
    variantId: String(product.id),
    options: variation ? Object.values(variation.attributes).filter(Boolean) : [],
    currency: price.currency,
    precision: price.precision,
    unitPrice: price.price,
    hasVariants,
  };
  return {
    target,
    searchUrl: storefrontRoute(settings, BASE, 'search', ''),
    cartUrl: storefrontRoute(settings, BASE, 'cart'),
    async select() {
      const current = await woo.root(page);
      expect(await woo.parentId(current), 'Search opened another Woo product').toBe(parent.id);
      if (variation) {
        expect(await woo.selectVariation(current, variation)).toBe(true);
        target.options = [];
        for (const field of await current
          .locator('form.variations_form select[name^="attribute_"]')
          .all())
          target.options.push((await field.locator('option:checked').innerText()).trim());
      }
      await expect
        .poll(
          async () =>
            (
              await woo.displayedMoney(
                current,
                [
                  settings.selectors.price ||
                    '.woocommerce-variation-price .amount, .summary > .price .amount, [data-woo-price]',
                ],
                price,
              )
            ).amount,
        )
        .toBe(price.price);
    },
    async add() {
      const current = await woo.root(page);
      await initialQuantity(current);
      const button = current.locator(ADD_TO_CART_SEL).filter({ visible: true }).first();
      await expect(button).toBeEnabled();
      await button.click();
    },
    async cart(quantity) {
      const data = await session.cart();
      expect(
        data.items.map(item => ({ id: item.id, quantity: item.quantity })),
        'Woo cart product/variation/quantity mismatch',
      ).toEqual([{ id: product.id, quantity }]);
      const details = cartFacts(data, product, await woo.cartTaxMode(page), quantity);
      if (details.displaySubtotal === null)
        throw new CommerceUnverified('Cart tax display unknown; configure commerce.taxDisplay');
      if (!Number.isSafeInteger(details.displaySubtotal / quantity))
        throw new CommerceUnverified(
          'Tax rounding does not expose an unambiguous per-unit UI amount',
        );
      return {
        productId: target.productId,
        variantId: target.variantId,
        quantity,
        currency: price.currency,
        unitPrice: details.displaySubtotal / quantity,
        linePrice: details.displaySubtotal,
        details,
      };
    },
    async cartUI(facts) {
      const row = await cartRow(page);
      await expect(row).toContainText(title);
      for (const option of target.options) await expect(row).toContainText(option);
      const unit = await woo.displayedMoney(
        row,
        [
          settings.selectors.cartUnitPrice ||
            '.product-price .amount, .wc-block-cart-item__prices .wc-block-components-product-price__value, [data-woo-cart-price]',
        ],
        price,
      );
      const line = await woo.displayedMoney(
        row,
        [
          settings.selectors.cartLinePrice ||
            '.product-subtotal .amount, .wc-block-cart-item__total-price-and-sale-badge-wrapper .wc-block-components-product-price__value, [data-woo-cart-subtotal]',
        ],
        price,
      );
      expect({ unit: unit.amount, line: line.amount }).toEqual({
        unit: facts.unitPrice,
        line: facts.linePrice,
      });
    },
    async stable() {
      await woo.stable(session, product);
    },
    async clear() {
      await session.clearCart();
    },
  };
}
export async function quantityControl(page: Page) {
  const row = await cartRow(page);
  const input = row
    .locator(
      'input[name^="updates"], input.qty, input[type="number"], .wc-block-components-quantity-selector__input',
    )
    .filter({ visible: true });
  if ((await input.count()) !== 1)
    throw new CommerceUnverified('Cart quantity control is not uniquely exposed');
  if (Number((await input.getAttribute('max')) || Infinity) < 2)
    throw new CommerceUnverified('Cart restricts this product to one unit');
  return input;
}
export async function showCart(page: Page, adapter: JourneyAdapter) {
  await page.goto(adapter.cartUrl, { waitUntil: 'domcontentloaded' });
  await waitForContent(page);
}
