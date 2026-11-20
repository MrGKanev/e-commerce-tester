import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { prepareInteractionProbe } from '../tests/modern-web-interactions';
import { inspectTableScroll } from '../tests/modern-web-table-scroll';
const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
const region =
  '<div id="scroll-region" role="region" tabindex="0" aria-label="Private table label" class="w-[240px] overflow-x-auto border focus-visible:outline-2"><table class="w-[900px]"><caption>Private table content</caption><tr><th scope="col">Column</th><td>Private cell value</td></tr></table></div>';
async function fixture(page: import('@playwright/test').Page, markup = region, script = '') {
  const guard = await prepareInteractionProbe(page);
  await page.route('**/*', route => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Table scrolling fixture</title><style>${css}</style></head><body><main class="p-4"><h1>Table scrolling</h1><input id="outside" aria-label="Outside">${markup}</main><script>${script}</script></body></html>`,
    });
  });
  await page.goto('http://127.0.0.1:45996/table-scroll');
  await page.locator('#outside').focus();
  await guard.freeze();
  return guard;
}

test('table keyboard probe refuses an unquarantined document', async ({ page }) => {
  await page.goto('about:blank');
  await expect(inspectTableScroll(page)).rejects.toThrow('freeze()');
});

for (const rtl of [false, true])
  test(`native table region keyboard movement and restoration, RTL ${rtl}`, async ({
    page,
  }, info) => {
    await fixture(page, rtl ? region.replace('role="region"', 'dir="rtl" role="region"') : region);
    if (!rtl && ['Desktop Chrome', 'Mobile Chrome'].includes(info.project.name))
      await page.screenshot({
        path: '/tmp/modern-table-' + info.project.name.replace(' ', '-') + '.png',
      });
    const report = await inspectTableScroll(page);
    expect(report.observations, JSON.stringify(report)).toHaveLength(1);
    expect(report.observations[0], JSON.stringify(report)).toMatchObject({
      samples: expect.arrayContaining([expect.objectContaining({ canMove: true })]),
    });
    const observation = report.observations[0] as {
      status: string;
      samples: Array<{ canMove: boolean; moved: boolean }>;
    };
    expect(observation.status).toBe(
      observation.samples.some(s => s.canMove && !s.moved) ? 'unverified' : 'observed',
    );
    expect(report.findings).toEqual([]);
    expect(await page.locator('#scroll-region').evaluate(el => el.scrollLeft)).toBe(0);
    await expect(page.locator('#outside')).toBeFocused();
    expect(JSON.stringify(report)).not.toMatch(/Private|scroll-region/);
  });

test('blocked arrow behavior produces only an advisory', async ({ page }) => {
  await fixture(
    page,
    region,
    'document.getElementById("scroll-region").addEventListener("keydown",e=>e.preventDefault());',
  );
  const report = await inspectTableScroll(page);
  expect(report.observations[0]).toMatchObject({ status: 'observed' });
  expect(report.findings.map(f => [f.rule, f.severity])).toEqual([
    ['table-scroll-keyboard', 'warning'],
  ]);
});

for (const variant of [
  'hidden',
  'inert',
  'negative-tabindex',
  'no-overflow',
  'no-table',
  'grid',
  'editable',
  'modal',
] as const)
  test(`table scrolling excludes unsafe or inapplicable scope: ${variant}`, async ({ page }) => {
    const markup =
      variant === 'hidden'
        ? `<section class="[content-visibility:hidden]">${region}</section>`
        : variant === 'inert'
          ? `<section inert>${region}</section>`
          : variant === 'negative-tabindex'
            ? region.replace('tabindex="0"', 'tabindex="-1"')
            : variant === 'no-overflow'
              ? region.replace('w-[900px]', 'w-[100px]')
              : variant === 'no-table'
                ? region.replaceAll('table', 'aside')
                : variant === 'grid'
                  ? region.replace('<table ', '<table role="grid" ')
                  : variant === 'editable'
                    ? region.replace('role="region"', 'contenteditable="true" role="region"')
                    : region + '<dialog open>Open modal context</dialog>';
    await fixture(page, markup);
    const report = await inspectTableScroll(page);
    expect(report.observations).toEqual([]);
    expect(report.findings).toEqual([]);
  });

test('dependent requests are quarantined and cannot generate a failed scroll verdict', async ({
  page,
}) => {
  const guard = await fixture(
    page,
    region,
    'document.getElementById("scroll-region").onkeydown=e=>{e.preventDefault();fetch("/private-update",{method:"POST"}).catch(()=>{});};',
  );
  const report = await inspectTableScroll(page);
  expect(guard.counts().blockedRequests).toBeGreaterThan(0);
  expect(report.findings).toEqual([]);
  expect(report.observations[0]).toMatchObject({ status: 'unverified' });
});

test('rerendered table and focus theft invalidate the retained sample', async ({ page }) => {
  await fixture(
    page,
    region,
    'document.getElementById("scroll-region").onkeydown=e=>{e.preventDefault();document.getElementById("outside").focus();document.querySelector("table").replaceWith(document.createElement("table"));};',
  );
  const report = await inspectTableScroll(page);
  expect(report.findings).toEqual([]);
  expect(report.observations[0]).toMatchObject({ status: 'unverified' });
});

// A scripted but equivalent scroll contract calibrates all engines independently
// of their headless/native key-scroll policy; no API implementation is mandated.
test('authored keyboard scroll movement is accepted and exact offset is restored', async ({
  page,
}) => {
  await fixture(
    page,
    region,
    'document.getElementById("scroll-region").onkeydown=e=>{e.preventDefault();e.currentTarget.scrollLeft += e.key==="ArrowRight" ? 40 : -40;};',
  );
  await page.locator('#scroll-region').evaluate(el => (el.scrollLeft = 120));
  const report = await inspectTableScroll(page);
  expect(report.findings).toEqual([]);
  expect(report.observations[0]).toMatchObject({
    status: 'observed',
    samples: expect.arrayContaining([expect.objectContaining({ canMove: true, moved: true })]),
  });
  expect(await page.locator('#scroll-region').evaluate(el => el.scrollLeft)).toBe(120);
});

test('focus-triggered requests invalidate evidence before any key is sent', async ({ page }) => {
  const guard = await fixture(
    page,
    region,
    'document.getElementById("scroll-region").onfocus=()=>fetch("/private-focus",{method:"POST"}).catch(()=>{});',
  );
  const report = await inspectTableScroll(page);
  expect(guard.counts().blockedRequests).toBeGreaterThan(0);
  expect(report.findings).toEqual([]);
  expect(report.observations[0]).toMatchObject({ status: 'unverified' });
});

test('body focus restores without leaving the table as an artificial tab owner', async ({
  page,
}) => {
  await fixture(page, region);
  await page.locator('#outside').evaluate(el => el.blur());
  const report = await inspectTableScroll(page);
  expect(report.observations).toHaveLength(1);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

test('table keyboard sampling is bounded to five candidate regions', async ({ page }) => {
  const markup = Array.from({ length: 6 }, (_, i) =>
    region.replace('id="scroll-region"', `id="region-${i}"`),
  ).join('');
  const guard = await fixture(
    page,
    markup,
    'document.getElementById("region-5").onfocus=()=>fetch("/sixth-region").catch(()=>{});',
  );
  const report = await inspectTableScroll(page);
  expect(report.observations).toHaveLength(5);
  expect(report.perPageLimit).toBe(5);
  expect(guard.counts().blockedRequests).toBe(0);
});
