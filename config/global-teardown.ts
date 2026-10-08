/**
 * Global teardown — runs once after all tests complete.
 *
 * Clears the Shopify cart so each test run starts with an empty cart.
 * Uses the same session cookies from storageState.json (created by global-setup).
 */

import { request } from '@playwright/test';
import { STORAGE_STATE } from './global-setup';
import { BASE } from '../tests/helpers';
import fs from 'fs';
import { isLimited, paceAPI } from '../tests/pacing';

export default async function globalTeardown(): Promise<void> {
  if (isLimited() || !fs.existsSync(STORAGE_STATE)) return;

  const context = await request.newContext({
    baseURL: BASE,
    storageState: STORAGE_STATE,
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
  });

  paceAPI(context);
  try {
    const response = await context.post('/cart/clear.js');
    if (!response.ok()) throw new Error(`Cart cleanup failed: HTTP ${response.status()}`);
  } finally {
    await context.dispose();
  }
}
