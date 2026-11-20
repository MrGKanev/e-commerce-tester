// Sources: https://html.spec.whatwg.org/multipage/tables.html#the-table-element
// https://html.spec.whatwg.org/multipage/tables.html#forming-a-table (step 20)
// https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-atoms/responsive-table.md
// Empty cells cover slots. Span coverage is not cell anchoring; neither numeric
// model test certifies inferred header relationships, CSS appearance or AT speech.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { inspectDataWidgets } from '../tests/modern-web-data-widgets';
const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
const cases = [
  {
    name: 'ordinary',
    body: '<tr><th>A</th><th>B</th></tr><tr><td>C</td><td>D</td></tr>',
    gaps: 0,
    rows: 0,
    columns: 0,
  },
  {
    name: 'ragged',
    body: '<tr><th>A</th><th>B</th></tr><tr><td>C</td></tr>',
    gaps: 1,
    rows: 0,
    columns: 0,
  },
  {
    name: 'explicit-empty-cell',
    body: '<tr><th>A</th><th>B</th></tr><tr><td></td><td></td></tr>',
    gaps: 0,
    rows: 0,
    columns: 0,
  },
  {
    name: 'valid-rowspan',
    body: '<tr><th rowspan="2">A</th><th>B</th></tr><tr><td>C</td></tr>',
    gaps: 0,
    rows: 0,
    columns: 0,
  },
  {
    name: 'covered-empty-row',
    body: '<tr><th rowspan="2">A</th><th rowspan="2">B</th></tr><tr class="h-8"></tr>',
    gaps: 0,
    rows: 1,
    columns: 0,
  },
  {
    name: 'uncovered-empty-row',
    body: '<tr><th>A</th><th>B</th></tr><tr class="h-8"></tr><tr><td>C</td><td>D</td></tr>',
    gaps: 2,
    rows: 1,
    columns: 0,
  },
  {
    name: 'only-spanned-column',
    body: '<tr><th colspan="2">A</th></tr><tr><td colspan="2">B</td></tr>',
    gaps: 0,
    rows: 0,
    columns: 1,
  },
  {
    name: 'later-column-anchor',
    body: '<tr><th colspan="2">A</th></tr><tr><td>B</td><td>C</td></tr>',
    gaps: 0,
    rows: 0,
    columns: 0,
  },
  {
    name: 'cross-group-width',
    body: '<thead><tr><th>A</th><th>B</th><th>C</th></tr></thead><tbody><tr><td>D</td><td>E</td></tr></tbody>',
    gaps: 1,
    rows: 0,
    columns: 0,
  },
  {
    name: 'partly-covered-empty-row',
    body: '<tr><th rowspan="2">A</th><th>B</th></tr><tr class="h-8"></tr>',
    gaps: 1,
    rows: 1,
    columns: 0,
  },
  {
    name: 'zero-rowspan',
    body: '<tr><th rowspan="0">A</th><th>B</th></tr><tr><td>C</td></tr>',
    gaps: 0,
    rows: 0,
    columns: 0,
  },
  {
    name: 'zero-rowspan-empty-row',
    body: '<tr><th rowspan="0">A</th><th rowspan="0">B</th></tr><tr class="h-8"></tr>',
    gaps: 0,
    rows: 1,
    columns: 0,
  },
  {
    name: 'deferred-footer-anchors',
    body: '<tfoot><tr><td colspan="2">Total</td></tr></tfoot><tbody><tr><th>A</th><th>B</th></tr></tbody>',
    gaps: 0,
    rows: 0,
    columns: 0,
  },
  {
    name: 'column-boundary',
    body: '<tr><th colspan="128">A</th></tr><tr><td>B</td></tr>',
    gaps: 127,
    rows: 0,
    columns: 127,
  },
  {
    name: 'declared-columns',
    body: '<colgroup span="3"></colgroup><tr><th>A</th><th>B</th></tr>',
    gaps: 1,
    rows: 0,
    columns: 1,
  },
  {
    name: 'overlap',
    body: '<tr><th>A</th><th rowspan="2">B</th></tr><tr><td colspan="2">C</td></tr>',
    reason: 'overlapping-model',
  },
  {
    name: 'implicit-rows',
    body: '<tr><th rowspan="3">A</th><th>B</th></tr><tr><td>C</td></tr>',
    gaps: 1,
    rows: 1,
    columns: 0,
  },
  {
    name: 'hidden-cell',
    body: '<tr><th>A</th><th hidden>B</th></tr>',
    reason: 'non-native-or-hidden-cell',
  },
  {
    name: 'stacked',
    body: '<tr><th>A</th><th>B</th></tr><tr><td>C</td></tr>',
    reason: 'non-native-table-layout',
  },
  { name: 'column-limit', body: '<tr><th colspan="129">A</th></tr>', reason: 'column-limit' },
  {
    name: 'no-column-grid',
    body: '<tbody><tr class="h-8"></tr></tbody>',
    reason: 'zero-dimension-grid',
  },
];
for (const example of cases)
  test(`table grid coverage: ${example.name}`, async ({ page }, info) => {
    let requests = 0;
    await page.route('**/*', route => {
      requests++;
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Table grid</title><style>${css}</style><body class="bg-white text-slate-900"><main class="space-y-4 p-4"><h1 class="text-2xl">Table grid</h1><div class="overflow-x-auto"><table class="h-8 w-full border-separate border-spacing-2 [&_td]:p-2 [&_th]:p-2 ${example.name === 'stacked' ? 'block' : ''}"><caption>Local comparison</caption>${example.body}</table></div></main></body></html>`,
      });
    });
    await page.goto('http://127.0.0.1:45996/table-grid');
    const before = await page.locator('body').innerHTML(),
      count = requests;
    const report = await inspectDataWidgets(page);
    expect(await page.locator('body').innerHTML()).toBe(before);
    expect(requests).toBe(count);
    const model = report.observations.tables[0].spanOccupancy.gridCoverage;
    const findings = report.findings.filter(item =>
      ['table-grid-gap', 'table-grid-anchors'].includes(item.rule),
    );
    expect(model).toMatchObject({ headerAssociationsVerified: false, renderedGapsVerified: false });
    if (example.reason) {
      expect(model).toMatchObject({
        status: 'unverified',
        reason: example.reason,
        uncoveredSlots: null,
        rowsWithoutAnchors: null,
        columnsWithoutAnchors: null,
      });
      expect(findings).toEqual([]);
    } else {
      expect(model).toMatchObject({
        status: 'observed',
        uncoveredSlots: example.gaps,
        rowsWithoutAnchors: example.rows,
        columnsWithoutAnchors: example.columns,
      });
      expect(findings.map(item => item.rule).sort()).toEqual(
        [
          ...(example.gaps ? ['table-grid-gap'] : []),
          ...(example.rows || example.columns ? ['table-grid-anchors'] : []),
        ].sort(),
      );
      expect(
        findings.every(item => item.guide === 'responsive-table' && item.severity === 'warning'),
      ).toBe(true);
      expect(JSON.stringify(findings)).not.toMatch(/Total|comparison|"A"|"B"/);
    }
    if (
      example.name === 'later-column-anchor' &&
      ['Desktop Chrome', 'Mobile Chrome'].includes(info.project.name)
    )
      await page.screenshot({ path: info.outputPath('valid-grid.png'), fullPage: true });
  });
