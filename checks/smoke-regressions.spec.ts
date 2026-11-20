import { test, expect, type Page } from '../tests/fixtures';
import { BASE } from '../tests/helpers';
import '../tests/01-homepage.spec';
import '../tests/04-product.spec';

const navigations = new WeakMap<Page, number>();

// Execute the production scenarios with every request intercepted, including failed cases.
test.beforeEach(async ({ page }, info) => {
  expect(new URL(BASE).hostname).toBe('127.0.0.1');
  const hiddenOnly = info.project.name === 'Hidden-only Chrome';
  const missingProduct = info.titlePath.some(part => part.includes('smoke-missing'));
  test.fail(
    (hiddenOnly && info.title.includes('linked from homepage')) ||
      (missingProduct && info.title === 'page loads (not 404)'),
    'Hidden-only links and real HTTP 404 responses must remain failures',
  );
  navigations.set(page, 0);
  await page.context().route('**/*', route => {
    const request = route.request();
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      navigations.set(page, (navigations.get(page) || 0) + 1);
    const missing = new URL(request.url()).pathname.endsWith('/smoke-missing');
    return route.fulfill({
      status: missing ? 404 : 200,
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><head><title>Owned smoke fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><header hidden><a href="/products/smoke-good">Hidden drawer link</a></header><main><h1>Fixture product</h1><a ${hiddenOnly ? 'hidden' : ''} href="/products/smoke-good">Visible product</a></main></body></html>`,
    });
  });
});

test.afterEach(async ({ page }) => {
  expect(navigations.get(page), 'Production smoke/readiness scenario must navigate once').toBe(1);
});
