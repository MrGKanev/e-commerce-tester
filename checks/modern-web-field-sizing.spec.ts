// Sources: field sizing accepts fixed/internal scrolling as a fallback; simple
// parent clipping is measured, not native picker text/OS appearance or glyphs.
// https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/form-fields-automatically-fit-contents.md
// https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/user-experience/form-factor-adaptation.md
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { inspectPresentation } from '../tests/modern-web-presentation';
const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
for (const scenario of [
  'fixed-fallback',
  'content-enhancement',
  'zero-input',
  'wide-select',
  'local-scroll',
  'partial',
  'nested-partial',
  'hidden-parent',
  'proxy-checkbox',
  'auto-scope',
]) {
  test(`field sizing and clipping: ${scenario}`, async ({ page }, info) => {
    const inputClass =
      scenario === 'zero-input'
        ? 'h-0 w-0 min-w-0 border-0 p-0'
        : scenario === 'content-enhancement'
          ? 'w-auto min-w-16 max-w-full field-sizing-content'
          : 'w-32 max-w-full';
    const selectClass = ['wide-select', 'local-scroll'].includes(scenario)
      ? 'w-[600px]'
      : 'w-48 max-w-full';
    const fields = `<label for="input">Name</label><input id="input" type="text" class="block ${inputClass} ${scenario === 'zero-input' ? '' : 'rounded border border-slate-500 p-2'}"><label for="select">Choice</label><select id="select" class="block ${selectClass} rounded border border-slate-500 p-2"><option>Current choice</option></select>`;
    const body =
      scenario === 'partial'
        ? '<div class="flow-root h-8 overflow-hidden"><input aria-label="Message" class="mt-4 block h-11 w-32 rounded border border-slate-500 p-2"></div>'
        : scenario === 'nested-partial'
          ? '<div class="flow-root w-32 overflow-hidden"><div class="flow-root h-8 w-48 overflow-hidden"><input aria-label="Message" class="mt-4 block h-11 w-48 rounded border border-slate-500 p-2"></div></div>'
          : scenario === 'auto-scope'
            ? '<div class="[content-visibility:auto]"><input aria-label="Deferred" class="h-0 w-0 min-w-0 border-0 p-0"></div>'
            : scenario === 'proxy-checkbox'
              ? '<label><input type="checkbox" class="h-0 w-0 border-0 p-0">Choice</label>'
              : scenario === 'hidden-parent'
                ? `<div class="hidden">${fields}</div>`
                : scenario === 'local-scroll'
                  ? `<div class="overflow-x-auto">${fields}</div>`
                  : fields;
    await page.route('**/*', route =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Field sizing</title><style>${css}</style><body class="bg-white text-slate-900"><main class="space-y-4 p-4"><h1>Field sizing</h1>${body}</main></body></html>`,
      }),
    );
    await page.goto('http://127.0.0.1:45996/field-sizing');
    const result = await inspectPresentation(page);
    const relevant = result.findings.filter(f =>
      [
        'field-sizing-zero-box',
        'field-sizing-page-overflow',
        'presentation-control-partial-ancestor-clip',
      ].includes(f.rule),
    );
    if (scenario === 'auto-scope') {
      const supported = await page.evaluate(() => CSS.supports('content-visibility', 'auto'));
      expect(relevant.filter(f => f.rule === 'field-sizing-zero-box')).toHaveLength(
        supported ? 0 : 2,
      );
    } else if (scenario === 'zero-input')
      expect(relevant.filter(f => f.rule === 'field-sizing-zero-box')).toHaveLength(2);
    else if (scenario === 'wide-select')
      expect(relevant.filter(f => f.rule === 'field-sizing-page-overflow')).toHaveLength(1);
    else if (scenario.includes('partial')) {
      expect(
        relevant.filter(f => f.rule === 'presentation-control-partial-ancestor-clip'),
      ).toHaveLength(2);
      expect(relevant.every(f => f.evidence.glyphVisibilityVerified === false)).toBe(true);
    } else expect(relevant).toEqual([]);
    expect(
      result.coverage.states
        .filter(s => s.name === 'viewport')
        .every(s => s.nativeSelectTextAndPickerVerified === false),
    ).toBe(true);
    if (['hidden-parent', 'proxy-checkbox'].includes(scenario))
      expect(result.coverage.states[0].fieldSizing).toEqual([]);
    if (
      ['fixed-fallback', 'content-enhancement', 'partial'].includes(scenario) &&
      ['Desktop Chrome', 'Mobile Chrome'].includes(info.project.name)
    )
      await page.screenshot({ path: info.outputPath('field-sizing.png'), fullPage: true });
  });
}
