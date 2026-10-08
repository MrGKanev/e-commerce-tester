import { test, expect } from '@playwright/test';
import { performance } from 'node:perf_hooks';
import {
  BASE,
  addProductToCart,
  goto,
  dismissCookieConsent,
  optionalVisible,
  cartAction,
  waitForImages,
  waitForContent,
  clearCart,
} from '../tests/helpers';

// All routes are intercepted: this suite makes no store or external requests.
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/tracking') return; // deliberately never completes
    if (pathname === '/cart/add.js') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    } else {
      await route.fulfill({
        contentType: 'text/html',
        body: `<html><body>
        <main hidden></main><script>
          fetch('/tracking');
          setTimeout(() => { const main = document.querySelector('main'); main.textContent = 'Ready content'; main.hidden = false; }, 80);
        </script></body></html>`,
      });
    }
  });
});

test('goto waits for content despite never-ending tracking and does not spend 5s on absent consent', async ({
  page,
}) => {
  const started = performance.now();
  await goto(page);
  await expect(page.locator('main')).toHaveText('Ready content');
  expect(performance.now() - started).toBeLessThan(2000);
});

test('cookie probe ignores a hidden first match and dismisses a visible banner', async ({
  page,
}) => {
  await page.setContent(
    '<button id="accept-cookies" hidden>Accept hidden</button><button id="cookie-accept" onclick="this.remove()">Accept</button>',
  );
  await dismissCookieConsent(page);
  await expect(page.locator('#cookie-accept')).toHaveCount(0);
});

test('setup opt-in waits for a delayed consent banner', async ({ page }) => {
  await page.setContent(
    '<main>Store</main><script>setTimeout(() => { const b = document.createElement("button"); b.id = "cookie-accept"; b.textContent = "Accept"; b.onclick = () => b.remove(); document.body.append(b); }, 80);</script>',
  );
  await dismissCookieConsent(page, 500);
  await expect(page.locator('#cookie-accept')).toHaveCount(0);
});

test('a broken consent dismissal fails instead of being treated as absent', async ({ page }) => {
  await page.setContent('<button id="cookie-accept">Accept</button>');
  await expect(dismissCookieConsent(page)).rejects.toThrow('Consent action did not dismiss');
});

test('optional discovery returns false for absence but propagates a closed page error', async ({
  page,
}) => {
  expect(await optionalVisible(page.locator('#missing'), 50)).toBe(false);
  const locator = page.locator('#missing');
  await page.close();
  await expect(optionalVisible(locator, 50)).rejects.toThrow();
});

test('cart response is registered before the action, including an immediate response', async ({
  page,
}) => {
  await goto(page);
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.textContent = 'Add';
    button.onclick = () => {
      void fetch('/cart/add.js', { method: 'POST' });
    };
    document.body.append(button);
  });
  await cartAction(page, () => page.getByRole('button', { name: 'Add', exact: true }).click());
});

test('failed cart response is not swallowed', async ({ page }) => {
  await goto(page);
  await page.route('**/cart/add.js', route => route.fulfill({ status: 422, body: '{}' }));
  await expect(
    cartAction(page, () => page.evaluate(() => fetch('/cart/add.js', { method: 'POST' }))),
  ).rejects.toThrow('Cart operation failed');
});

test('image readiness accepts a completed broken image so the image audit can report it', async ({
  page,
}) => {
  await page.route('**/broken.png', route => route.fulfill({ status: 404, body: '' }));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const image = document.createElement('img');
    image.width = 20;
    image.height = 20;
    image.src = '/broken.png';
    document.body.append(image);
  });
  await waitForImages(page);
  expect(await page.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(
    0,
  );
});

test('cart clearing requires a successful response', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const original = page.context().request.post;
  page.context().request.post = (async () => ({ ok: () => false })) as unknown as typeof original;
  try {
    await expect(clearCart(page)).rejects.toThrow('Could not clear cart');
  } finally {
    page.context().request.post = original;
  }
});

test('a mandatory cart action without a response fails rather than silently continuing', async ({
  page,
}) => {
  await goto(page);
  page.setDefaultTimeout(150);
  await expect(cartAction(page, async () => {})).rejects.toThrow(/Timeout/);
});

test('optional widgets can appear asynchronously without a fixed sleep', async ({ page }) => {
  await page.setContent(
    '<script>setTimeout(() => { const widget = document.createElement("div"); widget.id = "widget"; widget.textContent = "Ready"; document.body.append(widget); }, 60);</script>',
  );
  expect(await optionalVisible(page.locator('#widget'), 500)).toBe(true);
});

test('visual image readiness does not wait for an off-screen lazy image', async ({ page }) => {
  await page.setContent(
    '<main>Ready</main><img loading="lazy" src="/never.png" width="20" height="20" style="position:absolute;top:100000px">',
  );
  await waitForImages(page);
});

test('a configured product with a disabled add control fails rather than being skipped', async ({
  page,
}) => {
  await page.route('**/products/**', route =>
    route.fulfill({
      contentType: 'text/html',
      body: '<main>Product</main><form action="/cart/add"><button type="submit" disabled>Add</button></form>',
    }),
  );
  await expect(addProductToCart(page)).rejects.toThrow(
    'Configured product cannot be added to cart',
  );
});

test('graphic-only main content is ready for visual and OCR inspection', async ({ page }) => {
  await page.setContent('<main><canvas width="100" height="40"></canvas></main>');
  await waitForContent(page);
});
