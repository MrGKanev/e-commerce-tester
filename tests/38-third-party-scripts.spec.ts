import { test } from './fixtures';
import { readSiteSettings } from '../config/site-settings';
import { goto } from './helpers';
import { batchInventory } from './inventory';
import { observeScriptInventory } from './script-inventory';

if (!batchInventory)
  test(
    'third-party script inventory',
    { tag: ['@full', '@smoke', '@audit'] },
    async ({ page }, info) => {
      if (!readSiteSettings().monitorScripts)
        info.annotations.push({
          type: 'not-applicable',
          description: 'Third-party monitoring disabled',
        });
      test.skip(!readSiteSettings().monitorScripts, 'Third-party monitoring is disabled');
      const attachInventory = observeScriptInventory(page);
      await goto(page);
      await attachInventory(info);
    },
  );
