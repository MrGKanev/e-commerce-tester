import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { inspectModernWeb, attachModernWeb } from '../tests/modern-web';

const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
const image =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><rect width="320" height="120" fill="blue"/></svg>',
  );
const fixtureDocument = (body: string) =>
  `<!doctype html><html lang="en"><head><title>Local modern web fixture</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><main><h1>Local fixture</h1>${body}</main></body></html>`;

test('broken fixtures exercise every rule, retain evidence and never submit a form', async ({
  page,
}, info) => {
  const submissions: string[] = [];
  await page.route('**/*', route => {
    if (route.request().method() !== 'GET') submissions.push(route.request().method());
    return route.request().isNavigationRequest()
      ? route.fulfill({
          contentType: 'text/html',
          body: fixtureDocument(`
      <img id="hero" src="${image}" width="320" height="120" loading="lazy" fetchpriority="high" alt="Banner">
      <img src="${image}" width="10" height="10" fetchpriority="high" alt="">
      <img src="${image}" width="10" height="10" fetchpriority="high" alt="">
      <form method="get"><label for="password">Password</label><input id="password" type="password" autocomplete="off" value="never-record-this" aria-invalid="true" aria-describedby="missing-error"></form>
      <video id="video" src="/clip.mp4" controls></video>
      <div id="motion" class="size-4 animate-spin bg-blue-600">Motion</div>`),
        })
      : route.fulfill({ status: 204 });
  });
  await page.goto('http://127.0.0.1:45996/bad');
  const report = await inspectModernWeb(page);
  await attachModernWeb(report, info);
  expect([...new Set(report.findings.map(finding => finding.rule))].sort()).toEqual(
    expect.arrayContaining(
      [
        'image-lazy-high',
        'image-viewport-lazy',
        'image-high-overuse',
        'form-description-reference',
        'form-invalid-feedback',
        'form-password-get',
        'form-password-autofill',
        'video-captions',
        'motion-reduced-unchanged',
      ].sort(),
    ),
  );
  expect(
    report.findings.filter(finding => finding.severity === 'error').map(finding => finding.rule),
  ).toEqual(['form-description-reference']);
  expect(report.coverage).toMatchObject({
    images: 3,
    formControls: 1,
    videos: 1,
    motionSupported: true,
  });
  expect(
    report.findings.find(finding => finding.rule === 'form-description-reference'),
  ).toMatchObject({
    selector: '#password',
    evidence: { missing: [{ attribute: 'aria-describedby', id: 'missing-error' }] },
  });
  expect(JSON.stringify(report)).not.toContain('never-record-this');
  expect(submissions).toEqual([]);
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
    false,
  );
  expect(info.attachments.map(item => item.name)).toEqual(
    expect.arrayContaining(['modern-web.json', 'modern-web.txt']),
  );
});

test('correct alternatives, hidden controls and decorative video avoid false positives', async ({
  page,
}) => {
  await page.route('**/*', route =>
    route.request().isNavigationRequest()
      ? route.fulfill({
          contentType: 'text/html',
          body: fixtureDocument(`
      <img src="${image}" width="320" height="120" fetchpriority="high" alt="Banner">
      <form method="post"><label for="password">Password</label><input id="password" type="password" autocomplete="section-account current-password webauthn" aria-invalid="true" aria-describedby="help" aria-errormessage="error"><p id="help">Use your account password.</p><p id="error">Check the password.</p></form>
      <input type="hidden" aria-describedby="not-present"><div hidden><input type="password" aria-invalid="true" aria-describedby="not-present"></div>
      <input aria-invalid="false" aria-errormessage="deferred-error">
      <video src="/clip.mp4" controls><track kind="captions" src="/captions.vtt" srclang="en" label="English"></video>
      <video src="/decoration.mp4" autoplay muted></video>
      <div class="size-4 motion-safe:animate-spin bg-blue-600">Motion</div>`),
        })
      : route.fulfill({ status: 204 }),
  );
  await page.goto('http://127.0.0.1:45996/good');
  const report = await inspectModernWeb(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage.motionBaseline).toBe(1);
  expect(report.coverage.motionReduced).toBe(0);
});

test('slower reduced motion is accepted and an existing reduced preference is restored', async ({
  page,
}) => {
  await page.route('**/*', route =>
    route.fulfill({
      contentType: 'text/html',
      body: fixtureDocument('<div id="motion" class="size-4 bg-blue-600">Motion</div>'),
    }),
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('http://127.0.0.1:45996/slower');
  await page.evaluate(() => {
    const animation = document
      .getElementById('motion')!
      .animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
        duration: 1000,
        iterations: Infinity,
      });
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () =>
      animation.effect!.updateTiming({ duration: preference.matches ? 20000 : 1000 });
    preference.addEventListener('change', update);
    update();
  });
  const report = await inspectModernWeb(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage).toMatchObject({ motionBaseline: 1, motionReduced: 1 });
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
    true,
  );
});

test('empty scopes and unsupported animation inspection are explicit', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({
      contentType: 'text/html',
      body: fixtureDocument('<p>No applicable controls or media</p>'),
    }),
  );
  await page.goto('http://127.0.0.1:45996/empty');
  await page.evaluate(() => Object.defineProperty(document, 'getAnimations', { value: undefined }));
  const report = await inspectModernWeb(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage).toEqual({
    images: 0,
    formControls: 0,
    videos: 0,
    responseHeadersObserved: false,
    motionSupported: false,
    motionBaseline: 0,
    motionReduced: 0,
  });
});

test('long finite spatial motion is inspected while short decorative transitions are excluded', async ({
  page,
}) => {
  await page.route('**/*', route =>
    route.fulfill({
      contentType: 'text/html',
      body: fixtureDocument(
        '<div id="long" class="size-4 bg-blue-600">Long</div><div id="short" class="size-4 bg-blue-600">Short</div>',
      ),
    }),
  );
  await page.goto('http://127.0.0.1:45996/finite');
  await page.evaluate(() => {
    for (const [id, duration] of [
      ['long', 8000],
      ['short', 200],
    ] as const)
      document
        .getElementById(id)!
        .animate([{ transform: 'translateX(0)' }, { transform: 'translateX(40px)' }], {
          duration,
          fill: 'forwards',
        });
  });
  const report = await inspectModernWeb(page);
  expect(
    report.findings
      .filter(item => item.rule === 'motion-reduced-unchanged')
      .map(item => item.selector),
  ).toEqual(['#long']);
});
