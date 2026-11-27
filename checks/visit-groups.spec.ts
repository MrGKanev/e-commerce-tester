import path from 'node:path';
import { createRequire } from 'node:module';
import { test, expect } from '../tests/fixtures';

const source = process.env.VISIT_GROUPS_TEST_ROOT || path.resolve(__dirname, '..');
const requireSource = createRequire(__filename);
for (const file of [
  '03-collections',
  '08-pages',
  '09-media',
  '11-accessibility',
  '16-dynamic-products',
  '20-security',
  '23-404',
])
  requireSource(path.join(source, 'tests', file + '.spec.ts'));

test.beforeEach(async ({}, info) => {
  expect(new URL(process.env.STORE_URL!).hostname).toBe('127.0.0.1');
  test.fail(
    process.env.VISIT_GROUPS_NEGATIVE === '1' &&
      (info.title.includes('shared media checks') ||
        info.title.includes('shared document checks') ||
        info.title.includes('shared response checks') ||
        info.title.includes('crawled products — shared') ||
        info.title === 'collection — shared passive checks' ||
        info.title === 'Contact — shared page checks' ||
        info.title === 'homepage — shared axe checks'),
    'Owned negative fixtures must remain visible failures',
  );
});

test.afterEach(async ({ page }, info) => {
  if (info.title === 'Homepage — shared media checks')
    await page.screenshot({
      path: path.join(process.env.VISIT_GROUPS_DIRECTORY!, info.project.name + '.png'),
      fullPage: true,
    });
});
