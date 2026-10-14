import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { test, expect } from '../tests/fixtures';
import { runBuyerJourney } from '../tests/buyer-journey';
import { CommerceUnverified } from '../scripts/storefront-model';
import { readSiteSettings } from '../config/site-settings';
import type { InventoryPage } from '../tests/inventory';
let server: Server;
const woo = readSiteSettings().platform === 'woocommerce';
const origin = 'http://127.0.0.1:45993';
const prefix = woo ? '/wp' : '/en';
const productPath = `${prefix}/${woo ? 'goods' : 'products'}/sample`;
const sessions = new Map<string, { quantity: number; mode: string; variant: number }>();
const seen: string[] = [];
const money = (value: number) => `€${(value / 100).toFixed(2)}`;
function product(id = 10, mode = 'good') {
  return woo
    ? {
        id,
        name: 'Journey product',
        permalink: origin + productPath,
        type: id === 10 ? (mode === 'simple' ? 'simple' : 'variable') : 'variation',
        is_purchasable: true,
        is_in_stock: mode !== 'unavailable',
        has_options: id === 10 && mode !== 'simple',
        prices: {
          price: '2990',
          regular_price: '2990',
          currency_code: 'EUR',
          currency_minor_unit: 2,
        },
      }
    : {
        id: 10,
        title: 'Journey product',
        handle: 'sample',
        options: ['Size'],
        variants: [
          {
            id: 11,
            available: mode !== 'unavailable',
            price: 2990,
            compare_at_price: null,
            options: [mode === 'simple' ? 'Default Title' : 'Large'],
          },
          ...(mode === 'simple'
            ? []
            : [
                {
                  id: 12,
                  available: false,
                  price: 2990,
                  compare_at_price: null,
                  options: ['Small'],
                },
              ]),
        ],
        price_min: 2990,
        price_max: 2990,
      };
}
function cart(state: { quantity: number; variant: number; mode: string }) {
  const quantity = state.mode === 'bad-quantity' && state.quantity === 2 ? 1 : state.quantity;
  const amount = quantity * 2990 + (state.mode === 'bad-amount' && quantity === 2 ? 100 : 0);
  const id = state.mode === 'wrong-variant' ? 99 : state.variant;
  return woo
    ? {
        items: quantity
          ? [
              {
                id,
                key: 'line-key',
                quantity,
                totals: {
                  line_subtotal: String(amount),
                  line_subtotal_tax: '0',
                  line_total: String(amount),
                  line_total_tax: '0',
                  currency_code: 'EUR',
                  currency_minor_unit: 2,
                },
              },
            ]
          : [],
        coupons: [],
      }
    : {
        currency: 'EUR',
        items: quantity
          ? [
              {
                variant_id: id,
                quantity,
                original_price: 2990,
                original_line_price: amount,
                final_price: 2990,
                final_line_price: amount,
              },
            ]
          : [],
      };
}
function eventScript(stage: string, quantity = 1, mode = 'good') {
  const event = {
    event: stage,
    ecommerce: {
      value: quantity * 29.9,
      currency: mode === 'analytics-currency' ? 'USD' : 'EUR',
      items: [{ item_id: '10', price: 29.9, quantity }],
    },
  };
  if (mode === 'analytics-missing') return '';
  const push = `window.dataLayer=window.dataLayer||[];window.dataLayer.push(${JSON.stringify(event)});`;
  return push + (mode === 'analytics-duplicate' ? push : '');
}
const shell = (body: string) =>
  `<!doctype html><html lang="en"><head><title>Journey fixture</title></head><body><main>${body}</main><script>window.Shopify={routes:{root:'/en/'}}</script></body></html>`;
