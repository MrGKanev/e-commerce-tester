export class CommerceUnverified extends Error {}
export interface Money {
  amount: number;
  currency: string;
  currencyEvidence: string;
  text: string;
}
export interface SchemaProduct {
  title: string;
  handle: string;
  price_min: number;
  price_max: number;
  variants: Array<{ id: string | number; price?: number; sku?: string | null }>;
}
export function monetaryInteger(value: unknown, label: string): number;
export function decimalMoney(value: string | number, precision?: number): number;
export function parseMoney(
  value: string,
  currency: string,
  locale?: string,
  options?: { precision?: number; decimalSeparator?: string },
): Money;
export function schemaPrice(
  schemas: unknown[],
  product: SchemaProduct,
  variant: { id: string | number; price: number; sku?: string | null },
  currency: string,
  pageUrl: string,
  options?: { precision?: number; platform?: 'shopify' | 'woocommerce'; productUrls?: string[] },
): Record<string, unknown>;
