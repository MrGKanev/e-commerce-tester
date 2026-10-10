import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { test, expect } from '../tests/fixtures';
import { auditCommerce } from '../tests/commerce-consistency';
import { CommerceUnverified } from '../scripts/commerce-model';
import type { TestInfo } from '@playwright/test';

let server: Server;
const requests: string[] = [];
type Session = { handle: string; items: unknown[]; changed: boolean };
const sessions = new Map<string, Session>();
const currency = (handle: string) => (handle === 'yen' ? 'JPY' : 'EUR');
function product(handle: string, changed = false) {
  const base = handle === 'yen' ? 100000 : 2990;
  const variants = [
    {
      id: 100,
      title: 'Small',
      options: ['Small'],
      price: base + (handle === 'price-race' && changed ? 100 : 0),
      compare_at_price: base + 1000,
      available: !(handle === 'race' && changed),
      sku: 'small',
    },
    {
      id: 101,
      title: 'Large',
      options: ['Large'],
      price: base + 2000,
      compare_at_price: null,
      available: true,
      sku: 'large',
    },
    {
      id: 102,
      title: 'Unavailable',
      options: ['Unavailable'],
      price: base,
      compare_at_price: null,
      available: false,
      sku: 'unavailable',
    },
  ];
  return {
    id: 10,
    title: 'Fixture product',
    handle,
    options: ['Size'],
    variants,
    requires_selling_plan: handle === 'subscription-only',
    price_min: base,
    price_max: base + 2000,
  };
}
function money(amount: number, handle: string) {
  return new Intl.NumberFormat('bg-BG', { style: 'currency', currency: currency(handle) }).format(
    amount / 100,
  );
}
function html(handle: string) {
  const data = product(handle),
    offers =
      handle === 'range'
        ? {
            '@type': 'AggregateOffer',
            priceCurrency: currency(handle),
            lowPrice: data.price_min / 100,
            highPrice: data.price_max / 100,
          }
        : handle === 'ambiguous'
          ? { '@type': 'Offer', price: 29.9, priceCurrency: 'EUR' }
          : data.variants.map(variant => ({
              '@type': 'Offer',
              priceCurrency: handle === 'schema-currency' ? 'USD' : currency(handle),
              price: handle === 'schema-wrong' ? 1 : variant.price / 100,
              url: `http://127.0.0.1:45990/fr/products/${handle}?variant=${variant.id}`,
            }));
  const controls =
    handle === 'radios'
      ? `<input type="hidden" name="id" value="100">${data.variants.map(variant => `<input id="size-${variant.id}" type="radio" name="Size-1" value="${variant.options[0]}" ${variant.id === 100 ? 'checked' : ''} ${!variant.available ? 'disabled' : ''}><label for="size-${variant.id}">${variant.title}</label>`).join('')}`
      : handle === 'option-select'
        ? `<input type="hidden" name="id" value="100"><variant-selects><select name="options[Size]" aria-label="Size">${data.variants.map(variant => `<option value="${variant.options[0]}" ${!variant.available ? 'disabled' : ''}>${variant.title}</option>`).join('')}</select></variant-selects>`
        : `<select name="id" aria-label="Size">${data.variants.map(variant => `<option value="${variant.id}" ${!variant.available && handle !== 'unavailable-enabled' && handle !== 'unavailable-selected' ? 'disabled' : ''}>${variant.title}</option>`).join('')}</select>`;
  return `<html lang="bg"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main><product-info style="display:block">
  <h1>Fixture product</h1><div class="price price--on-sale"><div class="price__regular" hidden><span class="price-item--regular">Wrong hidden regular price</span></div>
  <div class="price__sale"><s id="compare">${money(data.variants[0].compare_at_price!, handle)}</s><span class="price-item--sale" id="price">${money(data.variants[0].price, handle)}</span></div></div>
  <form action="/fr/cart/add">${controls}${handle === 'selling-plan' ? '<input name="selling_plan" value="10" type="hidden">' : ''}<input name="quantity" value="1" aria-label="Quantity"><button name="add" type="submit">Add to cart</button></form>
  </product-info></main><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: data.title, offers })}</script><script>
  window.Shopify={routes:{root:'/fr/'}};
  const variants=${JSON.stringify(data.variants)}, handle=${JSON.stringify(handle)};
  const form=document.querySelector('form'), select=form.querySelector('[name="id"]'), button=form.querySelector('button');
  function render(){const v=variants.find(v=>String(v.id)===select.value);setTimeout(()=>{
    document.getElementById('price').textContent=handle==='stale-price' ? ${JSON.stringify(money(data.variants[0].price, handle))} : new Intl.NumberFormat('bg-BG',{style:'currency',currency:handle==='ui-currency'?'USD':${JSON.stringify(currency(handle))}}).format(v.price/100);
    const compare=document.getElementById('compare');compare.hidden=!v.compare_at_price; if(v.compare_at_price)compare.textContent=new Intl.NumberFormat('bg-BG',{style:'currency',currency:${JSON.stringify(currency(handle))}}).format(v.compare_at_price/100);
    button.disabled=!v.available && handle!=='unavailable-enabled';button.textContent=v.available||handle==='unavailable-enabled'?'Add to cart':'Sold out';
  },40);}
  select.onchange=render;
  document.querySelectorAll('[name="Size-1"]').forEach(input=>input.onchange=()=>{select.value=String(variants.find(v=>v.options[0]===input.value).id);render();});
  const optionSelect=form.querySelector('variant-selects select'); if(optionSelect)optionSelect.onchange=()=>{select.value=String(variants.find(v=>v.options[0]===optionSelect.value).id);render();};
  if(handle==='unavailable-selected'){select.value='102';render();}
  form.onsubmit=async e=>{e.preventDefault();await fetch('/fr/cart/add.js',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:Number(select.value),quantity:Number(form.querySelector('input[name="quantity"]').value)})});};
  </script></body></html>`;
}
function report(info: TestInfo) {
  const attachment = info.attachments
    .filter(item => item.name === 'commerce-consistency.json')
    .at(-1)!;
  return JSON.parse(attachment.body?.toString() || fs.readFileSync(attachment.path!, 'utf8'));
}
test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    const url = new URL(request.url!, 'http://127.0.0.1:45990');
    requests.push(`${request.method} ${url.pathname}`);
    let key = /commerce_session=([^;]+)/.exec(request.headers.cookie || '')?.[1];
    if (!key) {
      key = randomUUID();
      response.setHeader('Set-Cookie', `commerce_session=${key}; Path=/; HttpOnly; SameSite=Lax`);
    }
    if (!sessions.has(key)) sessions.set(key, { handle: 'plain', items: [], changed: false });
    const state = sessions.get(key)!;
    response.setHeader('Content-Type', 'application/json');
    const match =
      /^\/fr\/products\/([^/.]+)(\.js)?$/.exec(url.pathname) ||
      /^\/products\/([^/.]+)$/.exec(url.pathname);
    if (match) {
      state.handle = match[1];
      if (match[2]) return response.end(JSON.stringify(product(state.handle, state.changed)));
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      return response.end(html(state.handle));
    }
    if (url.pathname === '/fr/cart/clear.js') {
      state.items = [];
      return response.end('{}');
    }
    if (url.pathname === '/fr/cart/add.js') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const added = JSON.parse(body);
      if (state.handle === 'race') {
        state.changed = true;
        response.statusCode = 422;
        return response.end('{"description":"Now sold out"}');
      }
      const data = product(state.handle),
        variant = data.variants.find(
          variant => variant.id === (state.handle === 'wrong-variant' ? 101 : added.id),
        )!;
      const discount = ['discount', 'undocumented-discount', 'bad-allocation'].includes(
        state.handle,
      )
        ? 500
        : 0;
      const final = variant.price - discount;
      state.items = [
        {
          variant_id: variant.id,
          quantity: state.handle === 'wrong-quantity' ? 2 : added.quantity,
          original_price: variant.price,
          original_line_price: variant.price,
          final_price: final,
          final_line_price: final,
          line_level_discount_allocations:
            discount && state.handle !== 'undocumented-discount'
              ? [{ amount: state.handle === 'bad-allocation' ? 400 : discount }]
              : [],
          title: data.title,
          variant_title: variant.title,
        },
      ];
      if (state.handle === 'price-race') state.changed = true;
      return response.end(JSON.stringify(state.items[0]));
    }
    if (url.pathname === '/fr/cart.js')
      return response.end(
        JSON.stringify({
          currency:
            state.handle === 'currency-race' && state.items.length ? 'USD' : currency(state.handle),
          items: state.items,
          cart_level_discount_applications:
            state.handle === 'discount'
              ? [{ title: 'Order discount', total_allocated_amount: 100 }]
              : [],
        }),
      );
    if (url.pathname === '/fr/cart') {
      const line = state.items[0] as
        | { title: string; variant_title: string; final_price: number; final_line_price: number }
        | undefined;
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      return response.end(
        `<html><body><main>${line ? `<div class="cart-item">${line.title} ${line.variant_title}<span data-cart-item-price>${money(line.final_price, state.handle)}</span><span data-cart-item-total>${money(state.handle === 'wrong-cart-ui' ? line.final_line_price + 100 : line.final_line_price, state.handle)}</span></div>` : 'Empty cart'}</main></body></html>`,
      );
    }
    response.statusCode = 404;
    response.end('{}');
  });
  await new Promise<void>(resolve => server.listen(45990, '127.0.0.1', resolve));
});
test.afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  expect(requests.every(request => !/\/admin|\/api\//.test(request))).toBe(true);
});