test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url!, origin);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    seen.push(`${req.method} ${url.pathname}`);
    const cookie = req.headers.cookie?.match(/journey=([a-z0-9-]+)/)?.[1] || randomUUID();
    if (!sessions.has(cookie)) sessions.set(cookie, { quantity: 0, mode: 'good', variant: 11 });
    const state = sessions.get(cookie)!;
    res.setHeader('Set-Cookie', `journey=${cookie}; Path=/; SameSite=Lax`);
    const json = (body: unknown) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/case') {
      state.mode = url.searchParams.get('mode') || 'good';
      res.end(shell('Ready'));
      return;
    }
    if (url.pathname.startsWith('/wp/wp-json/wc/store/v1/products/')) {
      json(product(Number(url.pathname.split('/').at(-1)), state.mode));
      return;
    }
    if (url.pathname.endsWith('/products/sample.js')) {
      json(product(10, state.mode));
      return;
    }
    const isCartApi =
      url.pathname === '/en/cart.js' || url.pathname === '/wp/wp-json/wc/store/v1/cart';
    if (isCartApi) {
      if (woo) res.setHeader('Cart-Token', cookie);
      json(cart(state));
      return;
    }
    if (
      url.pathname === '/en/cart/clear.js' ||
      (url.pathname === '/wp/wp-json/wc/store/v1/cart/items' && req.method === 'DELETE')
    ) {
      if (woo && req.headers['cart-token'] !== cookie) {
        res.statusCode = 403;
        json({});
        return;
      }
      state.quantity = 0;
      json(woo ? [] : cart(state));
      return;
    }
    if (url.pathname === '/ui-add' || url.pathname === '/ui-quantity') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body);
      if (url.pathname === '/ui-add') state.variant = Number(data.id);
      state.quantity = Number(data.quantity);
      json({});
      return;
    }
    if (url.pathname === productPath) {
      const attributes = JSON.stringify([
        {
          variation_id: 11,
          attributes: { attribute_size: 'large' },
          is_purchasable: true,
          is_in_stock: true,
        },
      ]).replaceAll('"', '&quot;');
      const form = woo
        ? state.mode === 'simple'
          ? '<form class="cart"><button type="button" name="add-to-cart" value="10" class="single_add_to_cart_button">Add</button>'
          : `<form class="cart variations_form" data-product_variations="${attributes}"><select name="attribute_size"><option value="">Choose</option><option value="large">Large</option></select><input name="variation_id" value="0"><button type="button" name="add-to-cart" value="10" class="single_add_to_cart_button">Add</button>`
        : `<form action="/en/cart/add"><select name="id">${state.mode === 'simple' ? '' : '<option value="12">Small</option>'}<option value="11">${state.mode === 'simple' ? 'Default Title' : 'Large'}</option></select><button type="button" name="add">Add</button>`;
      res.end(
        shell(
          `<div data-woo-product data-product-root><h1>Journey product</h1><span data-product-price data-woo-price>${money(state.mode === 'ui-price' ? 3090 : 2990)}</span>${form}<input name="quantity" type="number" min="1" value="1"></form></div><script>${eventScript('view_item', 1, state.mode)}const picker=document.querySelector('select');if(picker)picker.onchange=()=>{const field=document.querySelector('[name=variation_id]');if(field)field.value='11'};document.querySelector('button').onclick=async()=>{await fetch('/ui-add',{method:'POST',body:JSON.stringify({id:document.querySelector('[name=variation_id]')?.value||document.querySelector('[name=id]')?.value||document.querySelector('[name=add-to-cart]').value,quantity:1})});${eventScript('add_to_cart', 1, state.mode)}};</script>`,
        ),
      );
      return;
    }
    if (url.pathname === prefix + '/search' || (woo && url.pathname === '/wp/')) {
      const name = woo ? 's' : 'q';
      const result =
        url.searchParams.get(name) && state.mode !== 'search-missing'
          ? `<a href="${productPath}">Journey product</a>`
          : '';
      res.end(
        shell(`<form><input type="search" name="${name}"><button>Search</button></form>${result}`),
      );
      return;
    }
    if (url.pathname === prefix + '/cart') {
      res.end(
        shell(
          `<div class="cart-item" data-woo-cart-item>Journey product Large<input type="number" name="updates[]" value="${state.quantity}" max="${state.mode === 'max-one' ? 1 : 5}"><span data-cart-item-price data-woo-cart-price>${money(2990)}</span><span data-cart-item-total data-woo-cart-subtotal>${money(state.quantity * 2990)}</span></div><a href="${prefix}/checkout">Checkout</a><script>document.querySelector('input').onchange=async event=>{await fetch('/ui-quantity',{method:'POST',body:JSON.stringify({quantity:Number(event.target.value)})});document.querySelector('[data-cart-item-total]').textContent='€'+(Number(event.target.value)*29.9).toFixed(2)};</script>`,
        ),
      );
      return;
    }
    if (url.pathname === prefix + '/checkout') {
      const automaticOrder =
        state.mode === 'automatic-order'
          ? '<script>fetch("/?wc-ajax=checkout",{method:"POST"}).catch(()=>{})</script>'
          : '';
      res.end(
        shell(
          state.mode === 'checkout-hidden'
            ? 'Checkout is protected'
            : `<form class="checkout"><input type="email"><div data-checkout-line-item>Journey product Large<span data-checkout-quantity>${state.mode === 'checkout-quantity' ? 1 : state.quantity}</span><span data-checkout-line-price>${money(state.quantity * 2990 + (state.mode === 'checkout-price' ? 100 : 0))}</span></div><select id="country"><option value="">Choose</option><option value="BG">Bulgaria</option></select><input id="postal"><input type="radio" id="standard" name="shipping-method"><span id="subtotal">€59.80</span><span id="shipping">${state.mode === 'shipping-fee' ? '€5.00' : '€0.00'}</span><span id="tax">€0.00</span><span id="discount">€0.00</span><span id="total">${state.mode === 'wrong-total' ? '€60.80' : '€59.80'}</span><button>Place order</button></form><script>${eventScript('begin_checkout', 2, state.mode)}</script>${automaticOrder}`,
        ),
      );
      return;
    }
    res.statusCode = 404;
    res.end('Missing');
  });
  await new Promise<void>(resolve => server.listen(45993, '127.0.0.1', resolve));
});
test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
});
const inventory: InventoryPage[] = [
  { url: origin + productPath, handle: 'sample', type: 'product', language: 'en' },
];
for (const [mode, expectedStage, unverified] of [
  ['good', '', false],
  ['simple', '', false],
  ['unavailable', 'plan', true],
  ['ui-price', 'variant', false],
  ['search-missing', 'search', false],
  ['wrong-variant', 'add', false],
  ['bad-quantity', 'quantity', false],
  ['bad-amount', 'quantity', false],
  ['checkout-quantity', 'checkout', false],
  ['checkout-price', 'checkout', false],
  ['checkout-hidden', 'checkout', true],
  ['max-one', 'quantity', true],
  ['automatic-order', 'checkout', true],
  ['shipping-fee', 'checkout-totals', false],
  ['wrong-total', 'checkout-totals', false],
  ['analytics-missing', 'variant', false],
  ['analytics-duplicate', 'variant', false],
  ['analytics-currency', 'variant', false],
] as const) {
  test(`journey ${mode}`, async ({ page }, info) => {
    const start = seen.length;
    await page.goto(origin + '/case?mode=' + mode);
    let failure: unknown;
    try {
      await runBuyerJourney(page, info, inventory);
    } catch (error) {
      failure = error;
    }
    if (expectedStage) expect(Boolean(failure)).toBe(true);
    else expect(failure).toBeUndefined();
    if (unverified) expect(failure).toBeInstanceOf(CommerceUnverified);
    const evidence = JSON.parse(
      info.attachments.find(item => item.name === 'buyer-journey.json')!.body!.toString(),
    );
    expect(evidence.failedStep).toBe(expectedStage || null);
    expect(evidence.status).toBe(expectedStage ? (unverified ? 'unverified' : 'failed') : 'passed');
    const requests = seen.slice(start);
    expect(requests.some(request => /POST.*(checkout|order|pay)/i.test(request))).toBe(false);
    expect(
      requests.some(request => (woo ? request.includes('/en/') : request.includes('/wp/'))),
    ).toBe(false);
    expect([...sessions.values()].every(session => session.quantity === 0)).toBe(true);
  });
}

for (const mismatch of ['none', 'language', 'currency', 'price'] as const) {
  test(`market journey ${mismatch}`, async ({ page }, info) => {
    const market = {
      name: 'Bulgaria',
      path: '/case?mode=good',
      locale: 'en-US',
      language: mismatch === 'language' ? 'bg' : 'en',
      currency: mismatch === 'currency' ? 'USD' : 'EUR',
      unitPrice: mismatch === 'price' ? 3000 : 2990,
      checkoutTotals: readSiteSettings().checkoutTotals!,
    };
    let failure: unknown;
    try {
      await runBuyerJourney(page, info, inventory, market);
    } catch (error) {
      failure = error;
    }
    expect(Boolean(failure)).toBe(mismatch !== 'none');
    const evidence = JSON.parse(
      info.attachments.find(item => item.name === 'buyer-journey.json')!.body!.toString(),
    );
    expect(evidence.market).toBe('Bulgaria');
    if (mismatch === 'none')
      expect(
        evidence.steps.find((step: { name: string }) => step.name === 'checkout-totals').actual
          .total,
      ).toBe(5980);
  });
}
