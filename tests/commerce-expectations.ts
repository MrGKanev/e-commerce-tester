import { expect, type Page } from '@playwright/test';
import type { CheckoutField, CheckoutTotals, AnalyticsSettings } from '../config/site-settings';
import { parseMoney } from '../scripts/storefront-model';

export async function applyFields(page: Page, fields: CheckoutField[]) {
  for (const field of fields) {
    const control = page.locator(field.selector).filter({ visible: true });
    await expect(control, 'Configured field must be unique').toHaveCount(1);
    if (field.kind === 'select') await control.selectOption(field.value || '');
    else if (field.kind === 'check') await control.check();
    else {
      await control.fill(field.value || '');
      await control.press('Tab');
    }
  }
}
export async function verifyCheckoutTotals(
  page: Page,
  config: CheckoutTotals,
  locale: string,
  precision: number,
) {
  await applyFields(page, config.fields);
  const shipping = page.locator(config.shippingMethod).filter({ visible: true });
  await expect(shipping, 'Shipping method must be unique').toHaveCount(1);
  await shipping.check();
  const observed: Record<string, number> = {};
  for (const key of ['subtotal', 'shipping', 'tax', 'discount', 'total'] as const) {
    const field = page.locator(config[`${key}Selector`]).filter({ visible: true });
    await expect(field, `Checkout ${key} must be unique`).toHaveCount(1);
    await expect
      .poll(
        async () => {
          const text = (await field.innerText()).trim();
          if (key !== 'discount')
            expect(text, `Checkout ${key} must not be negative`).not.toMatch(/[-−]/);
          const money = parseMoney(
            key === 'discount' ? text.replace(/^[-−]\s*/, '') : text,
            config.currency,
            locale,
            { precision },
          );
          expect(money.currency, `Checkout ${key} currency`).toBe(config.currency);
          expect(money.currencyEvidence, `Checkout ${key} must expose currency`).not.toBe(
            'session-only',
          );
          observed[key] = key === 'discount' ? Math.abs(money.amount) : money.amount;
          return observed[key];
        },
        { message: `Checkout ${key} differs from configured expectation` },
      )
      .toBe(config[key]);
  }
  expect(observed.total, 'Checkout arithmetic mismatch').toBe(
    observed.subtotal +
      observed.shipping +
      (config.taxIncluded ? 0 : observed.tax) -
      observed.discount,
  );
  if (
    config.freeShippingThreshold !== undefined &&
    observed.subtotal - observed.discount >= config.freeShippingThreshold
  )
    expect(observed.shipping, 'Free shipping threshold reached').toBe(0);
  return { ...observed, currency: config.currency, taxIncluded: config.taxIncluded };
}

type AnalyticsEvent = {
  event: string;
  value?: number;
  currency?: string;
  items: Array<{ item_id?: string; price?: number; quantity?: number }>;
};
export async function observeAnalytics(page: Page, config: AnalyticsSettings) {
  const events: AnalyticsEvent[] = [];
  await page.exposeBinding('__storeHealthEvent', (_, event: AnalyticsEvent) => {
    if (events.length < 1000) events.push(event);
  });
  await page.addInitScript(
    ({ layer, names }) => {
      const target = window as unknown as Record<string, unknown>;
      const buffer: unknown[] = [];
      const capture = (entry: unknown) => {
        if (!entry || typeof entry !== 'object') return;
        const value = entry as {
          event?: string;
          ecommerce?: {
            value?: number;
            currency?: string;
            items?: Array<{ item_id?: string; price?: number; quantity?: number }>;
          };
        };
        if (!value.event || !names.includes(value.event)) return;
        const commerce = value.ecommerce || {};
        const send = target.__storeHealthEvent as (event: unknown) => Promise<void>;
        void send({
          event: value.event,
          value: commerce.value,
          currency: commerce.currency,
          items: (Array.isArray(commerce.items) ? commerce.items : []).slice(0, 50).map(item => ({
            item_id: String(item?.item_id ?? ''),
            price: item?.price,
            quantity: item?.quantity,
          })),
        }).catch(() => {});
      };
      buffer.push = (...values: unknown[]) => {
        values.forEach(capture);
        return Array.prototype.push.apply(buffer, values);
      };
      target[layer] = buffer;
    },
    { layer: config.layer || 'dataLayer', names: Object.values(config.events) },
  );
  return {
    events,
    async verify(
      stage: 'view' | 'add' | 'checkout',
      quantity: number,
      value: number,
      currency: string,
      unitPrice: number,
      precision: number,
    ) {
      // A bounded observation window also catches duplicate events after the first dispatch.
      await new Promise(resolve => setTimeout(resolve, config.observeMs ?? 1000));
      const matches = events.filter(event => event.event === config.events[stage]);
      expect(matches, `Analytics ${stage}: expected exactly one event`).toHaveLength(1);
      const event = matches[0];
      expect(event.currency, `Analytics ${stage} currency`).toBe(currency);
      expect(event.value, `Analytics ${stage} value`).toBe(value / 10 ** precision);
      expect(event.items, `Analytics ${stage} product count`).toHaveLength(1);
      expect(event.items[0]).toEqual({
        item_id: config.productId,
        quantity,
        price: unitPrice / 10 ** precision,
      });
      return { stage, ...event };
    },
  };
}

export async function verifyTrackingConsent(
  page: Page,
  config: AnalyticsSettings,
  choice: 'accept' | 'reject',
  url: string,
  observed = new Set<string>(),
) {
  const context = page.context();
  const listen = (request: import('@playwright/test').Request) => {
    const host = new URL(request.url()).hostname;
    for (const tracker of config.trackers)
      if (host === tracker || host.endsWith('.' + tracker)) observed.add(tracker);
  };
  context.on('request', listen);
  const pause = () => new Promise(resolve => setTimeout(resolve, config.observeMs ?? 1000));
  try {
    await page.goto(url, { waitUntil: 'load' });
    await pause();
    expect([...observed], 'Tracking before consent').toEqual([]);
    await page.locator(choice === 'accept' ? config.acceptSelector : config.rejectSelector).click();
    await pause();
    if (choice === 'accept')
      expect([...observed].sort(), 'Expected trackers after acceptance').toEqual(
        [...config.trackers].sort(),
      );
    else {
      expect([...observed], 'Tracking after rejection').toEqual([]);
      await page.reload({ waitUntil: 'load' });
      await pause();
      expect([...observed], 'Rejection must survive reload').toEqual([]);
    }
    return [...observed];
  } finally {
    context.off('request', listen);
  }
}
