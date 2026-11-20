// Source: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/user-experience/form-factor-adaptation.md
// Whole-control clipping is actionable; scrollable/positioned/transformed and
// partial boxes remain outside this geometry subset. Device descriptors exercise
// browser layout only: https://playwright.dev/docs/emulation (not OS/AT proof).
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { prepareInteractionProbe } from '../tests/modern-web-interactions';
import { inspectCheckboxes } from '../tests/modern-web-checkboxes';
import { inspectPresentation } from '../tests/modern-web-presentation';
const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
for (const scenario of [
  'hidden',
  'clip',
  'horizontal',
  'partial',
  'visible',
  'scrollable',
  'transformed',
  'absolute',
  'inert',
  'display-none',
  'clip-margin',
  'inside',
]) {
  test(`ancestor control clipping: ${scenario}`, async ({ page }, info) => {
    await page.route('**/*', route =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Control clipping</title><style>${css}</style><body class="bg-white text-slate-900"><main class="p-4"><h1 class="text-xl">Control visibility</h1><div ${scenario === 'inert' ? 'inert' : ''} class="flow-root h-16 w-48 ${scenario === 'visible' ? 'overflow-visible' : scenario === 'scrollable' ? 'overflow-auto' : scenario === 'clip' ? 'overflow-clip' : 'overflow-hidden'} ${scenario === 'transformed' ? 'translate-x-1' : ''} ${scenario === 'clip-margin' ? '[overflow-clip-margin:100px]' : ''}"><button type="button" class="block h-11 w-24 rounded border ${scenario === 'horizontal' ? 'ml-64' : scenario === 'partial' ? 'mt-8' : scenario === 'inside' ? '' : 'mt-24'} ${scenario === 'absolute' ? 'absolute' : ''} ${scenario === 'display-none' ? 'hidden' : ''}">Continue</button></div></main></body></html>`,
      }),
    );
    await page.goto('http://127.0.0.1:45996/ancestor-clipping');
    const viewport = page.viewportSize();
    await page.emulateMedia({ colorScheme: 'dark' });
    const report = await inspectPresentation(page);
    const findings = report.findings.filter(
      item => item.rule === 'presentation-control-ancestor-clip',
    );
    expect(findings, JSON.stringify(report.coverage.states)).toHaveLength(
      ['hidden', 'clip', 'horizontal'].includes(scenario) ||
        (scenario === 'clip-margin' &&
          !(await page.evaluate(() => CSS.supports('overflow-clip-margin', '100px'))))
        ? 2
        : 0,
    );
    for (const finding of findings)
      expect(finding).toMatchObject({
        guide: 'form-factor-adaptation',
        severity: 'warning',
        evidence: { wholeBorderBoxOutsideClip: true },
      });
    expect(page.viewportSize()).toEqual(viewport);
    expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(
      true,
    );
    expect(report.coverage.osTextScaleNotEmulated).toBe(true);
    expect(report.coverage.states.filter(state => state.name === 'viewport')).toEqual([
      expect.objectContaining({
        requested: { width: 320, height: 800 },
        partialControlAndGlyphClippingVerified: false,
      }),
      expect.objectContaining({
        requested: { width: 844, height: 390 },
        ancestorControlLimit: 100,
        ancestorDepthLimit: 32,
      }),
    ]);
    if (scenario === 'inside' && ['Desktop Chrome', 'Mobile Chrome'].includes(info.project.name))
      await page.screenshot({ path: info.outputPath('control-visibility.png'), fullPage: true });
  });
}

test('touch/keyboard descriptor state survives guarded checkbox and presentation probes', async ({
  page,
}, info) => {
  // Playwright's hasTouch descriptor enables browser touch events, not an OS
  // keyboard, mobile Safari binary, IME engine or screen-reader speech.
  await page.route('**/*', route =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Input methods</title><style>${css}</style><body class="bg-white text-slate-900"><main class="p-4"><h1>Input methods</h1><label class="inline-flex min-h-11 items-center gap-2"><input type="checkbox">Enable updates</label></main></body></html>`,
    }),
  );
  await page.goto('http://127.0.0.1:45996/input-methods');
  const touch = Boolean(info.project.use.hasTouch);
  const descriptor = await page.evaluate(() => ({
    coarse: matchMedia('(pointer: coarse)').matches,
    touchPoints: navigator.maxTouchPoints,
  }));
  expect(descriptor.coarse).toBe(touch);
  // WebKit on this macOS runner exposes zero maxTouchPoints even with
  // hasTouch/coarse pointer enabled. Verify actual trusted pointer delivery
  // instead of manufacturing a navigator value or calling this a real iPhone.
  if (!info.project.name.includes('WebKit')) expect(descriptor.touchPoints > 0).toBe(touch);
  await info.attach('emulated-input-capabilities.json', {
    body: JSON.stringify({
      project: info.project.name,
      hasTouch: touch,
      ...descriptor,
      realDeviceVerified: false,
    }),
    contentType: 'application/json',
  });
  await page.evaluate(() => {
    document.addEventListener('pointerdown', event => {
      (window as unknown as { probePointer: { type: string; trusted: boolean } }).probePointer = {
        type: event.pointerType,
        trusted: event.isTrusted,
      };
    });
  });
  if (touch) {
    await page.locator('label').tap();
    expect(
      await page.evaluate(() => (window as unknown as { probePointer: unknown }).probePointer),
    ).toEqual({ type: 'touch', trusted: true });
  } else {
    await page.locator('input').focus();
    await page.keyboard.press('Space');
  }
  await expect(page.locator('input')).toBeChecked();
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  const guard = await prepareInteractionProbe(page);
  await guard.freeze();
  {
    const checkboxes = await inspectCheckboxes(page);
    expect(checkboxes.findings).toEqual([]);
    expect(checkboxes.observations[0]).toMatchObject({
      keysSent: 2,
      before: { checked: 'true' },
      toggled: { checked: 'false' },
      restored: { checked: 'true' },
      restoration: { status: 'restored', method: 'keyboard' },
    });
    const presentation = await inspectPresentation(page);
    expect(
      presentation.findings.filter(item => item.rule === 'presentation-control-ancestor-clip'),
    ).toEqual([]);
    await expect(page.locator('input')).toBeChecked();
    expect(
      await page.evaluate(() => ({
        reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
        dark: matchMedia('(prefers-color-scheme: dark)').matches,
        coarse: matchMedia('(pointer: coarse)').matches,
      })),
    ).toEqual({ reduced: true, dark: true, coarse: touch });
  }
});

