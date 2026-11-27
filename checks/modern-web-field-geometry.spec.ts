// Sources: preserve fixed sizing fallbacks, min/max constraints and real border
// box evidence. No field-sizing adoption, glyph or native picker requirement.
// https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/form-fields-automatically-fit-contents.md
// https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/user-experience/form-factor-adaptation.md
// CSS clip margins affect clip, not hidden padding-box clipping:
// https://drafts.csswg.org/css-overflow-3/#overflow-clip-margin
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { inspectPresentation } from '../tests/modern-web-presentation';
const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
const input = (classes: string, attributes = '') =>
  `<label for="field" class="block">Message</label><input id="field" name="message" type="text" class="block ${classes}" ${attributes}>`;
const clippedInput =
  '<input aria-label="Message" class="mt-4 block h-11 w-48 rounded border border-slate-500 p-2">';
const cases = [
  { name: 'minimum', html: input('w-0 min-w-16 max-w-48 h-11 border-0 p-0'), width: 64 },
  { name: 'maximum', html: input('w-[600px] min-w-16 max-w-48 h-11 border-0 p-0'), width: 192 },
  {
    name: 'logical-limits',
    html: input('w-[600px] [min-inline-size:64px] [max-inline-size:192px] h-11 border-0 p-0'),
    width: 192,
  },
  {
    name: 'progressive-bounded',
    html: input(
      'field-sizing-content w-auto min-w-16 max-w-48 h-11 rounded border border-slate-500 p-2',
      'value="Long native field content that remains privately inside the fixture"',
    ),
  },
  { name: 'disabled-zero', html: input('h-0 w-0 min-w-0 border-0 p-0', 'disabled'), zero: true },
  { name: 'readonly-zero', html: input('h-0 w-0 min-w-0 border-0 p-0', 'readonly'), zero: true },
  {
    name: 'fieldset-disabled-zero',
    html: `<fieldset disabled>${input('h-0 w-0 min-w-0 border-0 p-0')}</fieldset>`,
    zero: true,
  },
  { name: 'disabled-overflow', html: input('w-[1000px] h-11 border-0 p-0', 'disabled') },
  { name: 'readonly-overflow', html: input('w-[1000px] h-11 border-0 p-0', 'readonly') },
  {
    name: 'textarea-limits',
    html: '<label for="field">Message</label><textarea id="field" class="block w-48 max-w-full min-h-16 max-h-32 overflow-auto rounded border border-slate-500 p-2" rows="10">Private content</textarea>',
    height: 128,
  },
  {
    name: 'partial-x',
    html: '<div class="flow-root w-32 overflow-x-hidden">' + clippedInput + '</div>',
    partial: true,
  },
  {
    name: 'partial-y',
    html: '<div class="flow-root h-8 overflow-y-hidden">' + clippedInput + '</div>',
    partial: true,
  },
  {
    name: 'nested-two-axis',
    html:
      '<div class="flow-root w-32 overflow-x-hidden"><div class="flow-root h-8 w-64 overflow-y-hidden">' +
      clippedInput +
      '</div></div>',
    partial: true,
  },
  {
    name: 'textarea-partial-y',
    html: '<div class="flow-root h-8 overflow-hidden"><textarea aria-label="Message" class="mt-4 block h-11 w-48 border p-2"></textarea></div>',
    partial: true,
  },
  {
    name: 'select-partial-x',
    html: '<div class="flow-root w-32 overflow-hidden"><select aria-label="Choice" class="block h-11 w-48 border p-2"><option>First</option></select></div>',
    partial: true,
  },
  {
    name: 'input-fully-clipped',
    html: '<div class="flow-root h-8 overflow-hidden"><input aria-label="Message" class="mt-16 block h-11 w-48 border p-2"></div>',
    full: true,
  },
  {
    name: 'input-exact-width',
    html: '<div class="flow-root w-48 overflow-hidden"><input aria-label="Message" class="block h-11 w-48 border p-2"></div>',
  },
  {
    name: 'input-fit-inside-padded-clip',
    html: '<div class="flow-root w-64 overflow-hidden border-4 p-2"><input aria-label="Message" class="block h-11 w-48 border p-2"></div>',
  },
  {
    name: 'padded-border-clip',
    html:
      '<div class="flow-root h-16 w-40 overflow-hidden border-4 p-2">' + clippedInput + '</div>',
    partial: true,
  },
  {
    name: 'hidden-ignored-clip-margin',
    html:
      '<div class="flow-root h-8 overflow-hidden [overflow-clip-margin:100px]">' +
      clippedInput +
      '</div>',
    partial: true,
  },
  {
    name: 'custom-clip-margin',
    html:
      '<div class="flow-root h-8 overflow-clip [overflow-clip-margin:100px]">' +
      clippedInput +
      '</div>',
    customClip: true,
  },
  {
    name: 'relative-clip',
    html: '<div class="relative flow-root h-8 overflow-hidden">' + clippedInput + '</div>',
    partial: true,
  },
  {
    name: 'fixed-unknown',
    html: '<div class="fixed h-8 overflow-hidden">' + clippedInput + '</div>',
    excluded: true,
  },
  {
    name: 'clip-path-unknown',
    html:
      '<div class="flow-root h-8 overflow-hidden [clip-path:inset(0)]">' + clippedInput + '</div>',
    excluded: true,
  },
  {
    name: 'zoom-unknown',
    html: '<div class="flow-root h-8 overflow-hidden [zoom:2]">' + clippedInput + '</div>',
    excluded: true,
  },
];
for (const scenario of cases) {
  test(`field geometry boundaries: ${scenario.name}`, async ({ page }, info) => {
    await page.route('**/*', route =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Field geometry</title><style>${css}</style><body class="bg-white text-slate-900"><main class="space-y-4 p-4"><h1 class="text-xl">Field geometry</h1>${scenario.html}</main></body></html>`,
      }),
    );
    await page.goto('http://127.0.0.1:45996/field-geometry');
    const viewport = page.viewportSize();
    const before = await page.content();
    let requests = 0;
    page.on('request', () => requests++);
    const result = await inspectPresentation(page);
    expect(page.viewportSize()).toEqual(viewport);
    expect(await page.content()).toEqual(before);
    expect(requests).toBe(0);
    const states = result.coverage.states.filter(s => s.name === 'viewport');
    const marginSupported = await page.evaluate(() =>
      CSS.supports('overflow-clip-margin', '100px'),
    );
    const partial = scenario.partial || (scenario.customClip && !marginSupported);
    const relevant = result.findings.filter(f =>
      [
        'field-sizing-zero-box',
        'field-sizing-page-overflow',
        'presentation-control-ancestor-clip',
        'presentation-control-partial-ancestor-clip',
      ].includes(f.rule),
    );
    expect(relevant).toHaveLength(partial || scenario.full ? 2 : 0);
    for (const finding of relevant)
      expect(finding).toMatchObject({
        rule: scenario.full
          ? 'presentation-control-ancestor-clip'
          : 'presentation-control-partial-ancestor-clip',
        severity: 'warning',
        evidence: scenario.full
          ? { wholeBorderBoxOutsideClip: true }
          : { glyphVisibilityVerified: false },
      });
    for (const state of states) {
      const fields = state.fieldSizing as Array<Record<string, number | boolean>>;
      expect(state.nativeSelectTextAndPickerVerified).toBe(false);
      expect(state.partialControlAndGlyphClippingVerified).toBe(false);
      if (scenario.excluded) expect(fields).toEqual([]);
      else {
        expect(fields).toHaveLength(1);
        if (scenario.width) expect(fields[0].width).toBe(scenario.width);
        if (scenario.height) expect(fields[0].height).toBe(scenario.height);
        if (scenario.zero) expect(fields[0].zeroBox).toBe(true);
        if (scenario.name === 'progressive-bounded') {
          expect(Number(fields[0].width)).toBeGreaterThanOrEqual(64);
          expect(Number(fields[0].width)).toBeLessThanOrEqual(192);
        }
      }
      if (partial) {
        const clips = state.ancestorPartiallyClipped as Array<Record<string, number>>;
        expect(clips).toHaveLength(1);
        expect(clips[0].visibleWidth).toBeGreaterThan(0);
        expect(clips[0].visibleHeight).toBeGreaterThan(0);
        expect(clips[0].visibleWidth).toBeLessThanOrEqual(clips[0].width);
        expect(clips[0].visibleHeight).toBeLessThanOrEqual(clips[0].height);
        if (scenario.name === 'nested-two-axis') {
          expect(clips[0].visibleWidth).toBeLessThan(clips[0].width);
          expect(clips[0].visibleHeight).toBeLessThan(clips[0].height);
        }
      }
      if (scenario.full) {
        expect(state.ancestorClipped).toHaveLength(1);
        expect(state.ancestorPartiallyClipped).toEqual([]);
      }
    }
    if (
      [
        'progressive-bounded',
        'padded-border-clip',
        'nested-two-axis',
        'textarea-partial-y',
        'select-partial-x',
        'input-fully-clipped',
        'input-fit-inside-padded-clip',
      ].includes(scenario.name) &&
      ['Desktop Chrome', 'Mobile Chrome'].includes(info.project.name)
    )
      await page.screenshot({ path: info.outputPath('field-geometry.png'), fullPage: true });
  });
}
