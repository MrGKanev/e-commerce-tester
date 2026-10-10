export interface WooPrices {
  price: string;
  regular_price: string;
  sale_price?: string;
  price_range?: { min_amount: string; max_amount: string } | null;
  currency_code: string;
  currency_minor_unit: number;
  currency_decimal_separator?: string;
  raw_prices?: { precision: number; price: string };
}
export interface WooProduct {
  id: number;
  name: string;
  slug: string;
  permalink: string;
  sku?: string;
  type?: string;
  has_options?: boolean;
  add_to_cart?: { minimum?: number; maximum?: number; multiple_of?: number };
  is_purchasable: boolean;
  is_in_stock: boolean;
  backorders_allowed?: boolean;
  is_password_protected?: boolean;
  prices: WooPrices;
}
export interface WooVariation {
  variation_id: number;
  attributes: Record<string, string>;
  is_purchasable: boolean;
  is_in_stock: boolean;
  backorders_allowed?: boolean;
  display_price?: number;
  sku?: string;
  variation_is_active?: boolean;
}
export interface WooCart {
  items: Array<{
    id: number;
    key: string;
    quantity: number;
    parent_item_key?: string | null;
    variation?: Array<{ attribute: string; value: string }>;
    totals: {
      line_subtotal: string;
      line_subtotal_tax: string;
      line_total: string;
      line_total_tax: string;
      currency_code: string;
      currency_minor_unit: number;
    };
  }>;
  coupons?: unknown[];
  totals?: { currency_code: string; currency_minor_unit: number };
}
export function amount(value: unknown, label: string): number;
export function prices(product: WooProduct): {
  price: number;
  regularPrice: number;
  currency: string;
  precision: number;
  decimalSeparator: string;
};
export function sellability(
  product: WooProduct,
  variation?: WooVariation,
): { available: boolean; backorder: boolean; inStock: boolean; purchasable: boolean };
export function cartFacts(
  cart: WooCart,
  product: WooProduct,
  taxDisplay?: 'auto' | 'including' | 'excluding',
  quantity?: number,
): Record<string, unknown> & { displaySubtotal: number | null };
