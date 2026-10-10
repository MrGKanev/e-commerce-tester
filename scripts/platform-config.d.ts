import type { SiteSettings } from '../config/site-settings';
export function compatibleSpec(file: string, platform: SiteSettings['platform']): boolean;
export function publicUrl(value: string, base: string, label: string): string;
export function storeApiUrl(
  settings: SiteSettings,
  endpoint: string,
  query?: Record<string, string | number>,
): string;
export function productReferences(
  settings: SiteSettings,
  base: string,
  env?: NodeJS.ProcessEnv,
): Array<{ handle: string; url: string }>;
export function storefrontRoute(
  settings: SiteSettings,
  base: string,
  kind: 'catalog' | 'cart' | 'checkout' | 'search',
  searchTerm?: string,
): string;
