// Sources: https://html.spec.whatwg.org/multipage/tables.html#algorithm-for-processing-rows
// https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-atoms/responsive-table.md
// DOM occupancy is not rendered rectangle overlap, inferred headers or AT speech.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { inspectDataWidgets } from '../tests/modern-web-data-widgets';
const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
const overlap =
  '<tr><th id="private-header">First</th><th rowspan="2">Second</th></tr><tr><td id="private-cell" colspan="2">Private data</td></tr>';
const cases = [
  {
    name: 'ordinary',
    body: '<tr><th>A</th><th>B</th></tr><tr><td>A</td><td>B</td></tr>',
    overlaps: 0,
  },
  {
    name: 'valid-spans',
    body: '<tr><th rowspan="2">A</th><th colspan="2">B</th></tr><tr><td>C</td><td>D</td></tr>',
    overlaps: 0,
  },
  { name: 'overlap', body: overlap, overlaps: 1 },
  {
    name: 'two-occupied-slots',
    body: '<tr><th>A</th><th rowspan="2">B</th><th rowspan="2">C</th></tr><tr><td colspan="3">D</td></tr>',
    overlaps: 1,
    slots: 2,
  },
  {
    name: 'rowspan-zero',
    body: '<tbody><tr><th rowspan="0">A</th><th>B</th></tr><tr><td>C</td></tr></tbody><tbody><tr><th>D</th><td>E</td></tr></tbody>',
    overlaps: 0,
  },
  {
    name: 'rowspan-zero-overlap',
    body: '<tr><th>A</th><th rowspan="0">B</th></tr><tr><td colspan="2">C</td></tr>',
    overlaps: 1,
  },
  {
    name: 'group-isolation',
    body: '<thead><tr><th rowspan="2">A</th><th>B</th></tr><tr><th>C</th></tr></thead><tbody><tr><td colspan="2">D</td></tr></tbody><tfoot><tr><td colspan="2">E</td></tr></tfoot>',
    overlaps: 0,
  },
  {
    name: 'implicit-rows',
    body: '<tr><th rowspan="3">A</th><th>B</th></tr><tr><td>C</td></tr>',
    overlaps: 0,
  },
  {
    name: 'discard-partial',
    body:
      '<tbody>' +
      overlap +
      '</tbody><tbody><tr><td rowspan="101">Later unbounded implied row</td></tr></tbody>',
    reason: 'model-row-limit',
  },
  { name: 'column-boundary', body: '<tr><th colspan="128">A</th></tr>', overlaps: 0 },
  { name: 'column-limit', body: '<tr><th colspan="129">A</th></tr>', reason: 'column-limit' },
  {
    name: 'row-boundary',
    body: '<tr><th>A</th></tr>' + '<tr><td>B</td></tr>'.repeat(99),
    overlaps: 0,
  },
  {
    name: 'row-limit',
    body: '<tr><th>A</th></tr>' + '<tr><td>B</td></tr>'.repeat(100),
    reason: 'cell-or-row-limit',
  },
  {
    name: 'slot-boundary',
    body: '<tr><th colspan="64">A</th></tr>' + '<tr><td colspan="64">B</td></tr>'.repeat(63),
    overlaps: 0,
    assignments: 4096,
  },
  {
    name: 'slot-limit',
    body: '<tr><th colspan="64">A</th></tr>' + '<tr><td colspan="64">B</td></tr>'.repeat(64),
    reason: 'slot-limit',
  },
  {
    name: 'cell-boundary',
    body: '<tr><th>A</th><th>B</th></tr>' + '<tr><td>C</td><td>D</td></tr>'.repeat(99),
    overlaps: 0,
  },
  {
    name: 'cell-limit',
    body:
      '<tr><th>A</th><th>B</th><th>C</th></tr>' +
      '<tr><td>D</td><td>E</td><td>F</td></tr>'.repeat(66),
    reason: 'cell-or-row-limit',
  },
  {
    name: 'hidden-cell',
    body: '<tr><th>A</th><th rowspan="2" hidden>B</th></tr><tr><td colspan="2">C</td></tr>',
    reason: 'non-native-or-hidden-cell',
  },
  {
    name: 'hidden-row',
    body: '<tr hidden><th>A</th></tr><tr><td>B</td></tr>',
    reason: 'non-native-or-hidden-row',
  },
  { name: 'stacked-table', body: overlap, reason: 'non-native-table-layout', tableClass: 'block' },
  { name: 'grid', body: overlap, reason: 'non-native-table-layout', role: 'grid' },
  {
    name: 'normalized-defaults',
    body: '<tr><th colspan="0" rowspan="invalid">A</th><th>B</th></tr><tr><td>C</td><td>D</td></tr>',
    overlaps: 0,
  },
  { name: 'quirks', body: overlap, reason: 'non-standards-document' },
];
for (const example of cases)
  test(`table span occupancy: ${example.name}`, async ({ page }, info) => {
    let requests = 0;
    await page.route('**/*', route => {
      requests++;
      return route.fulfill({
        contentType: 'text/html',
        body: `${example.name === 'quirks' ? '' : '<!doctype html>'}<html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Table span fixture</title><style>${css}</style><body class="bg-white text-slate-900"><main class="mx-auto max-w-3xl space-y-4 p-4"><h1 class="text-2xl font-bold">Table cell coverage</h1><div class="overflow-x-auto"><table class="w-full border-separate border-spacing-2 ${example.tableClass ?? ''}" ${example.role ? 'role="grid"' : ''}><caption>Local comparison</caption>${example.body}</table></div></main></body></html>`,
      });
    });
    await page.goto('http://127.0.0.1:45996/table-spans');
    const before = await page.locator('body').innerHTML(),
      count = requests;
    const report = await inspectDataWidgets(page);
    expect(requests).toBe(count);
    expect(await page.locator('body').innerHTML()).toBe(before);
    const model = report.observations.tables[0].spanOccupancy;
    const findings = report.findings.filter(f => f.rule === 'table-span-overlap');
    if (example.reason) {
      expect(model).toMatchObject({
        status: 'unverified',
        reason: example.reason,
        overlapPlacements: null,
        slotAssignments: null,
      });
      expect(findings).toEqual([]);
    } else {
      expect(model).toMatchObject({ status: 'observed', overlapPlacements: example.overlaps });
      expect(findings).toHaveLength(example.overlaps!);
      if (example.slots) expect(findings[0].evidence.overlappingSlotCount).toBe(example.slots);
      if (example.assignments)
        expect(model).toMatchObject({ slotAssignments: example.assignments });
    }
    expect(model).toMatchObject({
      automaticHeaderAssociationsVerified: false,
      otherTableModelErrorsVerified: false,
      renderedOverlapVerified: false,
    });
    expect(findings.every(f => f.severity === 'warning')).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/private-header|private-cell|Private data/);
    if (example.name === 'valid-spans')
      await page.screenshot({ path: info.outputPath('table-spans.png'), fullPage: true });
  });

test('table span model isolates nested tables and excludes direct programmatic rows', async ({
  page,
}) => {
  await page.setContent(
    '<!doctype html><table><tr><th>Outer</th><td><table>' + overlap + '</table></td></tr></table>',
  );
  const nested = await inspectDataWidgets(page);
  expect(nested.observations.tables.map(t => t.spanOccupancy)).toEqual([
    expect.objectContaining({ status: 'observed', overlapPlacements: 0 }),
    expect.objectContaining({ status: 'observed', overlapPlacements: 1 }),
  ]);
  expect(nested.findings.filter(f => f.rule === 'table-span-overlap')).toHaveLength(1);
  await page.setContent('<!doctype html><table></table>');
  await page.locator('table').evaluate(el => {
    const row = document.createElement('tr');
    row.innerHTML = '<th>Programmatic</th>';
    el.append(row);
  });
  const direct = await inspectDataWidgets(page);
  expect(direct.observations.tables[0].spanOccupancy).toMatchObject({
    status: 'unverified',
    reason: 'unsupported-row-group-structure',
  });
});
