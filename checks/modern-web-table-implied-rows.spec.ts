// Sources: https://html.spec.whatwg.org/multipage/tables.html#forming-a-table
// Positive rowspan can create implied group rows. Ending the group extends zero
// spans through those rows; it never lets them consume the following group.
// https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-atoms/responsive-table.md
// Structural coverage/anchors remain distinct from CSS row boxes and AT speech.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { inspectDataWidgets } from '../tests/modern-web-data-widgets';
const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
const overlap =
  '<tr><th>A</th><th rowspan="3">B</th></tr><tr><td colspan="2" rowspan="2">C</td></tr>';
const cases = [
  {
    name: 'positive-tail',
    body: '<tr><th rowspan="3">A</th></tr>',
    modeled: 3,
    declared: 1,
    implied: 2,
    gaps: 0,
    anchors: 2,
  },
  {
    name: 'tail-gap',
    body: '<tr><th rowspan="3">A</th><th>B</th></tr><tr><td>C</td></tr>',
    modeled: 3,
    declared: 2,
    implied: 1,
    gaps: 1,
    anchors: 1,
  },
  {
    name: 'fully-covered-tail',
    body: '<tr><th rowspan="3">A</th><th rowspan="3">B</th></tr>',
    modeled: 3,
    declared: 1,
    implied: 2,
    gaps: 0,
    anchors: 2,
  },
  {
    name: 'zero-alone',
    body: '<tr><th rowspan="0">A</th></tr>',
    modeled: 1,
    declared: 1,
    implied: 0,
    gaps: 0,
    anchors: 0,
  },
  {
    name: 'zero-extends-tail',
    body: '<tr><th rowspan="0">A</th><th rowspan="3">B</th></tr>',
    modeled: 3,
    declared: 1,
    implied: 2,
    gaps: 0,
    anchors: 2,
    assignments: 6,
  },
  {
    name: 'zero-later-positive',
    body: '<tr><th rowspan="0">A</th><th>B</th></tr><tr><td rowspan="3">C</td></tr>',
    modeled: 4,
    declared: 2,
    implied: 2,
    gaps: 0,
    anchors: 2,
    assignments: 8,
  },
  {
    name: 'zero-after-positive',
    body: '<tr><th rowspan="3">A</th><th>B</th></tr><tr><td rowspan="0">C</td></tr>',
    modeled: 3,
    declared: 2,
    implied: 1,
    gaps: 0,
    anchors: 1,
    assignments: 6,
  },
  {
    name: 'zero-tail-gap',
    body: '<tr><th rowspan="0">A</th><th rowspan="3">B</th><th>C</th></tr>',
    modeled: 3,
    declared: 1,
    implied: 2,
    gaps: 2,
    anchors: 2,
    assignments: 7,
  },
  {
    name: 'empty-real-and-implied',
    body: '<tr><th rowspan="4">A</th><th>B</th></tr><tr class="h-8"></tr>',
    modeled: 4,
    declared: 2,
    implied: 2,
    gaps: 3,
    anchors: 3,
  },
  {
    name: 'group-reset',
    body: '<tbody><tr><th rowspan="0">A</th><th rowspan="3">B</th></tr></tbody><tbody><tr><td>C</td><td>D</td></tr></tbody>',
    modeled: 4,
    declared: 2,
    implied: 2,
    gaps: 0,
    anchors: 2,
    assignments: 8,
  },
  {
    name: 'deferred-footer',
    body: '<tfoot><tr><th rowspan="3">Footer</th></tr></tfoot><tbody><tr><td rowspan="2">Body</td></tr></tbody>',
    modeled: 5,
    declared: 2,
    implied: 3,
    gaps: 0,
    anchors: 3,
  },
  {
    name: 'declared-columns',
    body: '<colgroup span="2"></colgroup><tr><th rowspan="3">A</th></tr>',
    modeled: 3,
    declared: 1,
    implied: 2,
    gaps: 3,
    anchors: 2,
    columnAnchors: 1,
  },
  {
    name: 'overlap-implied',
    body: overlap,
    modeled: 3,
    declared: 2,
    implied: 1,
    overlaps: 1,
    overlapSlots: 2,
    assignments: 8,
  },
  {
    name: 'row-boundary',
    body: '<tr><th rowspan="100">A</th></tr>',
    modeled: 100,
    declared: 1,
    implied: 99,
    gaps: 0,
    anchors: 99,
  },
  { name: 'row-limit', body: '<tr><th rowspan="101">A</th></tr>', reason: 'model-row-limit' },
  {
    name: 'clamped-row-limit',
    body: '<tr><th rowspan="999999">A</th></tr>',
    reason: 'model-row-limit',
  },
  {
    name: 'cumulative-boundary',
    body: '<tbody><tr><th rowspan="60">A</th></tr></tbody><tbody><tr><td rowspan="40">B</td></tr></tbody>',
    modeled: 100,
    declared: 2,
    implied: 98,
    gaps: 0,
    anchors: 98,
  },
  {
    name: 'cumulative-limit',
    body: '<tbody><tr><th rowspan="60">A</th></tr></tbody><tbody><tr><td rowspan="41">B</td></tr></tbody>',
    reason: 'model-row-limit',
  },
  {
    name: 'zero-slot-boundary',
    body: '<tr><th rowspan="0" colspan="63">A</th><th rowspan="64">B</th></tr>',
    modeled: 64,
    declared: 1,
    implied: 63,
    gaps: 0,
    anchors: 63,
    columnAnchors: 62,
    assignments: 4096,
  },
  {
    name: 'zero-slot-limit',
    body: '<tr><th rowspan="0" colspan="63">A</th><th rowspan="65">B</th></tr>',
    reason: 'slot-limit',
  },
  {
    name: 'discard-after-limit',
    body: '<tbody>' + overlap + '</tbody><tbody><tr><td rowspan="101">Later</td></tr></tbody>',
    reason: 'model-row-limit',
  },
  {
    name: 'hidden-real-row',
    body: '<tr><th rowspan="3">A</th></tr><tr hidden><td>B</td></tr>',
    reason: 'non-native-or-hidden-row',
  },
  { name: 'stacked', body: '<tr><th rowspan="3">A</th></tr>', reason: 'non-native-table-layout' },
  {
    name: 'nested-isolation',
    body: '<tr><th>A</th><td><table><tr><th rowspan="3">Inner</th></tr></table></td></tr>',
    modeled: 1,
    declared: 1,
    implied: 0,
    gaps: 0,
    anchors: 0,
  },
];
for (const example of cases)
  test(`implied table rows: ${example.name}`, async ({ page }, info) => {
    let requests = 0;
    await page.route('**/*', route => {
      requests++;
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Implied rows</title><style>${css}</style><body class="bg-white text-slate-900"><main class="space-y-4 p-4"><h1 class="text-2xl">Implied rows</h1><div class="overflow-x-auto"><table class="w-full border-separate border-spacing-2 [&_td]:p-2 [&_th]:p-2 ${example.name === 'stacked' ? 'block' : ''}"><caption>Comparison</caption>${example.body}</table></div></main></body></html>`,
      });
    });
    await page.goto('http://127.0.0.1:45996/implied-rows');
    const before = await page.locator('body').innerHTML(),
      count = requests;
    const report = await inspectDataWidgets(page);
    expect(await page.locator('body').innerHTML()).toBe(before);
    expect(requests).toBe(count);
    const model = report.observations.tables[0].spanOccupancy;
    const findings = report.findings.filter(
      item =>
        ['table-grid-gap', 'table-grid-anchors', 'table-span-overlap'].includes(item.rule) &&
        !item.selector.includes('td:nth-of-type(1) > table'),
    );
    if (example.reason) {
      expect(model).toMatchObject({
        status: 'unverified',
        reason: example.reason,
        modeledRows: null,
        impliedRows: null,
        modelRowLimit: 100,
        overlapPlacements: null,
        gridCoverage: {
          status: 'unverified',
          modeledRows: null,
          impliedRows: null,
          rowsWithoutAnchors: null,
          uncoveredSlots: null,
        },
      });
      expect(findings).toEqual([]);
    } else {
      expect(model).toMatchObject({
        status: 'observed',
        checkedRows: example.declared,
        modeledRows: example.modeled,
        impliedRows: example.implied,
        modelRowLimit: 100,
        overlapPlacements: example.overlaps ?? 0,
        automaticHeaderAssociationsVerified: false,
        renderedOverlapVerified: false,
      });
      if (example.assignments) expect(model.slotAssignments).toBe(example.assignments);
      if (example.overlaps) {
        expect(model.gridCoverage).toMatchObject({
          status: 'unverified',
          reason: 'overlapping-model',
          uncoveredSlots: null,
        });
        expect(findings).toEqual([
          expect.objectContaining({
            rule: 'table-span-overlap',
            evidence: expect.objectContaining({ overlappingSlotCount: example.overlapSlots }),
          }),
        ]);
      } else {
        expect(model.gridCoverage).toMatchObject({
          status: 'observed',
          checkedRows: example.modeled,
          declaredRows: example.declared,
          modeledRows: example.modeled,
          impliedRows: example.implied,
          uncoveredSlots: example.gaps,
          rowsWithoutAnchors: example.anchors,
          columnsWithoutAnchors: example.columnAnchors ?? 0,
          renderedGapsVerified: false,
          headerAssociationsVerified: false,
        });
        expect(findings.map(item => item.rule).sort()).toEqual(
          [
            ...(example.gaps ? ['table-grid-gap'] : []),
            ...(example.anchors || example.columnAnchors ? ['table-grid-anchors'] : []),
          ].sort(),
        );
      }
      expect(findings.every(item => item.severity === 'warning')).toBe(true);
      expect(JSON.stringify(findings)).not.toMatch(/Comparison|Footer|Inner|Later/);
    }
    if (
      example.name === 'zero-alone' &&
      ['Desktop Chrome', 'Mobile Chrome'].includes(info.project.name)
    )
      await page.screenshot({ path: info.outputPath('bounded-rows.png'), fullPage: true });
  });
