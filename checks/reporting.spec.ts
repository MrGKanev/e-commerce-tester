import { test, expect } from '../tests/fixtures';

test('records actual browser @smoke', async ({ page }) => {
  await page.route('http://127.0.0.1:45982/**', route =>
    route.fulfill({ contentType: 'text/html', body: '<main>Offline report check</main>' }),
  );
  await page.goto('http://127.0.0.1:45982/');
  await expect(page.locator('main')).toBeVisible();
});

test('explicitly not applicable widget', async ({}, testInfo) => {
  testInfo.annotations.push({
    type: 'not-applicable',
    description: 'Widget is not configured for this store',
  });
  test.skip(true, 'Optional widget absent');
});

test('skipped scenario remains in coverage', async () => {
  test.skip(true, 'Known issue awaits a fix');
});

test('flaky price change', async ({}, testInfo) => {
  if (testInfo.retry === 0) throw new Error('Price update did not arrive on the first attempt');
});
