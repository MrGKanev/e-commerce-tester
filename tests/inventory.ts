import fs from 'node:fs';
import path from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import { readSiteSettings } from '../config/site-settings';
import { recordRateLimit, assertNotLimited } from './pacing';

export type InventoryPage = {
  url: string;
  type: 'home' | 'product' | 'collection' | 'search' | 'cart' | 'static';
  language: string;
  handle?: string;
};
const settings = readSiteSettings();
const origin = (process.env.STORE_URL || 'https://zerno.co').replace(/\/$/, '');

export function configuredPages(): InventoryPage[] {
  const handles = [
    process.env.PRODUCT_HANDLE || 'zerno-z1',
    process.env.PRODUCT_HANDLE_2 || 'zerno-z2',
  ];
  const pages: InventoryPage[] = [
    { url: origin + '/', type: 'home', language: settings.locale },
    ...handles.map(handle => ({
      url: `${origin}/products/${encodeURIComponent(handle)}`,
      type: 'product' as const,
      language: settings.locale,
      handle,
    })),
    { url: origin + '/collections/all', type: 'collection', language: settings.locale },
    {
      url: `${origin}/search?q=${encodeURIComponent(process.env.SEARCH_TERM || 'zerno')}&type=product`,
      type: 'search',
      language: settings.locale,
    },
    { url: origin + '/cart', type: 'cart', language: settings.locale },
    ...settings.inventory.pages.map(page => ({
      url: new URL(page.path, origin).href,
      type: page.type,
      language: page.language || settings.locale,
    })),
  ];
  return [...new Map(pages.map(page => [page.url, page])).values()];
}
export function pageInventory(): InventoryPage[] {
  if (process.env.PAGE_INVENTORY_FILE && fs.existsSync(process.env.PAGE_INVENTORY_FILE)) {
    return JSON.parse(fs.readFileSync(process.env.PAGE_INVENTORY_FILE, 'utf8')).pages;
  }
  return configuredPages();
}
export async function prepareInventory(request: APIRequestContext): Promise<void> {
  const pages = configuredPages();
  if (settings.inventory.discoverProducts) {
    const response = await request.get(
      `${origin}/products.json?limit=${settings.inventory.productLimit}`,
    );
    recordRateLimit(response.status(), response.url(), response.headers()['retry-after'] || null);
    assertNotLimited();
    if (!response.ok())
      throw new Error(`Configured catalogue discovery failed: HTTP ${response.status()}`);
    const data = (await response.json()) as { products: { handle: string }[] };
    if (!Array.isArray(data.products)) throw new Error('Catalogue response has no products array');
    for (const product of data.products.slice(0, settings.inventory.productLimit)) {
      if (!product || typeof product.handle !== 'string' || !product.handle.trim())
        throw new Error('Invalid catalogue product handle');
      const url = `${origin}/products/${encodeURIComponent(product.handle)}`;
      if (!pages.some(page => page.url === url))
        pages.push({ url, type: 'product', handle: product.handle, language: settings.locale });
    }
  }
  if (process.env.PAGE_INVENTORY_FILE) {
    fs.mkdirSync(path.dirname(process.env.PAGE_INVENTORY_FILE), { recursive: true });
    fs.writeFileSync(
      process.env.PAGE_INVENTORY_FILE,
      JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), pages }, null, 2),
    );
  }
}

export function extraInventoryPages(): InventoryPage[] {
  const configured = new Set(configuredPages().map(page => page.url));
  return pageInventory().filter(page => !configured.has(page.url));
}
