import { test, expect } from '@playwright/test';
import { verifyTrackingConsent, verifyCheckoutTotals } from '../tests/commerce-expectations';
const config = {
  enabled: true,
  productId: '10',
  observeMs: 100,
  acceptSelector: '#accept',
  rejectSelector: '#reject',
  trackers: ['tracker.example.test'],
  events: { view: 'view_item', add: 'add_to_cart', checkout: 'begin_checkout' },
};
for (const [choice, mode, fails] of [
  ['accept', 'good', false],
  ['reject', 'good', false],
  ['accept', 'early', true],
  ['reject', 'ignores-rejection', true],
  ['reject', 'forgets-rejection', true],
  ['accept', 'missing', true],
] as const) {
  test(`tracking ${choice} ${mode}`, async ({ page }) => {
    await page.route('**/*', route => {
      if (new URL(route.request().url()).hostname === 'tracker.example.test')
        return route.fulfill({ body: 'ok' });
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><body><button id="accept">Accept</button><button id="reject">Reject</button><script>
        const track=()=>fetch('https://tracker.example.test/collect');
        ${mode === 'early' ? 'track();' : ''}
        if(localStorage.rejected && '${mode}'==='forgets-rejection') track();
        document.querySelector('#accept').onclick=()=>{if('${mode}'!=='missing')track()};
        document.querySelector('#reject').onclick=()=>{localStorage.rejected='1';if('${mode}'==='ignores-rejection')track()};
        </script></body></html>`,
      });
    });
    let failure: unknown;
    try {
      await verifyTrackingConsent(page, config, choice, 'http://fixture.test');
    } catch (error) {
      failure = error;
    }
    expect(Boolean(failure)).toBe(fails);
  });
}

for (const [taxIncluded, discountText] of [
  [false, '-€2.00'],
  [true, '−2.00 EUR'],
] as const) {
  test(`checkout nonzero tax and discount, tax included ${taxIncluded}`, async ({ page }) => {
    await page.setContent(
      `<input type="radio" id="delivery"><span id="subtotal">€10.00</span><span id="shipping">€3.00</span><span id="tax">€1.00</span><span id="discount">${discountText}</span><span id="total">${taxIncluded ? '€11.00' : '€12.00'}</span>`,
    );
    const totals = {
      fields: [],
      shippingMethod: '#delivery',
      subtotalSelector: '#subtotal',
      shippingSelector: '#shipping',
      taxSelector: '#tax',
      discountSelector: '#discount',
      totalSelector: '#total',
      subtotal: 1000,
      shipping: 300,
      tax: 100,
      discount: 200,
      total: taxIncluded ? 1100 : 1200,
      currency: 'EUR',
      taxIncluded,
    };
    const result = await verifyCheckoutTotals(page, totals, 'en-US', 2);
    expect(result.discount).toBe(200);
    await page.locator('#total').evaluate(node => {
      node.textContent = 'USD ' + node.textContent!.replace('€', '');
    });
    await expect(verifyCheckoutTotals(page, totals, 'en-US', 2)).rejects.toThrow();
  });
}
