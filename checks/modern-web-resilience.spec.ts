import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { inspectResilience } from '../tests/modern-web-resilience';

const css = () => fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
const fixture = (body: string) =>
  `<!doctype html><html lang="en"><head><title>Resilience fixture</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css()}</style></head><body><main><h1>Local resilience fixture</h1>${body}</main></body></html>`;
const url = 'http://127.0.0.1:45996/resilience';

test('passive resilience samples expose media requests and hidden scrolling without copying content', async ({
  page,
}) => {
  let requests = 0;
  await page.route('**/*', route => {
    requests++;
    return route.request().isNavigationRequest()
      ? route.fulfill({
          contentType: 'text/html',
          body: fixture(`
        <canvas id="unexplained" width="120" height="60"></canvas>
        <div id="hidden-scrollbar" class="h-16 w-32 overflow-auto [scrollbar-width:none]"><div class="h-64 w-64">private-scroll-content</div></div>
        <button id="truncated" class="block w-16 truncate" aria-label="Short" title="private-title">private-long-label-content</button>
        <div class="h-[3000px]"></div>
        <video id="offscreen" width="120" height="60" preload="none" poster="/poster.svg?access_token=private-resource"></video>`),
        })
      : route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60"/></svg>',
        });
  });
  await page.goto(url);
  await page.waitForLoadState('load');
  const before = {
    requests,
    scroll: await page.evaluate(() => scrollY),
    focus: await page.evaluate(() => document.activeElement?.tagName),
  };
  const report = await inspectResilience(page);
  expect(report.findings.map(item => item.rule)).toEqual(
    expect.arrayContaining([
      'media-offscreen-request',
      'scroller-hidden-scrollbar',
      'single-line-title-disclosure',
      'single-line-name-mismatch',
      'canvas-alternative-unverified',
    ]),
  );
  expect(report.findings.every(item => item.severity === 'warning')).toBe(true);
  expect(report.observations.media[0]).toMatchObject({
    farBelowViewport: true,
    posterRequestObserved: true,
    geometryIsCurrentNotHistorical: true,
  });
  expect(requests).toBe(before.requests);
  expect(await page.evaluate(() => scrollY)).toBe(before.scroll);
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe(before.focus);
  expect(JSON.stringify(report)).not.toMatch(
    /private-resource|private-scroll-content|private-title|private-long-label-content|poster\.svg/,
  );
});

test('deferred media, semantic canvas alternatives and ordinary scrollers avoid mandatory API requirements', async ({
  page,
}) => {
  await page.route('**/*', route =>
    route.fulfill({
      contentType: 'text/html',
      body: fixture(`
    <canvas id="decorative" width="120" height="60" aria-hidden="true"></canvas>
    <canvas id="described" width="120" height="60" aria-labelledby="chart-title" aria-describedby="chart-summary"></canvas>
    <h2 id="chart-title">Sales chart</h2><p id="chart-summary">A textual data summary.</p>
    <canvas id="fallback" width="120" height="60">Equivalent table alternative</canvas>
    <div id="ordinary" class="h-16 w-32 overflow-auto" tabindex="0" role="region" aria-label="Scrollable content"><div class="h-64 w-64">Scrollable text</div></div>
    <p class="w-16 truncate">Full DOM label without title</p>
    <div class="h-[3000px]"></div>
    <video id="deferred" width="120" height="60" preload="none" data-src="/deferred.mp4"></video>
    <audio id="deferred-audio" controls preload="none" data-src="/deferred.mp3"></audio>`),
    }),
  );
  await page.goto(url);
  const report = await inspectResilience(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage).toMatchObject({
    media: 2,
    canvases: 3,
    scrollers: 1,
    singleLines: 1,
    passive: true,
  });
  expect(report.observations.media.every(item => item.absentTimingDoesNotProveDeferral)).toBe(true);
  expect(report.observations.canvases.every(item => item.equivalentContentVerified === false)).toBe(
    true,
  );
});

test('viewport-lazy media warning remains heuristic and empty scopes stay explicit', async ({
  page,
}) => {
  await page.route('**/*', route =>
    route.fulfill({
      contentType: 'text/html',
      body: fixture(
        '<video id="visible" loading="lazy" width="120" height="60" preload="none" poster="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E"></video>',
      ),
    }),
  );
  await page.goto(url);
  const report = await inspectResilience(page);
  expect(report.findings.map(item => item.rule)).toEqual(['media-viewport-lazy']);
  expect(report.observations.media[0]).toMatchObject({
    sourcePresent: false,
    sourceRequestObserved: false,
    nativeLazySupported: expect.any(Boolean),
  });
  await page.locator('main').evaluate(el => el.replaceChildren());
  const empty = await inspectResilience(page);
  expect(empty.findings).toEqual([]);
  expect(empty.coverage).toMatchObject({ media: 0, canvases: 0, scrollers: 0, singleLines: 0 });
});

test('sample bounds and unsupported timing are explicit without assuming a resource was deferred', async ({
  page,
}) => {
  await page.route('**/*', route =>
    route.fulfill({
      contentType: 'text/html',
      body: fixture('<video width="120" height="60" preload="none"></video>'.repeat(52)),
    }),
  );
  await page.goto(url);
  await page.evaluate(() =>
    Object.defineProperty(performance, 'getEntriesByName', { value: undefined }),
  );
  const report = await inspectResilience(page);
  expect(report.coverage).toMatchObject({
    media: 52,
    timingSupported: false,
    sampled: { media: 50 },
  });
  expect(
    report.observations.media.every(
      item => item.timingEvidence === 'unsupported' && !item.sourceRequestObserved,
    ),
  ).toBe(true);
});

test('generated action labels and duplicate alternatives are distinguished from decoration', async ({
  page,
}) => {
  await page.route('**/*', route =>
    route.fulfill({
      contentType: 'text/html',
      body: fixture(`
    <button id="only-generated" class="before:content-['Save']"></button>
    <button id="duplicate-generated" class="before:content-['Save'_/_'Save']">Save</button>
    <button id="decorated" class="before:content-['Arrow'_/_'']">Next</button>
    <button id="explicit" class="before:content-['Icon']" aria-label="Settings"></button>`),
    }),
  );
  await page.goto(url);
  const report = await inspectResilience(page);
  expect(report.findings.map(item => [item.rule, item.selector])).toEqual(
    expect.arrayContaining([
      ['generated-content-only-label', '#only-generated'],
      ['generated-content-duplicate-alt', '#duplicate-generated'],
    ]),
  );
  expect(report.findings.some(item => ['#decorated', '#explicit'].includes(item.selector))).toBe(
    false,
  );
  expect(report.observations.generated).toHaveLength(4);
  expect(JSON.stringify(report)).not.toMatch(/Arrow|Settings|Icon/);
});
