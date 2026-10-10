import { expect, type Page, type Locator, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { readSiteSettings } from '../config/site-settings';
import { ADD_TO_CART_SEL, BASE, cartAction, dismissCookieConsent, waitForContent } from './helpers';
import { assertNotLimited, isLimited } from './pacing';
import {
  CommerceUnverified,
  monetaryInteger,
  parseMoney,
  schemaPrice,
  cartPrice,
  type PublicProduct,
  type PublicVariant,
  type PublicCart,
  type ParsedMoney,
} from '../scripts/commerce-model';

export type CommerceKind = 'price' | 'schema' | 'available' | 'unavailable';
const settings = readSiteSettings();
type Observation = Record<string, unknown>;

async function routeRoot(page: Page): Promise<string> {
  const root = await page.evaluate(() => {
    const shopify = (window as unknown as { Shopify?: { routes?: { root?: string } } }).Shopify;
    return shopify?.routes?.root || '/';
  });
  const url = new URL(root, page.url());
  if (
    url.origin !== new URL(BASE).origin ||
    !root.startsWith('/') ||
    root.startsWith('//') ||
    url.search ||
    url.hash
  )
    throw new CommerceUnverified('Storefront route root is not a same-origin locale path');
  return url.href.endsWith('/') ? url.href : url.href + '/';
}
async function publicJson<T>(page: Page, url: string): Promise<T> {
  const response = await page.context().request.get(url);
  assertNotLimited();
  expect(response.ok(), `Public storefront API ${url} returned HTTP ${response.status()}`).toBe(
    true,
  );
  return (await response.json()) as T;
}
function validateProduct(product: PublicProduct, handle: string) {
  if (product.handle !== handle || !Array.isArray(product.variants) || !product.variants.length)
    throw new Error('Public product response does not match the configured product');
  if (product.requires_selling_plan)
    throw new CommerceUnverified('Subscription-only product requires a selling-plan adapter');
  for (const variant of product.variants) {
    if (
      !/^\d+$/.test(String(variant.id)) ||
      typeof variant.available !== 'boolean' ||
      !Array.isArray(variant.options)
    )
      throw new Error('Public product has invalid variant data');
    monetaryInteger(variant.price, 'Variant price');
    if (variant.compare_at_price !== null && variant.compare_at_price !== undefined)
      monetaryInteger(variant.compare_at_price, 'Variant compare-at price');
  }
}
async function productRoot(page: Page): Promise<Locator> {
  if (settings.selectors.commerceRoot) {
    const custom = page.locator(settings.selectors.commerceRoot).filter({ visible: true });
    await expect(custom, 'Configured commerce root must uniquely identify the product').toHaveCount(
      1,
    );
    return custom;
  }
  const roots = page
    .locator('main product-info, main [data-product-root], main .product, main .product-single')
    .filter({ has: page.locator('form[action*="/cart/add"]') })
    .filter({ visible: true });
  if ((await roots.count()) === 1) return roots;
  const main = page.locator('main, [role="main"]').filter({ visible: true });
  if ((await main.count()) !== 1)
    throw new CommerceUnverified(
      'Cannot uniquely scope the product; configure selectors.commerceRoot',
    );
  return main;
}
async function productForm(root: Locator): Promise<Locator> {
  const forms = root
    .locator(settings.selectors.productForm || 'form[action*="/cart/add"]')
    .filter({ has: root.page().locator('input[name="id"], select[name="id"]') })
    .filter({ visible: true });
  if ((await forms.count()) !== 1)
    throw new CommerceUnverified(
      'Cannot uniquely identify the product form; configure selectors.productForm',
    );
  return forms;
}
async function selectedId(root: Locator): Promise<string> {
  const form = await productForm(root);
  const fields = form.locator('input[name="id"], select[name="id"]');
  const ids = await fields.evaluateAll(elements => [
    ...new Set(elements.map(element => (element as HTMLInputElement).value).filter(Boolean)),
  ]);
  if (ids.length !== 1)
    throw new CommerceUnverified('Product form has no unambiguous selected variant ID');
  return ids[0];
}
async function selectVariant(
  root: Locator,
  product: PublicProduct,
  variant: PublicVariant,
): Promise<boolean> {
  if ((await selectedId(root)) === String(variant.id)) return true;
  const direct = (await productForm(root)).locator('select[name="id"]').filter({ visible: true });
  if ((await direct.count()) === 1) {
    const option = direct.locator('option').filter({ hasText: /.*/ });
    const target = option.locator(`xpath=self::option[@value="${variant.id}"]`);
    if ((await target.count()) !== 1)
      throw new CommerceUnverified('Variant is not exposed in the selector');
    if (await target.isDisabled()) return false;
    await direct.selectOption(String(variant.id));
  } else {
    const selects = root
      .locator('select[name^="options["], variant-selects select, .product-form__input select')
      .filter({ visible: true });
    const selectFields: Locator[] = [];
    for (const select of await selects.all())
      if ((await select.getAttribute('name')) !== 'id') selectFields.push(select);
    const radios = root.locator('input[type="radio"]');
    const groups = new Map<string, Locator[]>();
    for (const radio of await radios.all()) {
      const name = (await radio.getAttribute('name')) || '';
      if (!name || /selling|purchase|plan/i.test(name)) continue;
      groups.set(name, [...(groups.get(name) || []), radio]);
    }
    if (selectFields.length && groups.size)
      throw new CommerceUnverified('Mixed variant controls require a theme adapter');
    if (selectFields.length === variant.options.length && selectFields.length) {
      for (const [index, select] of selectFields.entries()) {
        const choices = select.locator('option');
        const values = await choices.evaluateAll(options =>
          options.map(option => ({
            value: (option as HTMLOptionElement).value,
            label: option.textContent?.trim(),
            disabled: (option as HTMLOptionElement).disabled,
          })),
        );
        const matches = values.filter(
          value => value.value === variant.options[index] || value.label === variant.options[index],
        );
        if (matches.length !== 1)
          throw new CommerceUnverified(
            'Variant option cannot be uniquely associated with a UI control',
          );
        if (matches[0].disabled) return false;
        await select.selectOption(matches[0].value);
      }
    } else if (groups.size === variant.options.length && groups.size) {
      for (const [index, fields] of [...groups.values()].entries()) {
        const matches: Locator[] = [];
        for (const field of fields)
          if ((await field.getAttribute('value')) === variant.options[index]) matches.push(field);
        if (matches.length !== 1)
          throw new CommerceUnverified('Variant radio option cannot be uniquely identified');
        if (await matches[0].isDisabled()) return false;
        // Native labels can expose visually hidden radios; check() still exercises the UI.
        await matches[0].check();
      }
    } else
      throw new CommerceUnverified(
        'Unsupported variant picker; an explicit theme adapter is needed',
      );
  }
  await expect
    .poll(() => selectedId(root), { message: 'UI did not select the requested variant' })
    .toBe(String(variant.id));
  return true;
}
async function readPrice(
  root: Locator,
  currency: string,
  selectors: string[],
): Promise<ParsedMoney> {
  for (const selector of selectors) {
    const elements = root.locator(selector).filter({ visible: true });
    const texts: string[] = [];
    for (const element of await elements.all()) {
      const struck = await element.evaluate(node =>
        Boolean(node.closest('s, del, .price-item--compare')),
      );
      if (!struck) texts.push((await element.innerText()).trim());
    }
    if (!texts.length) continue;
    const values = [...new Set(texts)].map(text => parseMoney(text, currency, settings.locale));
    if (new Set(values.map(value => `${value.amount}:${value.currency}`)).size !== 1)
      throw new CommerceUnverified(
        'Multiple active prices found; configure a precise price selector',
      );
    if (values[0].currencyEvidence === 'session-only')
      throw new CommerceUnverified(
        `UI price "${values[0].text}" has no identifiable currency; include its currency label in the price selector`,
      );
    return values[0];
  }
  throw new CommerceUnverified(
    'No uniquely readable active price in this theme; configure its price selector',
  );
}
async function activePrice(root: Locator, currency: string): Promise<ParsedMoney> {
  return readPrice(
    root,
    currency,
    settings.selectors.price
      ? [settings.selectors.price]
      : [
          '.price--on-sale .price__sale .price-item--sale',
          '.price__sale .price-item--sale',
          '[data-product-price]',
          '.product__price',
          '.price__regular .price-item--regular',
          '.price-item--sale',
          '.price-item--regular',
          'span.money',
        ],
  );
}
async function cartDisplay(
  page: Page,
  rootUrl: string,
  product: PublicProduct,
  variant: PublicVariant,
  facts: Record<string, unknown>,
  currency: string,
) {
  await page.goto(rootUrl + 'cart', { waitUntil: 'domcontentloaded' });
  await waitForContent(page);
  const rows = page
    .locator(
      settings.selectors.cartItems || '.cart-item, .cart__item, tr.cart__row, [data-cart-item]',
    )
    .filter({ visible: true });
  if ((await rows.count()) !== 1)
    throw new CommerceUnverified(
      'Cannot uniquely scope the cart line; configure selectors.cartItems',
    );
  await expect(rows, 'Cart UI does not identify the selected product').toContainText(product.title);
  for (const option of variant.options.filter(option => option !== 'Default Title'))
    await expect(rows, 'Cart UI does not identify the selected variant options').toContainText(
      option,
    );
  const unit = await readPrice(
    rows,
    currency,
    settings.selectors.cartUnitPrice
      ? [settings.selectors.cartUnitPrice]
      : [
          '[data-cart-item-price]',
          '.cart-item__final-price',
          '.cart-item__price-wrapper .price',
          '.cart-item__details > .product-option',
        ],
  );
  const line = await readPrice(
    rows,
    currency,
    settings.selectors.cartLinePrice
      ? [settings.selectors.cartLinePrice]
      : ['[data-cart-item-total]', '.cart-item__totals .price', '.cart-item__total .money'],
  );
  expect(
    { amount: unit.amount, currency: unit.currency },
    'Cart UI unit price differs from the cart API final price',
  ).toEqual({ amount: facts.finalPrice, currency });
  expect(
    { amount: line.amount, currency: line.currency },
    'Cart UI line total differs from the cart API final line price',
  ).toEqual({ amount: facts.finalLinePrice, currency });
  return { unitPrice: unit, linePrice: line };
}
async function readSchemas(page: Page): Promise<unknown[]> {
  const scripts = await page.locator('script[type="application/ld+json"]').allTextContents();
  return scripts.map((script, index) => {
    try {
      return JSON.parse(script);
    } catch (error) {
      throw new Error(`JSON-LD block ${index + 1} is not valid JSON`, { cause: error });
    }
  });
}
function snapshot(variant: PublicVariant) {
  return {
    variantId: String(variant.id),
    options: variant.options,
    price: variant.price,
    compareAtPrice: variant.compare_at_price,
    available: variant.available,
  };
}
async function clearSession(page: Page, rootUrl: string) {
  const response = await page.context().request.post(rootUrl + 'cart/clear.js');
  assertNotLimited();
  expect(response.ok(), 'Session cart cleanup failed').toBe(true);
}
async function ensureStable(page: Page, rootUrl: string, handle: string, before: PublicVariant) {
  const product = await publicJson<PublicProduct>(
    page,
    rootUrl + `products/${encodeURIComponent(handle)}.js`,
  );
  const after = product.variants.find(variant => String(variant.id) === String(before.id));
  if (!after || after.available !== before.available || after.price !== before.price)
    throw new CommerceUnverified(
      'Variant price or availability changed during this check; observations are not comparable',
    );
  return product;
}

export async function auditCommerce(
  page: Page,
  testInfo: TestInfo,
  handle: string,
  kind: CommerceKind,
) {
  const observations: Observation[] = [];
  let failure: unknown;
  let rootUrl: string | undefined;
  let mutated = false;
  try {
    await page.goto(`${BASE}/products/${encodeURIComponent(handle)}`, {
      waitUntil: 'domcontentloaded',
    });
    await waitForContent(page);
    await dismissCookieConsent(page);
    rootUrl = await routeRoot(page);
    const product = await publicJson<PublicProduct>(
      page,
      rootUrl + `products/${encodeURIComponent(handle)}.js`,
    );
    validateProduct(product, handle);
    const session = await publicJson<PublicCart>(page, rootUrl + 'cart.js');
    if (typeof session.currency !== 'string' || !/^[A-Z]{3}$/.test(session.currency))
      throw new Error('Cart API did not identify the session currency');
    const root = await productRoot(page);
    const initial = await selectedId(root);
    const initialVariant = product.variants.find(variant => String(variant.id) === initial);
    if (!initialVariant)
      throw new CommerceUnverified(
        'Selected variant is not exposed by the public Product API (which may truncate large variant lists)',
      );
    const available = product.variants.filter(variant => variant.available);
    const primary = initialVariant.available ? initialVariant : available[0];
    const plans =
      kind === 'unavailable'
        ? product.variants.filter(variant => !variant.available).slice(0, 1)
        : primary
          ? [
              primary,
              ...available
                .filter(
                  variant =>
                    String(variant.id) !== String(primary.id) && variant.price !== primary.price,
                )
                .slice(0, kind === 'available' ? 0 : 1),
            ]
          : [];
    if (!plans.length)
      throw new CommerceUnverified(
        kind === 'unavailable'
          ? 'No unavailable variant exposed in this product sample'
          : 'No available test variant exposed in this product sample',
      );
    observations.push({
      stage: 'session',
      currency: session.currency,
      routeRoot: new URL(rootUrl).pathname,
      variantsExposed: product.variants.length,
      selectedVariantId: initial,
      plannedVariantIds: plans.map(variant => String(variant.id)),
    });
    for (const [index, variant] of plans.entries()) {
      if (index > 0) {
        await page.goto(rootUrl + `products/${encodeURIComponent(handle)}`, {
          waitUntil: 'domcontentloaded',
        });
        await waitForContent(page);
      }
      const observation: Observation = { ...snapshot(variant), currency: session.currency };
      observations.push(observation);
      const chosen = await selectVariant(root, product, variant);
      if (!chosen) {
        await ensureStable(page, rootUrl, handle, variant);
        if (variant.available)
          throw new Error(`Available variant ${variant.id} is disabled in the UI picker`);
        observation.availabilityUI = 'option-disabled';
        continue;
      }
      const form = await productForm(root);
      const sellingPlan = form.locator('input[name="selling_plan"], select[name="selling_plan"]');
      for (const field of await sellingPlan.all())
        if (await field.inputValue())
          throw new CommerceUnverified('Selected selling plan requires separate price rules');
      if (
        variant.quantity_rule &&
        (variant.quantity_rule.min > 1 || variant.quantity_rule.increment > 1)
      )
        throw new CommerceUnverified('Variant minimum quantity rules require a dedicated scenario');
      if (kind === 'schema') {
        const latest = await ensureStable(page, rootUrl, handle, variant);
        if (latest.price_min !== product.price_min || latest.price_max !== product.price_max)
          throw new CommerceUnverified('Product price range changed during the JSON-LD check');
        observation.jsonLd = schemaPrice(
          await readSchemas(page),
          product,
          variant,
          session.currency,
          page.url(),
        );
        continue;
      }
      const button = form.locator(ADD_TO_CART_SEL).filter({ visible: true }).first();
      await expect(button, 'Product purchase control is not visible').toBeVisible();
      if (!variant.available) {
        let mismatch: unknown;
        try {
          await expect(button, 'Unavailable variant still allows purchase').toBeDisabled();
        } catch (error) {
          mismatch = error;
        }
        await ensureStable(page, rootUrl, handle, variant);
        if (mismatch) throw mismatch;
        const status = (await button.innerText()).trim();
        const indication = root
          .locator(
            settings.selectors.soldOut ||
              '[data-stock-status], .product__inventory, [data-availability]',
          )
          .filter({ visible: true });
        const messages = [status, ...(await indication.allTextContents())];
        if (
          !messages.some(text =>
            /sold\s*out|out\s*of\s*stock|unavailable|изчерпан|неналичен|не е наличен/i.test(text),
          )
        )
          throw new CommerceUnverified(
            'Purchase is disabled, but no recognizable unavailable status is exposed; configure selectors.soldOut',
          );
        observation.availabilityUI = { disabled: true, messages };
        continue;
      }
      let buttonFailure: unknown;
      try {
        await expect(button, 'Available variant cannot be purchased').toBeEnabled();
      } catch (error) {
        buttonFailure = error;
      }
      if (buttonFailure) {
        await ensureStable(page, rootUrl, handle, variant);
        throw buttonFailure;
      }
      if (kind === 'price') {
        let priceFailure: unknown;
        try {
          await expect
            .poll(
              async () => {
                const money = await activePrice(root, session.currency);
                return { amount: money.amount, currency: money.currency };
              },
              { message: `UI price did not update to variant ${variant.id}` },
            )
            .toEqual({ amount: variant.price, currency: session.currency });
        } catch (error) {
          priceFailure = error;
        }
        observation.uiPrice = await activePrice(root, session.currency);
        await ensureStable(page, rootUrl, handle, variant);
        if (priceFailure) throw priceFailure;
        const struck = root.locator('s, del').filter({ visible: true });
        if ((await struck.count()) === 1) {
          if (!variant.compare_at_price || variant.compare_at_price <= variant.price)
            throw new Error('UI shows a compare-at price for a variant with no API markdown');
          const compareAt = parseMoney(await struck.innerText(), session.currency, settings.locale);
          expect(
            { amount: compareAt.amount, currency: compareAt.currency },
            'Displayed compare-at price differs from product data',
          ).toEqual({ amount: variant.compare_at_price, currency: session.currency });
          observation.uiCompareAtPrice = compareAt;
        }
      }
      await clearSession(page, rootUrl);
      mutated = true;
      const quantity = form.locator('input[name="quantity"]').filter({ visible: true });
      if ((await quantity.count()) === 1) await quantity.fill('1');
      try {
        await cartAction(page, () => button.click());
      } catch (error) {
        await ensureStable(page, rootUrl, handle, variant);
        throw error;
      }
      const cart = await publicJson<PublicCart>(page, rootUrl + 'cart.js');
      if (cart.currency !== session.currency)
        throw new CommerceUnverified(
          'Session currency changed during the cart action; observations are not comparable',
        );
      await ensureStable(page, rootUrl, handle, variant);
      observation.cart = cartPrice(cart, variant);
      if (kind === 'price')
        observation.uiCartPrices = await cartDisplay(
          page,
          rootUrl,
          product,
          variant,
          observation.cart as Record<string, unknown>,
          session.currency,
        );
      observation.availabilityUI = 'enabled-and-exact-variant-added';
    }
  } catch (error) {
    failure = error;
  } finally {
    if (mutated && rootUrl && !isLimited()) {
      try {
        await clearSession(page, rootUrl);
      } catch (error) {
        observations.push({
          stage: 'cleanup',
          status: 'failed',
          reason: error instanceof Error ? error.message : String(error),
        });
        failure ||= error;
      }
    }
    if (failure && !page.isClosed()) {
      try {
        await testInfo.attach('commerce-evidence', {
          body: await page.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        });
      } catch (error) {
        observations.push({
          stage: 'screenshot',
          status: 'unavailable',
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const report = {
      schemaVersion: 1,
      platform: 'shopify',
      source: 'public-storefront-session',
      kind,
      productHandle: handle,
      project: testInfo.project.name,
      scenario: testInfo.title,
      status: failure instanceof CommerceUnverified ? 'unverified' : failure ? 'failed' : 'passed',
      reason: failure instanceof Error ? failure.message : failure ? String(failure) : null,
      observations,
    };
    const file = testInfo.outputPath('commerce-consistency.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    await testInfo.attach('commerce-consistency.json', {
      path: file,
      contentType: 'application/json',
    });
  }
  if (failure) throw failure;
}

/** Shared Shopify primitives for the continuous buyer journey. */
export const shopifyCommerce = {
  routeRoot,
  publicJson,
  validateProduct,
  productRoot,
  productForm,
  selectedId,
  selectVariant,
  activePrice,
  readPrice,
  clearSession,
  ensureStable,
};
