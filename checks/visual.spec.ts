import { test, expect } from '@playwright/test';
import { approvedScreenshot, viewportClip } from '../tests/visual';
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:${process.env.VISUAL_TEST_CHANGED ? '#222' : '#fff'};font-family:Arial}header{height:100px;background:#147;color:white}main{height:300px}</style></head><body><header>Approved store</header><main>Local visual fixture</main></body></html>`,
    }),
  );
  await page.goto('http://127.0.0.1:45989');
});
test('viewport screenshot respects the configured desktop or mobile dimensions', async ({
  page,
}, testInfo) => {
  const clip = viewportClip(page);
  expect(clip.width).toBe(testInfo.project.use.viewport!.width);
  expect(clip.height).toBe(testInfo.project.use.viewport!.height);
  await approvedScreenshot(page, 'fixture-page.png', testInfo, { clip });
});
test('component screenshot uses its own threshold', async ({ page }, testInfo) => {
  await approvedScreenshot(page.locator('header'), 'header.png', testInfo);
});
