'use strict';
// Shopify cart invariants stay isolated from WooCommerce taxes and money units.
const {
  CommerceUnverified,
  monetaryInteger,
  decimalMoney,
  parseMoney,
  schemaPrice,
} = require('./storefront-model');
function cartPrice(cart, variant, quantity = 1) {
  if (!Array.isArray(cart.items)) throw new Error('Cart API has no items array');
  const lines = cart.items.filter(
    line => String(line.variant_id ?? line.id) === String(variant.id),
  );
  if (lines.length !== 1 || cart.items.length !== 1)
    throw new Error('Cart does not contain exactly the selected variant');
  const line = lines[0];
  if (line.selling_plan_allocation)
    throw new CommerceUnverified('Selling-plan prices require a dedicated adapter');
  if (line.quantity !== quantity)
    throw new Error(`Cart quantity ${line.quantity} differs from requested ${quantity}`);
  for (const field of ['original_price', 'original_line_price', 'final_price', 'final_line_price'])
    monetaryInteger(line[field], `Cart ${field}`);
  if (
    line.original_price !== variant.price ||
    line.original_line_price !== variant.price * quantity
  )
    throw new Error(
      `Cart original price ${line.original_price} differs from variant price ${variant.price}`,
    );
  const allocations = line.line_level_discount_allocations;
  if (line.final_line_price !== line.original_line_price) {
    if (!Array.isArray(allocations) || !allocations.length)
      throw new CommerceUnverified(
        'Reduced cart line price has no line-level discount allocations',
      );
    const discount = allocations.reduce(
      (sum, allocation) => sum + monetaryInteger(allocation.amount, 'Discount allocation'),
      0,
    );
    if (line.original_line_price - discount !== line.final_line_price)
      throw new Error('Cart final line price does not match the recorded discount allocations');
  }
  if (line.final_line_price > line.original_line_price || line.final_price > line.original_price)
    throw new Error('Cart final price exceeds the original price');
  if (quantity === 1 && line.final_price !== line.final_line_price)
    throw new Error('Cart final unit price and line price disagree');
  return {
    variantId: String(variant.id),
    quantity: line.quantity,
    originalPrice: line.original_price,
    finalPrice: line.final_price,
    originalLinePrice: line.original_line_price,
    finalLinePrice: line.final_line_price,
    lineDiscount: line.original_line_price - line.final_line_price,
    cartLevelDiscounts: (cart.cart_level_discount_applications || []).map(item => ({
      title: item.title,
      totalAllocatedAmount: item.total_allocated_amount,
    })),
  };
}
module.exports = {
  CommerceUnverified,
  monetaryInteger,
  decimalMoney,
  parseMoney,
  schemaPrice,
  cartPrice,
};
