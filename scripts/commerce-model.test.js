'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMoney, schemaPrice, cartPrice, CommerceUnverified } = require('./commerce-model');
const variants = [
  { id: 1, price: 2990, available: true, options: ['Small'], sku: 'small' },
  { id: 2, price: 4990, available: true, options: ['Large'], sku: 'large' },
];
const product = {
  title: 'Test product',
  handle: 'test',
  variants,
  price_min: 2990,
  price_max: 4990,
};
const url = 'https://example.test/fr/products/test';
test('money parsing handles localized separators, grouping, zero prices and zero-decimal currencies', () => {
  for (const [text, currency, locale, amount] of [
    ['29,90 €', 'EUR', 'bg-BG', 2990],
    ['$1,299.00', 'USD', 'en-US', 129900],
    ['1.299,00 EUR', 'EUR', 'de-DE', 129900],
    ['1\u202f299,00 лв.', 'BGN', 'bg-BG', 129900],
    ['€0.00', 'EUR', 'en-US', 0],
    ['¥1,000', 'JPY', 'ja-JP', 100000],
    ['29.9 CAD', 'CAD', 'en-CA', 2990],
  ])
    assert.equal(parseMoney(text, currency, locale).amount, amount, text);
  assert.equal(parseMoney('$29.90', 'CAD').currency, 'CAD');
  assert.equal(parseMoney('29.90 USD', 'EUR').currency, 'USD');
  assert.equal(parseMoney('29,90 щ.д.', 'EUR', 'bg-BG').currency, 'USD');
  assert.equal(parseMoney('29.90', 'EUR').currencyEvidence, 'session-only');
});
test('ranges, dual currency displays and unsupported money precision remain unverified', () => {
  for (const value of ['29–49 EUR', '29.90 EUR / 58.48 BGN', '29,9,0 €', '-29.90 EUR', ''])
    assert.throws(() => parseMoney(value, 'EUR'), CommerceUnverified);
  assert.throws(() => parseMoney('1.234 BHD', 'BHD'), CommerceUnverified);
  assert.throws(() => parseMoney('29.90 USD €', 'EUR'), /contradictory/);
});
test('JSON-LD associates the exact variant, supports graphs/references and rejects mismatches', () => {
  const schemas = [
    {
      '@graph': [
        { '@type': ['Thing', 'Product'], name: product.title, url, offers: { '@id': '#large' } },
        {
          '@id': '#large',
          '@type': 'Offer',
          url: url + '?variant=2',
          price: '49.90',
          priceCurrency: 'EUR',
        },
      ],
    },
  ];
  assert.equal(schemaPrice(schemas, product, variants[1], 'EUR', url).scope, 'variant');
  assert.throws(() => schemaPrice(schemas, product, variants[0], 'EUR', url), CommerceUnverified);
  assert.throws(() => schemaPrice(schemas, product, variants[1], 'USD', url), /currency/);
  schemas[0]['@graph'][1].price = '29.90';
  assert.throws(() => schemaPrice(schemas, product, variants[1], 'EUR', url), /differs/);
});
test('AggregateOffer checks the product range instead of pretending to be a selected-variant offer', () => {
  const schemas = [
    {
      '@type': 'Product',
      name: product.title,
      offers: {
        '@type': 'AggregateOffer',
        lowPrice: '29.90',
        highPrice: '49.90',
        priceCurrency: 'EUR',
      },
    },
  ];
  assert.equal(schemaPrice(schemas, product, variants[1], 'EUR', url).scope, 'product-range');
  schemas[0].offers.highPrice = '39.90';
  assert.throws(() => schemaPrice(schemas, product, variants[1], 'EUR', url), /range/);
});
test('ambiguous product offers cannot pass just because one number matches', () => {
  const schemas = [
    {
      '@type': 'Product',
      name: product.title,
      offers: { '@type': 'Offer', price: '29.90', priceCurrency: 'EUR' },
    },
  ];
  assert.throws(() => schemaPrice(schemas, product, variants[0], 'EUR', url), CommerceUnverified);
  const shared = { ...product, variants: [variants[0]], price_max: variants[0].price };
  assert.equal(schemaPrice(schemas, shared, variants[0], 'EUR', url).scope, 'shared-product-price');
});
function cart(overrides = {}) {
  return {
    currency: 'EUR',
    items: [
      {
        variant_id: 1,
        quantity: 1,
        original_price: 2990,
        original_line_price: 2990,
        final_price: 2990,
        final_line_price: 2990,
        ...overrides,
      },
    ],
  };
}
test('cart identity, quantity and original price must match; lower prices require real allocations', () => {
  assert.equal(cartPrice(cart(), variants[0]).finalPrice, 2990);
  const discounted = cart({
    final_price: 2490,
    final_line_price: 2490,
    line_level_discount_allocations: [{ amount: 500 }],
  });
  discounted.cart_level_discount_applications = [
    { title: 'Order discount', total_allocated_amount: 100 },
  ];
  assert.equal(cartPrice(discounted, variants[0]).lineDiscount, 500);
  for (const wrong of [
    { variant_id: 2 },
    { quantity: 2 },
    { original_price: 2999 },
    {
      final_price: 2490,
      final_line_price: 2490,
      line_level_discount_allocations: [{ amount: 400 }],
    },
  ])
    assert.throws(() => cartPrice(cart(wrong), variants[0]));
  assert.throws(
    () => cartPrice(cart({ final_price: 2490, final_line_price: 2490 }), variants[0]),
    CommerceUnverified,
  );
  assert.throws(
    () => cartPrice(cart({ selling_plan_allocation: {} }), variants[0]),
    CommerceUnverified,
  );
});
