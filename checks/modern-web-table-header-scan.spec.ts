// Source: https://html.spec.whatwg.org/multipage/tables.html#algorithm-for-assigning-header-cells
// West/north scanning includes opaque blocks, Auto orientation, missing slots,
// per-covered-slot scans, empty/self removal and deduplication. Counts omit group
// and explicit lists; no AX or screen-reader assertion follows from DOM scanning.
// https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-atoms/responsive-table.md
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { inspectDataWidgets } from '../tests/modern-web-data-widgets';
const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
const matrix =
  '<tr><th scope="col">Item</th><th scope="col">Value</th></tr><tr><th scope="row">Sample</th><td>Data</td></tr>';
const cases = [
  {
    name: 'explicit-matrix',
    body: matrix,
    row: 1,
    col: 2,
    rowPairs: 1,
    colPairs: 2,
    data: 1,
    withHeaders: 1,
  },
  {
    name: 'auto-matrix',
    body: matrix.replaceAll(' scope="col"', '').replace(' scope="row"', ''),
    row: 1,
    col: 2,
    autoRow: 1,
    autoCol: 2,
    rowPairs: 1,
    colPairs: 2,
    data: 1,
    withHeaders: 1,
  },
  {
    name: 'ambiguous-auto',
    body: '<tr><td>A</td><th>B</th></tr><tr><th>C</th><td>D</td></tr>',
    data: 2,
  },
  { name: 'wrong-direction', body: '<tr><th scope="col">A</th><td>B</td></tr>', col: 1, data: 1 },
  {
    name: 'missing-slot',
    body: '<tr><th scope="col">A</th></tr><tr><td>B</td><td>C</td></tr>',
    col: 1,
    colPairs: 1,
    data: 2,
    withHeaders: 1,
  },
  {
    name: 'opaque-row-block',
    body: '<tr><th scope="row">A</th><td>B</td><th scope="row">C</th><td>D</td></tr>',
    row: 2,
    rowPairs: 2,
    data: 2,
    withHeaders: 2,
    focus: { row: 0, column: 3, headers: 1 },
  },
  {
    name: 'opaque-column-block',
    body: '<tr><th scope="col">A</th></tr><tr><td>B</td></tr><tr><th scope="col">C</th></tr><tr><td>D</td></tr>',
    col: 2,
    colPairs: 2,
    data: 2,
    withHeaders: 2,
    focus: { row: 3, column: 0, headers: 1 },
  },
  {
    name: 'different-width-block',
    body: '<tr><th scope="col" colspan="2">A</th></tr><tr><td>B</td><td>C</td></tr><tr><th scope="col">D</th><th scope="col">E</th></tr><tr><td>F</td><td>G</td></tr>',
    col: 3,
    colPairs: 8,
    data: 4,
    withHeaders: 4,
    focus: { row: 3, column: 0, headers: 2 },
  },
  {
    name: 'empty-still-opaque',
    body: '<tr><th scope="col">A</th></tr><tr><td>B</td></tr><tr><th scope="col"> </th></tr><tr><td>D</td></tr>',
    col: 2,
    colPairs: 1,
    data: 2,
    withHeaders: 1,
    focus: { row: 3, column: 0, headers: 0 },
  },
  {
    name: 'group-subset-separate',
    body: '<colgroup span="2"></colgroup><tr><th scope="colgroup" colspan="2">Group</th></tr><tr><td>A</td><td>B</td></tr>',
    data: 2,
  },
  {
    name: 'explicit-precedence',
    body: '<tr><th scope="col">A</th><th scope="col">B</th></tr><tr><td headers="">C</td><td headers="missing">D</td></tr>',
    col: 2,
    explicit: 2,
  },
  {
    name: 'header-own-explicit',
    body: '<tr><th scope="col" headers="">A</th></tr><tr><td>B</td></tr>',
    col: 1,
    colPairs: 1,
    explicit: 1,
    data: 1,
    withHeaders: 1,
  },
  {
    name: 'header-principal',
    body: '<tr><th scope="row">A</th><th scope="row">B</th></tr>',
    row: 2,
    rowPairs: 1,
  },
  {
    name: 'colspan-deduplication',
    body: '<tr><th scope="col" colspan="2">A</th></tr><tr><td colspan="2">B</td></tr>',
    col: 1,
    colPairs: 1,
    data: 1,
    withHeaders: 1,
  },
  {
    name: 'rowspan-deduplication',
    body: '<tr><th scope="row" rowspan="2">A</th><td rowspan="2">B</td></tr>',
    row: 1,
    rowPairs: 1,
    data: 1,
    withHeaders: 1,
  },
  {
    name: 'invalid-is-auto',
    body: '<tr><th scope="private-invalid-axis">A</th><th>B</th></tr><tr><td>C</td><td>D</td></tr>',
    col: 2,
    autoCol: 2,
    colPairs: 2,
    data: 2,
    withHeaders: 2,
  },
  {
    name: 'auto-column-precedence',
    body: '<tr><th>A</th><th>B</th></tr><tr><th>C</th><th>D</th></tr>',
    col: 4,
    autoCol: 4,
    colPairs: 2,
  },
  {
    name: 'auto-entire-height',
    body: '<tr><th rowspan="2">A</th><th>B</th></tr><tr><td>C</td></tr><tr><td>D</td><td>E</td></tr>',
    col: 1,
    autoCol: 1,
    colPairs: 2,
    data: 3,
    withHeaders: 2,
  },
  {
    name: 'deferred-footer',
    body: '<tfoot><tr><th scope="col">Footer</th></tr></tfoot><tbody><tr><td>Body</td></tr></tbody>',
    col: 1,
    data: 1,
  },
  {
    name: 'body-before-footer',
    body: '<tfoot><tr><td>Footer</td></tr></tfoot><tbody><tr><th scope="col">Body</th></tr></tbody>',
    col: 1,
    colPairs: 1,
    data: 1,
    withHeaders: 1,
  },
  {
    name: 'rtl-matrix',
    body: matrix,
    row: 1,
    col: 2,
    rowPairs: 1,
    colPairs: 2,
    data: 1,
    withHeaders: 1,
  },
  {
    name: 'text-boundary',
    body: '<tr><th scope="col">' + 'A'.repeat(8192) + '</th></tr><tr><td>B</td></tr>',
    col: 1,
    colPairs: 1,
    data: 1,
    withHeaders: 1,
  },
  {
    name: 'text-limit',
    body: '<tr><th scope="col">' + 'A'.repeat(8193) + '</th></tr><tr><td>B</td></tr>',
    reason: 'header-content-limit',
  },
  {
    name: 'ascii-empty',
    body: '<tr><th scope="col"> \t\n </th></tr><tr><td>B</td></tr>',
    col: 1,
    data: 1,
  },
  {
    name: 'nbsp-nonempty',
    body: '<tr><th scope="col">&nbsp;</th></tr><tr><td>B</td></tr>',
    col: 1,
    colPairs: 1,
    data: 1,
    withHeaders: 1,
  },
  {
    name: 'overlap-unknown',
    body: '<tr><th>A</th><th rowspan="2">B</th></tr><tr><td colspan="2">C</td></tr>',
    reason: 'overlapping-model',
  },
  { name: 'late-columns-unknown', body: matrix, reason: 'late-column-group' },
  {
    name: 'work-limit',
    body:
      '<tr><th scope="col" colspan="21">A</th><th scope="col" colspan="21">B</th><th scope="col" colspan="22">C</th></tr>' +
      '<tr><td colspan="21">D</td><td colspan="21">E</td><td colspan="22">F</td></tr>'.repeat(63),
    reason: 'header-scan-work-limit',
  },
];
for (const example of cases)
  test(`table header scan: ${example.name}`, async ({ page }, info) => {
    let requests = 0;
    await page.route('**/*', route => {
      requests++;
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Header scan</title><style>${css}</style><body class="bg-white text-slate-900"><main class="space-y-4 p-4"><h1 class="text-2xl">Header scan</h1><div class="overflow-x-auto"><table ${example.name === 'rtl-matrix' ? 'dir="rtl"' : ''} class="w-full border-separate border-spacing-2 [&_td]:p-2 [&_th]:p-2"><caption>Private comparison</caption>${example.body}</table></div></main></body></html>`,
      });
    });
    await page.goto('http://127.0.0.1:45996/header-scan');
    if (example.name === 'late-columns-unknown')
      await page
        .locator('table')
        .evaluate(table => table.appendChild(document.createElement('colgroup')));
    const before = await page.locator('body').innerHTML(),
      count = requests;
    const report = await inspectDataWidgets(page);
    expect(await page.locator('body').innerHTML()).toBe(before);
    expect(requests).toBe(count);
    const scan = report.observations.tables[0].spanOccupancy.headerScan;
    expect(scan).toMatchObject({
      workLimit: 100000,
      headerTextLimit: 8192,
      completeHeaderAssociationsVerified: false,
      speechVerified: false,
    });
    if (example.reason) {
      expect(scan).toMatchObject({
        status: 'unverified',
        reason: example.reason,
        scannedPairs: null,
        rowScanPairs: null,
        columnScanPairs: null,
        workUnits: null,
        slotVisits: null,
        cells: null,
      });
    } else {
      expect(scan).toMatchObject({
        status: 'observed',
        rowHeaderCells: example.row ?? 0,
        columnHeaderCells: example.col ?? 0,
        autoRowHeaders: example.autoRow ?? 0,
        autoColumnHeaders: example.autoCol ?? 0,
        rowScanPairs: example.rowPairs ?? 0,
        columnScanPairs: example.colPairs ?? 0,
        scannedPairs: (example.rowPairs ?? 0) + (example.colPairs ?? 0),
        explicitHeadersCells: example.explicit ?? 0,
        automaticDataCells: example.data ?? 0,
        dataCellsWithScannedHeaders: example.withHeaders ?? 0,
        dataCellsWithoutScannedHeaders: (example.data ?? 0) - (example.withHeaders ?? 0),
      });
      expect(scan.workUnits).toBeLessThanOrEqual(100000);
      if (example.focus)
        expect(
          scan.cells?.find(
            cell => cell.row === example.focus.row && cell.column === example.focus.column,
          ),
        ).toMatchObject(example.focus);
      expect(JSON.stringify(scan)).not.toMatch(
        /Private comparison|Sample|Footer|private-invalid-axis/,
      );
    }
    if (
      example.name === 'explicit-matrix' &&
      ['Desktop Chrome', 'Mobile Chrome'].includes(info.project.name)
    )
      await page.screenshot({ path: info.outputPath('header-scan.png'), fullPage: true });
  });
