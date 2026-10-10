import { expect, type Page, type TestInfo } from '@playwright/test';
import { test } from './fixtures';
import { assertCheckoutField, CheckNotApplicable } from './storefront-assertions';
import { readSiteSettings } from '../config/site-settings';
import { CommerceUnverified, parseMoney } from '../scripts/storefront-model';
import { waitForContent, dismissCookieConsent, BASE } from './helpers';
import { pageInventory, type InventoryPage } from './inventory';
import { isLimited } from './pacing';
import {
  planShopify,
  planWoo,
  quantityControl,
  showCart,
  type JourneyAdapter,
  type CartObservation,
} from './buyer-journey-adapters';
const settings = readSiteSettings();
type Step = {
  name: string;
  status: 'running' | 'passed' | 'failed' | 'unverified';
  expected?: unknown;
  actual?: unknown;
  reason?: string;
};
export async function runBuyerJourney(
  page: Page,
  info: TestInfo,
  inventory: InventoryPage[] = pageInventory(),
) {
  const steps: Step[] = [];
  let adapter: JourneyAdapter | undefined;
  let mutated = false;
  let failure: unknown;
  let cart: CartObservation | undefined;
  let checkoutMutationBlocked = false;
  await page.route('**/*', async route => {
    const request = route.request(),
      url = new URL(request.url());
    const orderMutation =
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) &&
      (/\/wc\/store\/v1\/checkout\/?$/.test(url.pathname) ||
        url.searchParams.get('wc-ajax') === 'checkout' ||
        /\/(?:orders?|payments|processing)(?:\/|$)/i.test(url.pathname));
    if (orderMutation) {
      checkoutMutationBlocked = true;
      await route.abort();
    } else await route.fallback();
  });
  const settledCart = async (selected: JourneyAdapter, quantity: number) => {
    let mismatch: unknown;
    try {
      await expect
        .poll(
          async () => {
            try {
              return (await selected.cart(quantity)).quantity;
            } catch (error) {
              mismatch = error;
              return 0;
            }
          },
          { message: 'Cart did not reconcile after the UI action' },
        )
        .toBe(quantity);
    } catch (error) {
      throw mismatch || error;
    }
    return selected.cart(quantity);
  };
  const step = async (name: string, expected: unknown, action: () => Promise<unknown>) => {
    const record: Step = { name, expected, status: 'running' };
    steps.push(record);
    await test.step(name, async () => {
      try {
        record.actual = await action();
        record.status = 'passed';
      } catch (error) {
        record.status = error instanceof CommerceUnverified ? 'unverified' : 'failed';
        record.reason = error instanceof Error ? error.message : String(error);
        record.actual ??= { mismatch: record.reason };
        throw error;
      }
    });
  };
  try {
    await step(
      'plan',
      'Available product, quantity 1 → 2; prefer a product with variants',
      async () => {
        const reasons: string[] = [];
        for (const entry of inventory.filter(entry => entry.type === 'product').slice(0, 6)) {
          const response = await page.goto(entry.url, { waitUntil: 'domcontentloaded' });
          expect(response?.status(), 'Inventory product did not load').toBeLessThan(400);
          expect(new URL(page.url()).origin, 'Product redirected off storefront').toBe(
            new URL(BASE).origin,
          );
          await waitForContent(page);
          await dismissCookieConsent(page);
          try {
            const candidate =
              settings.platform === 'shopify'
                ? await planShopify(page, entry)
                : await planWoo(page, entry);
            if (!adapter || candidate.target.hasVariants) adapter = candidate;
            if (candidate.target.hasVariants) break;
          } catch (error) {
            if (!(error instanceof CommerceUnverified) || isLimited()) throw error;
            reasons.push(error.message);
          }
        }
        if (!adapter)
          throw new CommerceUnverified(
            'No suitable product in bounded inventory sample: ' + reasons.join('; '),
          );
        return { target: adapter.target, unsupportedCandidates: reasons };
      },
    );
    const selected = adapter!;
    await step(
      'search',
      { productId: selected.target.productId, title: selected.target.title },
      async () => {
        await page.goto(selected.searchUrl, { waitUntil: 'domcontentloaded' });
        await waitForContent(page);
        const fields = page
          .locator(
            settings.selectors.searchInput ||
              'input[name="q"], input[name="s"], input[type="search"]',
          )
          .filter({ visible: true });
        if ((await fields.count()) !== 1)
          throw new CommerceUnverified(
            'Search input is not uniquely exposed; configure selectors.searchInput',
          );
        await fields.fill(selected.target.title);
        await fields.press('Enter');
        const links = page
          .locator(settings.selectors.searchResults || 'main a[href], [role="main"] a[href]')
          .filter({ visible: true });
        await expect
          .poll(
            async () => {
              const paths = await links.evaluateAll(nodes =>
                nodes.map(node => (node as HTMLAnchorElement).href),
              );
              return paths.some(href => sameProductUrl(href, selected.target.url));
            },
            { message: 'Search results do not contain the selected product URL' },
          )
          .toBe(true);
        return { exactProductLink: selected.target.url };
      },
    );
    await step(
      'product',
      { productId: selected.target.productId, url: selected.target.url },
      async () => {
        const links = page
          .locator(settings.selectors.searchResults || 'main a[href], [role="main"] a[href]')
          .filter({ visible: true });
        const candidates = [];
        for (const link of await links.all())
          if (
            sameProductUrl((await link.getAttribute('href')) || '', selected.target.url, page.url())
          )
            candidates.push(link);
        await candidates[0].click();
        await expect
          .poll(() => sameProductUrl(page.url(), selected.target.url), {
            message: 'Product link navigated to a different product',
          })
          .toBe(true);
        await waitForContent(page);
        return { url: page.url() };
      },
    );
    await step('variant', selected.target, async () => {
      await selected.select();
      await selected.stable();
      return {
        variantId: selected.target.variantId,
        variantSelection: selected.target.hasVariants
          ? 'selected-through-ui'
          : 'not-applicable-simple-product',
        unitPrice: selected.target.unitPrice,
        currency: selected.target.currency,
      };
    });
    await step(
      'add',
      { variantId: selected.target.variantId, quantity: 1, unitPrice: selected.target.unitPrice },
      async () => {
        await selected.clear();
        mutated = true;
        await selected.add();
        cart = await settledCart(selected, 1);
        await selected.stable();
        cart = await selected.cart(1);
        await showCart(page, selected);
        cart = await selected.cart(1);
        await selected.cartUI(cart);
        return cart;
      },
    );
    await step(
      'quantity',
      {
        variantId: selected.target.variantId,
        quantity: 2,
        catalogLinePrice: selected.target.unitPrice * 2,
      },
      async () => {
        const input = await quantityControl(page);
        await expect(input, 'Initial cart UI quantity differs from API').toHaveValue('1');
        await input.fill('2');
        await input.press('Tab');
        const update = page
          .locator(
            settings.selectors.cartUpdate ||
              'button[name="update"], button[name="update_cart"], input[name="update_cart"]',
          )
          .filter({ visible: true });
        if ((await update.count()) === 1 && (await update.isEnabled())) await update.click();
        cart = await settledCart(selected, 2);
        await expect(await quantityControl(page)).toHaveValue('2');
        await selected.stable();
        cart = await selected.cart(2);
        await selected.cartUI(cart);
        return cart;
      },
    );
    await step(
      'checkout',
      {
        title: selected.target.title,
        variantId: selected.target.variantId,
        quantity: 2,
        linePrice: cart!.linePrice,
        currency: cart!.currency,
      },
      async () => {
        const button = page
          .locator(
            settings.selectors.checkoutButton ||
              'button[name="checkout"], a[href*="/checkout"], .checkout-button, .wc-block-cart__submit-button',
          )
          .filter({ visible: true });
        if ((await button.count()) !== 1)
          throw new CommerceUnverified('Checkout control is not uniquely exposed');
        await button.click();
        const toggle = page
          .getByRole('button', { name: /show order summary|покажи.*поръчк/i })
          .filter({ visible: true });
        if ((await toggle.count()) === 1) await toggle.click();
        const summary = page
          .locator(
            settings.selectors.checkoutSummary ||
              '[data-checkout-line-item], [data-order-summary-section="line-items"] .product, .woocommerce-checkout-review-order-table .cart_item, .wc-block-components-order-summary-item',
          )
          .filter({ visible: true });
        try {
          await expect(summary).toHaveCount(1);
        } catch {
          throw new CommerceUnverified(
            'Checkout order summary is unavailable or ambiguous; cart verified, checkout not verified',
          );
        }
        try {
          await assertCheckoutField(page, info, 'contact');
        } catch (error) {
          if (!(error instanceof CheckNotApplicable)) throw error;
        }
        await expect(summary).toContainText(selected.target.title);
        if (checkoutMutationBlocked)
          throw new CommerceUnverified(
            'Checkout attempted an order mutation; request blocked, no order submitted',
          );
        for (const option of selected.target.options) await expect(summary).toContainText(option);
        const quantity = summary.locator(
          settings.selectors.checkoutQuantity ||
            '[data-checkout-quantity], .product__quantity, .product-quantity, .wc-block-components-order-summary-item__quantity',
        );
        if ((await quantity.count()) !== 1)
          throw new CommerceUnverified('Checkout quantity is not uniquely readable');
        expect((await quantity.innerText()).match(/\d+/g), 'Checkout quantity mismatch').toEqual([
          '2',
        ]);
        const line = summary
          .locator(
            settings.selectors.checkoutLinePrice ||
              '[data-checkout-line-price], .product__price .order-summary__emphasis, .product-total .amount, .wc-block-components-order-summary-item__total-price .wc-block-components-product-price__value',
          )
          .filter({ visible: true });
        if ((await line.count()) !== 1)
          throw new CommerceUnverified('Checkout line price is not uniquely readable');
        const money = parseMoney(
          await line.innerText(),
          selected.target.currency,
          settings.locale,
          { precision: selected.target.precision },
        );
        if (money.currencyEvidence === 'session-only')
          throw new CommerceUnverified('Checkout amount does not expose identifiable currency');
        expect(
          { amount: money.amount, currency: money.currency },
          'Checkout line amount/currency differs from cart',
        ).toEqual({ amount: cart!.linePrice, currency: cart!.currency });
        if (checkoutMutationBlocked)
          throw new CommerceUnverified(
            'Checkout attempted an order mutation; request blocked, no order submitted',
          );
        return {
          quantity: 2,
          linePrice: money.amount,
          currency: money.currency,
          orderSubmitted: false,
        };
      },
    );
  } catch (error) {
    failure = error;
  } finally {
    if (mutated && adapter && !isLimited()) {
      try {
        await step('cleanup', 'Empty dedicated visitor cart', async () => {
          await adapter!.clear();
          return { cleared: true };
        });
      } catch (error) {
        failure ||= error;
      }
    }
    const firstProblem = steps.find(step => ['failed', 'unverified'].includes(step.status));
    await info.attach('buyer-journey.json', {
      body: JSON.stringify(
        {
          schemaVersion: 1,
          platform: settings.platform,
          project: info.project.name,
          status: failure
            ? failure instanceof CommerceUnverified
              ? 'unverified'
              : 'failed'
            : 'passed',
          failedStep: firstProblem?.name || null,
          reason: firstProblem?.reason || null,
          target: adapter?.target,
          steps,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  }
  if (failure) throw failure;
}
function sameProductUrl(value: string, expected: string, base = expected) {
  try {
    const actual = new URL(value, base),
      target = new URL(expected);
    return (
      actual.origin === target.origin &&
      actual.pathname.replace(/\/$/, '') === target.pathname.replace(/\/$/, '')
    );
  } catch {
    return false;
  }
}
