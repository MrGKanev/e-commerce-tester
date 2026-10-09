import { test, expect } from '../tests/fixtures';
import { auditCurrentPage } from '../tests/shared-page-audit';

test('metadata/media/axe/content/screenshot/performance share one document navigation', async ({
  page,
}, testInfo) => {
  let navigations = 0;
  await page.route('**/*', route => {
    if (route.request().isNavigationRequest()) navigations++;
    return route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="en"><head><title>Local shared page</title><link rel="canonical" href="http://127.0.0.1:45986/"></head><body><main><h1>Local shared page</h1><p>Welcome to the store.</p></main></body></html>',
    });
  });
  await page.goto('http://127.0.0.1:45986/');
  await auditCurrentPage(page, testInfo, 'en');
  expect(navigations).toBe(1);
  expect(testInfo.attachments.some(attachment => attachment.name === 'accessibility.json')).toBe(
    true,
  );
  expect(testInfo.attachments.some(attachment => attachment.name === 'spelling.json')).toBe(true);
  expect(testInfo.attachments.some(attachment => attachment.name === 'shared-page-evidence')).toBe(
    true,
  );
});
