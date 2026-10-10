'use strict';
const { CommerceUnverified, monetaryInteger } = require('./storefront-model');
function amount(value, label) {
  if (typeof value !== 'string' || !/^\d+$/.test(value))
    throw new CommerceUnverified(`${label} is not an exposed WooCommerce monetary amount`);
  return monetaryInteger(Number(value), label);
}
function prices(product) {
  const data = product.prices;
  if (
    product.is_password_protected ||
    !data ||
    !/^[A-Z]{3}$/.test(data.currency_code || '') ||
    !Number.isInteger(data.currency_minor_unit) ||
    data.currency_minor_unit < 0 ||
    data.currency_minor_unit > 6
  )
    throw new CommerceUnverified('Product price/currency is hidden or uses unsupported precision');
  return {
    price: amount(data.price, 'Product price'),
    regularPrice: amount(data.regular_price, 'Regular price'),
    currency: data.currency_code,
    precision: data.currency_minor_unit,
    decimalSeparator: data.currency_decimal_separator || '.',
  };
}
function sellability(product, variation) {
  const purchasable = product.is_purchasable;
  const inStock = product.is_in_stock;
  const backorder = Boolean(product.backorders_allowed || variation?.backorders_allowed);
  if (typeof purchasable !== 'boolean' || typeof inStock !== 'boolean')
    throw new CommerceUnverified('Public product response does not identify sellability');
  return { available: purchasable && (inStock || backorder), backorder, inStock, purchasable };
}
function cartFacts(cart, product, taxDisplay = 'auto', quantity = 1) {
  if (!Array.isArray(cart.items)) throw new Error('WooCommerce cart has no items array');
  if (cart.items.length !== 1 || cart.items[0].id !== product.id)
    throw new Error('WooCommerce cart does not contain exactly the selected product/variation');
  const item = cart.items[0];
  if (item.quantity !== quantity)
    throw new Error(
      `WooCommerce cart quantity ${item.quantity} differs from requested ${quantity}`,
    );
  if (item.parent_item_key)
    throw new CommerceUnverified('Grouped/bundle cart lines require a dedicated adapter');
  const expected = prices(product),
    totals = item.totals;
  if (
    !totals ||
    totals.currency_code !== expected.currency ||
    totals.currency_minor_unit !== expected.precision
  )
    throw new CommerceUnverified('Cart currency or monetary precision changed during the check');
  const subtotal = amount(totals.line_subtotal, 'Cart subtotal');
  const subtotalTax = amount(totals.line_subtotal_tax, 'Cart subtotal tax');
  const total = amount(totals.line_total, 'Cart line total');
  const totalTax = amount(totals.line_total_tax, 'Cart line tax');
  if (
    expected.price * quantity !== subtotal &&
    expected.price * quantity !== subtotal + subtotalTax
  )
    throw new Error(
      `WooCommerce product price ${expected.price} differs from cart subtotal ${subtotal} and tax ${subtotalTax}`,
    );
  if (total > subtotal || totalTax > subtotalTax)
    throw new Error('Cart line totals increase unexpectedly after discounts');
  let basis = taxDisplay;
  if (basis === 'auto' && subtotalTax === 0 && totalTax === 0) basis = 'excluding';
  const displaySubtotal =
    basis === 'including' ? subtotal + subtotalTax : basis === 'excluding' ? subtotal : null;
  return {
    productId: product.id,
    quantity: item.quantity,
    currency: expected.currency,
    precision: expected.precision,
    catalogTaxBasis: expected.price * quantity === subtotal ? 'excluding-or-zero-tax' : 'including',
    subtotal,
    subtotalTax,
    total,
    totalTax,
    discountExcludingTax: subtotal - total,
    couponCount: Array.isArray(cart.coupons) ? cart.coupons.length : 0,
    cartTaxBasis: basis,
    displaySubtotal,
    variation: (item.variation || []).map(attribute => ({
      attribute: attribute.attribute,
      value: attribute.value,
    })),
  };
}
module.exports = { amount, prices, sellability, cartFacts };
