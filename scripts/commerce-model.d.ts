export { CommerceUnverified } from './storefront-model';
export interface PublicVariant {
  id: number | string;
  price: number;
  compare_at_price: number | null;
  available: boolean;
  sku?: string | null;
  options: string[];
  quantity_rule?: { min: number; increment: number; max?: number | null };
}
export interface PublicProduct {
  id: number | string;
  title: string;
  handle: string;
  variants: PublicVariant[];
  price_min: number;
  price_max: number;
  options: Array<string | { name: string }>;
  requires_selling_plan?: boolean;
}
export interface PublicCart {
  currency: string;
  items: Array<{
    id?: number;
    variant_id: number | string;
    quantity: number;
    original_price: number;
    original_line_price: number;
    final_price: number;
    final_line_price: number;
    selling_plan_allocation?: unknown;
    line_level_discount_allocations?: Array<{ amount: number }>;
  }>;
  cart_level_discount_applications?: Array<{ title: string; total_allocated_amount: number }>;
}
export interface ParsedMoney {
  amount: number;
  currency: string;
  currencyEvidence: string;
  text: string;
}
export function monetaryInteger(value: unknown, label: string): number;
export function parseMoney(value: string, currency: string, locale?: string): ParsedMoney;
export function decimalMoney(value: string | number): number;
export function schemaPrice(
  schemas: unknown[],
  product: PublicProduct,
  variant: PublicVariant,
  currency: string,
  pageUrl: string,
): Record<string, unknown>;
export function cartPrice(
  cart: PublicCart,
  variant: PublicVariant,
  quantity?: number,
): Record<string, unknown>;