for (const handle of ['plain', 'discount', 'yen', 'radios', 'option-select']) {
  test(`price consistency: ${handle} verifies selected variants, cart UI and session currency`, async ({
    page,
  }, info) => {
    await auditCommerce(page, info, handle, 'price');
    const evidence = report(info);
    expect(evidence.status).toBe('passed');
    expect(evidence.observations.filter((item: { cart?: unknown }) => item.cart)).toHaveLength(2);
    const cart = await page.context().request.get('http://127.0.0.1:45990/fr/cart.js');
    expect((await cart.json()).items).toEqual([]);
  });
}
for (const handle of ['plain', 'range']) {
  test(`JSON-LD consistency: ${handle} associates offers correctly`, async ({ page }, info) => {
    await auditCommerce(page, info, handle, 'schema');
    expect(report(info).status).toBe('passed');
  });
}
test('available variant is added through the actual UI', async ({ page }, info) => {
  await auditCommerce(page, info, 'plain', 'available');
  expect(report(info).status).toBe('passed');
});
for (const handle of ['plain', 'unavailable-selected']) {
  test(`unavailable variant is blocked: ${handle}`, async ({ page }, info) => {
    await auditCommerce(page, info, handle, 'unavailable');
    expect(report(info).status).toBe('passed');
  });
}
for (const [handle, kind, reason] of [
  ['stale-price', 'price', /UI price did not update/],
  ['ui-currency', 'price', /UI price did not update/],
  ['wrong-variant', 'price', /exactly the selected variant/],
  ['wrong-quantity', 'price', /quantity/],
  ['wrong-cart-ui', 'price', /Cart UI line total/],
  ['bad-allocation', 'price', /discount allocations/],
  ['schema-wrong', 'schema', /JSON-LD price/],
  ['schema-currency', 'schema', /JSON-LD currency/],
  ['unavailable-enabled', 'unavailable', /still allows purchase/],
] as const) {
  test(`real inconsistency fails: ${handle}`, async ({ page }, info) => {
    await expect(auditCommerce(page, info, handle, kind)).rejects.toThrow(reason);
    expect(report(info).status).toBe('failed');
  });
}
for (const [handle, kind] of [
  ['ambiguous', 'schema'],
  ['race', 'available'],
  ['undocumented-discount', 'price'],
  ['selling-plan', 'price'],
  ['subscription-only', 'price'],
  ['price-race', 'price'],
  ['currency-race', 'price'],
] as const) {
  test(`incomplete evidence remains unverified: ${handle}`, async ({ page }, info) => {
    await expect(auditCommerce(page, info, handle, kind)).rejects.toBeInstanceOf(
      CommerceUnverified,
    );
    expect(report(info).status).toBe('unverified');
  });
}
