// Source: form-factor-adaptation requires controls to remain visible.
// https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/user-experience/form-factor-adaptation.md
// This passive border-box sample does not establish glyph or picker visibility.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { inspectPresentation } from '../tests/modern-web-presentation';

const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
const controls = [
  { name: 'input', tag: 'input', content: '', field: true },
  { name: 'textarea', tag: 'textarea', content: '', field: true },
  { name: 'select', tag: 'select', content: '<option>Choice</option>', field: true },
  { name: 'button', tag: 'button', content: 'Continue', field: false },
] as const;
const layouts = [
  {
    name: 'fits-width',
    outer: 'flow-root w-48 overflow-hidden',
    control: 'block h-11 w-48',
    outcome: 'clear',
  },
  {
    name: 'fits-height',
    outer: 'flow-root h-11 overflow-hidden',
    control: 'block h-11 w-48',
    outcome: 'clear',
  },
  {
    name: 'visible-overflow',
    outer: 'flow-root w-32 overflow-visible',
    control: 'block h-11 w-48',
    outcome: 'clear',
  },
  {
    name: 'padded-contained',
    outer: 'flow-root w-64 overflow-hidden border-4 p-2',
    control: 'block h-11 w-48',
    outcome: 'clear',
  },
  {
    name: 'partial-right',
    outer: 'flow-root w-32 overflow-hidden',
    control: 'block h-11 w-48',
    outcome: 'partial',
  },
  {
    name: 'partial-bottom',
    outer: 'flow-root h-8 overflow-hidden',
    control: 'mt-4 block h-11 w-48',
    outcome: 'partial',
  },
  {
    name: 'hidden-right',
    outer: 'flow-root w-32 overflow-hidden',
    control: 'ml-64 block h-11 w-48',
    outcome: 'full',
  },
  {
    name: 'hidden-bottom',
    outer: 'flow-root h-8 overflow-hidden',
    control: 'mt-16 block h-11 w-48',
    outcome: 'full',
  },
  {
    name: 'clip-right',
    outer: 'flow-root w-32 overflow-clip',
    control: 'block h-11 w-48',
    outcome: 'partial',
  },
  {
    name: 'clip-bottom',
    outer: 'flow-root h-8 overflow-clip',
    control: 'mt-4 block h-11 w-48',
    outcome: 'partial',
  },
  {
    name: 'hidden-ignores-margin',
    outer: 'flow-root w-32 overflow-hidden [overflow-clip-margin:100px]',
    control: 'block h-11 w-48',
    outcome: 'partial',
  },
  {
    name: 'flex-no-shrink',
    outer: 'flex w-32 overflow-hidden',
    control: 'block h-11 w-48 shrink-0',
    outcome: 'partial',
  },
  {
    name: 'grid-wide-item',
    outer: 'grid w-32 overflow-hidden',
    control: 'block h-11 w-48 min-w-48',
    outcome: 'partial',
  },
  {
    name: 'nested-axes',
    outer: 'flow-root w-32 overflow-x-hidden',
    inner: 'flow-root h-8 w-64 overflow-y-hidden',
    control: 'mt-4 block h-11 w-48',
    outcome: 'partial',
  },
] as const;

for (const control of controls) {
  for (const layout of layouts) {
    test(`control clipping ${control.name}: ${layout.name}`, async ({ page }, info) => {
      const markup = `<${control.tag} aria-label="Control" class="${layout.control} border p-2">${control.content}</${control.tag}>`;
      const inner = 'inner' in layout ? `<div class="${layout.inner}">${markup}</div>` : markup;
      await page.route('**/*', route =>
        route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html lang="en"><head><title>Control clipping</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body class="bg-white text-slate-900"><main class="p-4"><h1>Control clipping</h1><div class="${layout.outer}">${inner}</div></main></body></html>`,
        }),
      );
      await page.goto('http://127.0.0.1:45996/control-clipping-matrix');
      const before = await page.content();
      const viewport = page.viewportSize();
      let requests = 0;
      page.on('request', () => requests++);
      const report = await inspectPresentation(page);
      expect(await page.content()).toBe(before);
      expect(page.viewportSize()).toEqual(viewport);
      expect(requests).toBe(0);
      const states = report.coverage.states.filter(state => state.name === 'viewport');
      expect(states).toHaveLength(2);
      for (const state of states) {
        const partial = state.ancestorPartiallyClipped as Array<{
          width: number;
          height: number;
          visibleWidth: number;
          visibleHeight: number;
        }>;
        const full = state.ancestorClipped as string[];
        expect(full).toHaveLength(layout.outcome === 'full' ? 1 : 0);
        expect(partial).toHaveLength(layout.outcome === 'partial' ? 1 : 0);
        expect(state.fieldSizing).toHaveLength(control.field ? 1 : 0);
        expect(state.partialControlAndGlyphClippingVerified).toBe(false);
        if (layout.outcome === 'partial') {
          expect(partial[0].visibleWidth).toBeGreaterThan(0);
          expect(partial[0].visibleHeight).toBeGreaterThan(0);
          expect(
            partial[0].visibleWidth < partial[0].width ||
              partial[0].visibleHeight < partial[0].height,
          ).toBe(true);
          if (layout.name === 'nested-axes') {
            expect(partial[0].visibleWidth).toBeLessThan(partial[0].width);
            expect(partial[0].visibleHeight).toBeLessThan(partial[0].height);
          }
        }
      }
      const clippingFindings = report.findings.filter(f =>
        [
          'presentation-control-ancestor-clip',
          'presentation-control-partial-ancestor-clip',
        ].includes(f.rule),
      );
      expect(clippingFindings).toHaveLength(layout.outcome === 'clear' ? 0 : 2);
      for (const finding of clippingFindings) {
        expect(finding.severity).toBe('warning');
        expect(finding.rule).toBe(
          layout.outcome === 'full'
            ? 'presentation-control-ancestor-clip'
            : 'presentation-control-partial-ancestor-clip',
        );
      }
      if (
        control.name === 'button' &&
        ['flex-no-shrink', 'nested-axes'].includes(layout.name) &&
        ['Desktop Chrome', 'Mobile Chrome'].includes(info.project.name)
      )
        await page.screenshot({ path: info.outputPath('control-clipping.png'), fullPage: true });
    });
  }
}
