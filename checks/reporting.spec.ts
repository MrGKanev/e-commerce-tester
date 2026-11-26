import fs from 'node:fs';
import { controlEvent } from '../config/control-events';
import { test, expect } from '../tests/fixtures';

test('records actual browser @smoke', async ({ page }, testInfo) => {
  await page.route('http://127.0.0.1:45982/**', route =>
    route.fulfill({ contentType: 'text/html', body: '<main>Offline report check</main>' }),
  );
  const destination = 'http://127.0.0.1:45982/?unknown=private-navigation';
  await page.goto(destination);
  expect(page.url()).toBe(destination);
  expect(fs.existsSync(process.env.REPORTING_RESULTS_FILE!)).toBe(false);
  controlEvent({
    type: 'privacy-fixture',
    url: 'https://private-user:private-password@store.test/?unknown=private-event',
    access_token: 'private-event-token',
  });
  await testInfo.attach('privacy-fixture.json', {
    body: JSON.stringify({
      access_token: 'private-attachment-token',
      email: 'private-attachment@example.test',
      sha256: 'a'.repeat(64),
    }),
    contentType: 'application/json',
  });
  console.log('token=private-console');
  process.stdout.write(Buffer.from('api_key=private-buffer-console\n'));

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
  if (testInfo.retry === 0)
    throw new Error(
      'Price update did not arrive on the first attempt; token=private-error private-error@example.test https://private-user:private-password@store.test/?unknown=private-error-query',
    );
});
