import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Page, TestInfo } from '@playwright/test';
import type { InventoryPage } from './inventory';
import { approvedScreenshot } from './visual';

export async function inventoryScreenshot(
  page: Page,
  entry: InventoryPage,
  testInfo: TestInfo,
  discovered: boolean,
) {
  const file = createHash('sha256').update(entry.url).digest('hex').slice(0, 20);
  await approvedScreenshot(
    page,
    `${discovered ? 'discovered' : entry.type}-${file}.png`,
    testInfo,
    {
      fullPage: true,
      animations: 'disabled',

      mask: discovered
        ? undefined
        : [page.locator('[class*="chat"], [id*="chat"], [class*="countdown"], [data-cart-count]')],
    },
    path.resolve(__dirname, '30-inventory-visual.spec.ts'),
  );
}
