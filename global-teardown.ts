/**
 * Global teardown — runs once after all tests complete.
 *
 * Clears the Shopify cart so each test run starts with an empty cart.
 * Uses the same session cookies from storageState.json (created by global-setup).
 */

import { request } from '@playwright/test';
import { STORAGE_STATE } from './global-setup';
import fs from 'fs';

export default async function globalTeardown(): Promise<void> {
  if (!fs.existsSync(STORAGE_STATE)) return;

  const context = await request.newContext({
    baseURL: 'https://zerno.co',
    storageState: STORAGE_STATE,
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
  });

  await context.post('/cart/clear.js').catch(() => {
    // Non-fatal — cart may already be empty or endpoint temporarily unavailable
  });

  await context.dispose();
}
