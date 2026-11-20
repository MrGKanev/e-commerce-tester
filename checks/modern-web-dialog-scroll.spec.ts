import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { prepareInteractionProbe } from '../tests/modern-web-interactions';
import { inspectDialogScroll } from '../tests/modern-web-dialog-scroll';

const url = 'http://127.0.0.1:45996/dialog-scroll';
const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
async function fixture(page: import('@playwright/test').Page, body: string, script = '') {
  const guard = await prepareInteractionProbe(page);
  await page.route('**/*', route =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><head><title>Dialog scroll fixture</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><main><h1>Dialog scroll</h1>${body}</main><script>${script}</script></body></html>`,
    }),
  );
  await page.goto(url);
  await guard.freeze();
  return guard;
}
const modal =
  '<dialog id="modal" class="m-auto h-[200px] w-[240px] overflow-auto p-4"><p>Modal content</p></dialog>';
const background = '<div class="h-[300vh]">Scrollable background</div>';

test('scroll probe requires quarantine and absent modal stays not observed', async ({ page }) => {
  await page.goto('about:blank');
  await expect(inspectDialogScroll(page)).rejects.toThrow('freeze()');
  await fixture(page, background);
  const report = await inspectDialogScroll(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage).toMatchObject({
    applicable: false,
    status: 'not-observed',
    reason: 'no-open-native-modal',
  });
});

test('wheel leak is advisory and page/modal scroll restore without closing UI', async ({
  page,
}, info) => {
  await fixture(
    page,
    `${background}${modal}`,
    'scrollTo(0,100);document.querySelector("dialog").showModal();',
  );
  const before = await page.evaluate(() => scrollY);
  const report = await inspectDialogScroll(page, { x: 0, y: 0 });
  expect(report.coverage).toMatchObject({
    applicable: true,
    status: info.project.name === 'Mobile WebKit' ? 'unverified' : 'observed',
    restored: { y: before },
    pointerRestoration: 'caller-supplied-origin',
  });
  // Fixture calibrates observed behavior rather than asserting all engines implement the same gap.
  const moved = report.coverage.observations.filter(item => item.backgroundMoved === true);
  expect(report.findings).toHaveLength(moved.length);
  expect(
    report.findings.every(
      item => item.rule === 'dialog-background-scroll' && item.severity === 'warning',
    ),
  ).toBe(true);
  await expect(page.locator('dialog:modal')).toHaveCount(1);
});

test('event-contained wheel fixture does not move the background and sends no requests', async ({
  page,
}) => {
  const guard = await fixture(
    page,
    `${background}${modal}`,
    'document.querySelector("dialog").showModal();document.addEventListener("wheel",event=>event.preventDefault(),{passive:false});',
  );
  const report = await inspectDialogScroll(page);
  expect(report.findings).toEqual([]);
  expect(
    report.coverage.observations
      .filter(item => item.status === 'observed')
      .every(item => item.backgroundMoved === false),
  ).toBe(true);
  expect(guard.counts().blockedRequests).toBe(0);
});

test('fullscreen modal exposes unavailable backdrop sample explicitly', async ({ page }) => {
  await fixture(
    page,
    `${background}<dialog class="fixed inset-0 m-0 h-screen max-h-none w-screen max-w-none p-4">Full viewport modal</dialog>`,
    'document.querySelector("dialog").showModal();',
  );
  const report = await inspectDialogScroll(page);
  expect(report.coverage.observations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'backdrop',
        status: 'unverified',
        reason: 'no-exposed-backdrop-space',
      }),
    ]),
  );
});

test('unscrollable background is unverified rather than a containment pass', async ({ page }) => {
  await fixture(page, modal, 'document.querySelector("dialog").showModal();');
  const report = await inspectDialogScroll(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage).toMatchObject({
    status: 'unverified',
    observations: [{ status: 'unverified', reason: 'background-has-no-vertical-scroll-range' }],
  });
});

test('CSS-contained modal records engine behavior without using syntax support as a pass', async ({
  page,
}, info) => {
  await fixture(
    page,
    `${background}<dialog class="m-auto h-[200px] w-[240px] overflow-auto overscroll-contain p-4 backdrop:overflow-hidden backdrop:overscroll-contain"><div class="h-[300vh]">Scrollable modal content</div></dialog>`,
    'document.querySelector("dialog").showModal();',
  );
  const report = await inspectDialogScroll(page);
  expect(report.coverage).toMatchObject({
    cssSyntaxDoesNotEstablishBehaviorSupport: true,
    wheelOnly: true,
    touchOrKeyboardEmulated: false,
  });
  if (info.project.name === 'Mobile WebKit')
    expect(report.coverage.observations).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'wheel-operation-unsupported' })]),
    );
  else
    expect(
      report.coverage.observations.some(
        item => item.kind === 'content-boundary' && item.status === 'observed',
      ),
    ).toBe(true);
  await page.screenshot({
    path: `/tmp/dialog-scroll-${info.project.name.replaceAll(' ', '-')}.png`,
  });
});

test('owned broken wheel handler reliably exposes background movement as advisory evidence', async ({
  page,
}, info) => {
  await fixture(
    page,
    `${background}${modal}`,
    'scrollTo(0,100);document.querySelector("dialog").showModal();document.addEventListener("wheel",event=>{event.preventDefault();scrollBy(0,event.deltaY);},{passive:false});',
  );
  const report = await inspectDialogScroll(page);
  if (info.project.name === 'Mobile WebKit') {
    expect(report.coverage.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'unverified', reason: 'wheel-operation-unsupported' }),
      ]),
    );
    expect(report.findings).toEqual([]);
  } else expect(report.findings.length).toBeGreaterThan(0);
  expect(
    report.findings.every(
      finding => finding.rule === 'dialog-background-scroll' && finding.severity === 'warning',
    ),
  ).toBe(true);
  expect(report.coverage.restored?.y).toBe(report.coverage.initial?.y);
});

test('stacked native modals remain unverified when opening order differs from DOM order', async ({
  page,
}) => {
  await fixture(
    page,
    `${background}<dialog id="first">First</dialog><dialog id="second">Second</dialog>`,
    'document.getElementById("second").showModal();document.getElementById("first").showModal();',
  );
  const before = await page.evaluate(() => scrollY);
  const report = await inspectDialogScroll(page);
  expect(report.coverage).toMatchObject({
    applicable: false,
    status: 'unverified',
    reason: 'stacked-native-modals',
    stackedModalCount: 2,
  });
  expect(report.findings).toEqual([]);
  expect(await page.evaluate(() => scrollY)).toBe(before);
  await expect(page.locator('dialog:modal')).toHaveCount(2);
});
