import { test } from './fixtures';
import { KNOWN_PRODUCTS } from './helpers';
import { CommerceUnverified } from '../scripts/commerce-model';
import { auditCommerce, type CommerceKind } from './commerce-consistency';

for (const product of KNOWN_PRODUCTS) {
  test.describe(
    `33 · Commerce consistency — ${product.handle}`,
    { tag: ['@full', '@commerce'] },
    () => {
      const cases: Array<[CommerceKind, string]> = [
        ['price', 'selected variant price matches UI and cart, with explicit discounts'],
        ['schema', 'JSON-LD offer matches the selected variant or product price range'],
        ['available', 'available variant can be purchased and adds the exact variant'],
        ['unavailable', 'unavailable variant is blocked and visibly identified'],
      ];
      for (const [kind, title] of cases) {
        test(title, async ({ page }, testInfo) => {
          test.setTimeout(180000);
          try {
            await auditCommerce(page, testInfo, product.handle, kind);
          } catch (error) {
            if (!(error instanceof CommerceUnverified)) throw error;
            testInfo.annotations.push({ type: 'commerce-unverified', description: error.message });
            test.skip(true, error.message);
          }
        });
      }
    },
  );
}
