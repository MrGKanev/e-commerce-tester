import { test, expect } from '../tests/fixtures';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { auditWooCommerce, wooSession } from '../tests/platforms/woocommerce';
import { CommerceUnverified } from '../scripts/storefront-model';
import { prepareInventory, pageInventory } from '../tests/inventory';
import setup, { STORAGE_STATE } from '../config/global-setup';
import teardown from '../config/global-teardown';
import type { TestInfo } from '@playwright/test';

const origin = 'http://127.0.0.1:45991',
  api = '/wp/wp-json/wc/store/v1';
let server: Server;
const requests: string[] = [];
let orders = 0;
let deletions = 0;
type State = { handle: string; id: number | null; nonce: string };
const states = new Map<string, State>();
const handles: Record<string, number> = {
  simple: 10,
  variable: 20,
  ajax: 21,
  blocks: 30,
  token: 31,
  'race-token': 32,
  nonce: 40,
  including: 50,
  excluding: 51,
  unknown: 52,
  yen: 60,
  bhd: 61,
  backorder: 70,
  unavailable: 71,
  wrongcart: 80,
  wrongprice: 81,
  denied: 90,
};
const reverse = Object.fromEntries(Object.entries(handles).map(([name, id]) => [id, name]));
function product(id: number) {
  const handle = reverse[id] || 'variable',
    currency = handle === 'yen' ? 'JPY' : handle === 'bhd' ? 'BHD' : 'EUR',
    precision = handle === 'yen' ? 0 : handle === 'bhd' ? 3 : 2;
  const price =
    handle === 'yen'
      ? 1000
      : handle === 'bhd'
        ? 1234
        : id === 202
          ? 2400
          : ['including', 'excluding', 'unknown'].includes(handle)
            ? 1200
            : 1200;
  return {
    id,
    name:
      id > 200
        ? 'Shirt ' + (id === 201 ? 'Small' : 'Large')
        : [20, 21].includes(id)
          ? 'Shirt'
          : 'Fixture ' + handle,
    slug: handle,
    permalink: origin + '/wp/goods/' + handle + '/',
    type: [20, 21].includes(id) ? 'variable' : id > 200 ? 'variation' : 'simple',
    has_options: [20, 21].includes(id),
    sku: 'sku-' + id,
    is_purchasable: true,
    is_in_stock: ![70, 71, 203].includes(id),
    backorders_allowed: id === 70,
    prices: {
      price: String(price),
      regular_price: String(price + 100),
      currency_code: currency,
      currency_minor_unit: precision,
      currency_decimal_separator: '.',
      price_range: [20, 21].includes(id) ? { min_amount: '1200', max_amount: '2400' } : null,
    },
  };
}
const variations = [
  {
    variation_id: 201,
    attributes: { attribute_pa_size: 'small' },
    is_purchasable: true,
    is_in_stock: true,
    display_price: 12,
    sku: 'sku-201',
  },
  {
    variation_id: 202,
    attributes: { attribute_pa_size: 'large' },
    is_purchasable: true,
    is_in_stock: true,
    display_price: 24,
    sku: 'sku-202',
  },
  {
    variation_id: 203,
    attributes: { attribute_pa_size: 'unavailable' },
    is_purchasable: true,
    is_in_stock: false,
    display_price: 12,
    sku: 'sku-203',
  },
];
function formatted(value: number, handle: string) {
  const p = product(handles[handle]);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: p.prices.currency_code,
  }).format(value / 10 ** p.prices.currency_minor_unit);
}
function cart(state: State) {
  const p = state.id ? product(state.id) : product(handles[state.handle]),
    taxed = ['including', 'excluding', 'unknown'].includes(state.handle),
    subtotal = taxed ? 1000 : Number(p.prices.price),
    tax = taxed ? 200 : 0;
  const selected = state.handle === 'wrongcart' ? 11 : state.id;
  return {
    items: state.id
      ? [
          {
            id: selected,
            key: 'cart-key',
            quantity: 1,
            name: p.name,
            variation:
              state.id > 200
                ? [{ attribute: 'Size', value: state.id === 201 ? 'small' : 'large' }]
                : [],
            prices: { ...p.prices, raw_prices: { precision: 6, price: '12000000' } },
            totals: {
              line_subtotal: String(subtotal),
              line_subtotal_tax: String(tax),
              line_total: String(subtotal - 100),
              line_total_tax: String(tax ? 180 : 0),
              currency_code: p.prices.currency_code,
              currency_minor_unit: p.prices.currency_minor_unit,
            },
          },
        ]
      : [],
    coupons: state.id ? [{ code: 'fixture-coupon' }] : [],
    totals: {
      currency_code: p.prices.currency_code,
      currency_minor_unit: p.prices.currency_minor_unit,
    },
  };
}
function productHtml(handle: string, key: string) {
  const id = handles[handle],
    p = product(id),
    block = ['blocks', 'token'].includes(handle),
    variable = [20, 21].includes(id);
  const contextToken = ['token', 'race-token'].includes(handle) ? 'frontend-' + key : key;
  if (['token', 'race-token'].includes(handle) && !states.has(contextToken))
    states.set(contextToken, { handle, id: 10, nonce: 'nonce-' + contextToken });
  const offers = variable
    ? variations.map(v => ({
        '@type': 'Offer',
        sku: v.sku,
        price: v.display_price,
        priceCurrency: 'EUR',
      }))
    : {
        '@type': 'Offer',
        sku: p.sku,
        price: Number(p.prices.price) / 10 ** p.prices.currency_minor_unit,
        priceCurrency: p.prices.currency_code,
      };
  return `<html lang="en"><head><meta charset="utf-8"><title>${p.name}</title></head><body><main><div class="product"><h1>${p.name}</h1><div class="summary"><p class="price"><ins><span class="amount">${formatted(Number(p.prices.price), handle)}</span></ins></p></div>
 <form class="cart ${variable ? 'variations_form' : ''}" data-product_id="${id}" ${variable ? `data-product_variations='${handle === 'ajax' ? 'false' : JSON.stringify(variations)}'` : ''}>
 ${variable ? '<select name="attribute_pa_size" aria-label="Size"><option value="">Choose</option><option value="small">Small</option><option value="large">Large</option><option value="unavailable">Unavailable</option></select><input name="variation_id" type="hidden" value="0"><div class="single_variation"><p class="price"><span class="amount"></span></p><div class="woocommerce-variation-availability"></div></div>' : ''}
 <input name="quantity" class="qty" value="1" min="1" aria-label="Quantity"><button ${block ? 'data-woo-add-to-cart data-wp-context=\'{"productId":' + id + "}'" : 'class="single_add_to_cart_button"'} name="add-to-cart" value="${id}" ${id === 71 ? 'disabled' : ''}>Add to cart</button></form>
 ${id === 71 ? '<p class="stock out-of-stock">Out of stock</p>' : id === 70 ? '<p class="stock available-on-backorder">Available on backorder</p>' : ''}
 </div></main><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: p.name, url: p.permalink, offers })}</script><script>
 const form=document.querySelector('form'),button=form.querySelector('button'),token=${JSON.stringify('secret-cart-token-' + contextToken)};
 ${handle === 'token' ? `fetch('${api}/cart',{headers:{'Cart-Token':token}});` : ''}
 ${handle === 'race-token' ? `setTimeout(()=>fetch('${api}/cart',{headers:{'Cart-Token':token}}),80);` : ''}
 const picker=form.querySelector('select');if(picker)picker.onchange=async()=>{const map={small:201,large:202,unavailable:203};let chosen=map[picker.value];${handle === 'ajax' ? `const response=await fetch('/wp/?wc-ajax=get_variation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({size:picker.value})});chosen=(await response.json()).variation_id;` : ''}form.querySelector('[name="variation_id"]').value=String(chosen||0);button.disabled=chosen===203||!chosen;document.querySelector('.single_variation .amount').textContent=chosen===202?'€24.00':'€12.00';document.querySelector('.woocommerce-variation-availability').textContent=chosen===203?'Out of stock':'In stock';};
 form.onsubmit=async(event)=>{event.preventDefault();const selected=Number(form.querySelector('[name="variation_id"]')?.value||button.value);await fetch(${JSON.stringify(block ? api + '/cart/add-item' : '/wp/?wc-ajax=add_to_cart')},{method:'POST',headers:{'Content-Type':'application/json',${block ? "'Cart-Token':token" : ''}},body:JSON.stringify({id:selected,quantity:Number(form.querySelector('[name="quantity"]').value)})});};
 </script></body></html>`;
}
function cartHtml(state: State, key: string) {
  const id = state.id || handles[state.handle],
    p = product(id),
    taxed = ['including', 'excluding', 'unknown'].includes(state.handle),
    including = state.handle !== 'excluding';
  const value = taxed ? (including ? 1200 : 1000) : Number(p.prices.price),
    block = ['blocks', 'token'].includes(state.handle);
  const price = state.handle === 'wrongprice' ? value + 100 : value;
  return `<html><head><meta charset="utf-8"><title>Cart</title></head><body><main><h1>Cart</h1>${state.id ? `<div ${block ? 'class="wc-block-cart-items__row"' : 'class="woocommerce-cart-form"'}>${block ? '' : '<div class="cart_item">'}<span>${p.name}</span><span data-woo-cart-price>${formatted(price, state.handle)}</span><span data-woo-cart-subtotal>${formatted(value, state.handle)}</span>${block ? '' : '</div>'}</div>` : 'Empty cart'}</main><script>window.wcSettings=${state.handle === 'unknown' ? '{}' : JSON.stringify({ displayCartPricesIncludingTax: including })};</script></body></html>`;
}
function evidence(info: TestInfo) {
  const a = info.attachments.filter(a => a.name === 'commerce-consistency.json').at(-1)!;
  return JSON.parse(fs.readFileSync(a.path!, 'utf8'));
}
test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url!, origin);
    requests.push(`${req.method} ${url.pathname}`);
    let key = /woo_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
    if (!key) {
      key = randomUUID();
      res.setHeader('Set-Cookie', `woo_session=${key}; Path=/; HttpOnly; SameSite=Lax`);
    }
    if (!states.has(key)) states.set(key, { handle: 'simple', id: null, nonce: 'nonce-' + key });
    let state = states.get(key)!;
    const token = req.headers['cart-token'];
    if (typeof token === 'string') {
      key = token.replace(/^secret-cart-token-/, '');
      if (!states.has(key)) {
        res.statusCode = 403;
        res.end('{}');
        return;
      }
      state = states.get(key)!;
    }
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname.startsWith(api + '/products/')) {
      const id = Number(url.pathname.split('/').at(-1));
      if (id === 90) {
        res.statusCode = 403;
        res.end('{}');
        return;
      }
      res.end(JSON.stringify(product(id)));
      return;
    }
    if (url.pathname === api + '/products') {
      res.end(JSON.stringify([product(10), product(20)]));
      return;
    }
    if (url.pathname === api + '/cart' || url.pathname === api + '/cart/items') {
      if (state.handle === 'race-token' && !token)
        await new Promise(resolve => setTimeout(resolve, 180));
      if (state.handle === 'nonce') res.setHeader('Nonce', state.nonce);
      else res.setHeader('Cart-Token', 'secret-cart-token-' + key);
      if (req.method === 'DELETE') {
        deletions++;
        if (!token && req.headers.nonce !== state.nonce) {
          res.statusCode = 403;
          res.end('{}');
          return;
        }
        state.id = null;
        res.end('[]');
        return;
      }
      res.end(JSON.stringify(cart(state)));
      return;
    }
    if (url.searchParams.get('wc-ajax') === 'get_variation' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const value = JSON.parse(body);
      res.end(
        JSON.stringify({
          variation_id: ({ small: 201, large: 202, unavailable: 203 } as Record<string, number>)[
            value.size
          ],
        }),
      );
      return;
    }
    if (
      (url.pathname === api + '/cart/add-item' ||
        url.searchParams.get('wc-ajax') === 'add_to_cart') &&
      req.method === 'POST'
    ) {
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body);
      state.id = data.id;
      res.end(JSON.stringify(cart(state)));
      return;
    }
    if (url.pathname.includes('/checkout') && req.method === 'POST') {
      orders++;
      res.statusCode = 500;
      res.end('{}');
      return;
    }
    const match = /^\/wp\/goods\/([^/]+)\/$/.exec(url.pathname);
    if (match) {
      state.handle = match[1];
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(productHtml(state.handle, key));
      return;
    }
    if (url.pathname === '/wp/basket/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      const visible = state.handle === 'token' ? states.get('frontend-' + key)! : state;
      res.end(cartHtml(visible, key));
      return;
    }
    if (url.pathname === '/wp/pay/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(
        '<html><title>Checkout</title><main><div class="wc-block-checkout"><input type="email" aria-label="Email"><button id="place-order">Place order</button></div></main></html>',
      );
      return;
    }
    if (['/wp', '/wp/', '/wp/catalog/'].includes(url.pathname)) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(
        `<html lang="en"><head><title>Woo fixture</title><link rel="canonical" href="${origin}/wp/"></head><body><main><h1>Woo fixture</h1><a href="/wp/goods/simple/">Product</a></main></body></html>`,
      );
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>(resolve => server.listen(45991, '127.0.0.1', resolve));
});
test.afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(STORAGE_STATE, { force: true });
  expect(
    requests.some(req => /\/cart(?:\/add|\/clear)?\.js|\/products\.json|\/collections\//.test(req)),
  ).toBe(false);
  expect(orders).toBe(0);
});
test('WooCommerce global lifecycle/inventory never calls Shopify endpoints', async ({
  request,
}) => {
  await setup();
  await teardown();
  await prepareInventory(request);
  expect(
    pageInventory()
      .filter(entry => entry.type === 'product')
      .map(entry => entry.url),
  ).toEqual([origin + '/wp/goods/simple/', origin + '/wp/goods/variable/']);
});
for (const handle of [
  'simple',
  'variable',
  'ajax',
  'blocks',
  'token',
  'nonce',
  'including',
  'excluding',
  'yen',
  'bhd',
])
  test(`WooCommerce price/cart session: ${handle}`, async ({ page }, info) => {
    await auditWooCommerce(page, info, origin + '/wp/goods/' + handle + '/', 'price');
    expect(evidence(info).status).toBe('passed');
    expect((await wooSession(page).cart()).items).toEqual([]);
  });
for (const handle of ['simple', 'variable'])
  test(`WooCommerce JSON-LD: ${handle}`, async ({ page }, info) => {
    await auditWooCommerce(page, info, origin + '/wp/goods/' + handle + '/', 'schema');
    expect(evidence(info).status).toBe('passed');
  });
test('permitted WooCommerce backorder is available and can be added', async ({ page }, info) => {
  await auditWooCommerce(page, info, origin + '/wp/goods/backorder/', 'available');
  expect(evidence(info).status).toBe('passed');
});
for (const handle of ['unavailable', 'variable'])
  test(`WooCommerce unavailable UI: ${handle}`, async ({ page }, info) => {
    await auditWooCommerce(page, info, origin + '/wp/goods/' + handle + '/', 'unavailable');
    expect(evidence(info).status).toBe('passed');
  });
test('WooCommerce checkout readiness stops before submitting an order', async ({ page }, info) => {
  await auditWooCommerce(page, info, origin + '/wp/goods/simple/', 'checkout');
  expect(evidence(info).status).toBe('passed');
});
for (const handle of ['wrongcart', 'wrongprice'])
  test(`WooCommerce mismatch is a real failure: ${handle}`, async ({ page }, info) => {
    await expect(
      auditWooCommerce(page, info, origin + '/wp/goods/' + handle + '/', 'price'),
    ).rejects.toThrow();
    expect(evidence(info).status).toBe('failed');
  });
for (const handle of ['unknown', 'denied'])
  test(`WooCommerce unverified evidence: ${handle}`, async ({ page }, info) => {
    await expect(
      auditWooCommerce(page, info, origin + '/wp/goods/' + handle + '/', 'price'),
    ).rejects.toBeInstanceOf(CommerceUnverified);
    expect(evidence(info).status).toBe('unverified');
  });
test('a frontend token change during a cart read cannot clear the unrelated cookie cart', async ({
  page,
}, info) => {
  const before = deletions;
  await expect(
    auditWooCommerce(page, info, origin + '/wp/goods/race-token/', 'price'),
  ).rejects.toBeInstanceOf(CommerceUnverified);
  expect(evidence(info).status).toBe('unverified');
  expect(deletions).toBe(before);
});