for (const scenario of ['candidate-limit', 'depth-limit', 'display-contents', 'opacity-zero']) {
  test(`ancestor clipping exclusions: ${scenario}`, async ({ page }) => {
    const button = '<button type="button" class="mt-24 block h-11 w-24">Continue</button>';
    const depth = '<div>'.repeat(33) + button + '</div>'.repeat(33);
    await page.route('**/*', route =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Clipping bounds</title><style>${css}</style><body><main><h1>Clipping bounds</h1>${scenario === 'candidate-limit' ? '<input hidden>'.repeat(100) : ''}<div class="${scenario === 'display-contents' ? 'contents' : 'flow-root'} h-16 w-48 overflow-hidden ${scenario === 'opacity-zero' ? 'opacity-0' : ''}">${scenario === 'depth-limit' ? depth : button}</div></main></body></html>`,
      }),
    );
    await page.goto('http://127.0.0.1:45996/clipping-bounds');
    const report = await inspectPresentation(page);
    expect(
      report.findings.filter(item => item.rule === 'presentation-control-ancestor-clip'),
    ).toEqual([]);
    // Hidden text inputs consume the initial candidate budget; a later
    // control must not be sampled by filtering and then refilling that budget.
    if (scenario === 'candidate-limit')
      expect(report.coverage.states[0].ancestorSampleLimited).toBe(true);
  });
}
