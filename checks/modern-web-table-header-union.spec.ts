// Source: https://html.spec.whatwg.org/multipage/tables.html#algorithm-for-assigning-header-cells
// Explicit headers overrides automatic lists. First document ID wins, references
// are direct (not transitive), and final sets remove empty/self/duplicate cells.
// Authoring diagnostics remain separate from this bounded processing model.
// https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-atoms/responsive-table.md
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { inspectDataWidgets } from '../tests/modern-web-data-widgets';
const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
const head =
  '<tr><th id="private-a" scope="col">Private A</th><th id="private-b" scope="col">Private B</th></tr>';
const cases = [
  {
    name: 'scanned-matrix',
    body: head + '<tr><th scope="row">Row</th><td>Value</td></tr>',
    pairs: 3,
    auto: 3,
    data: 1,
    withHeaders: 1,
  },
  {
    name: 'group-union',
    body:
      '<colgroup span="2"></colgroup><tr><th scope="colgroup" colspan="2">Group</th></tr>' +
      head +
      '<tr><td>A</td><td>B</td></tr>',
    pairs: 6,
    auto: 6,
    data: 2,
    withHeaders: 2,
  },
  {
    name: 'rowgroup-and-scan',
    body: '<tr><th scope="col">A</th><th scope="col">B</th></tr><tr><th scope="rowgroup">Group</th><td>Value</td></tr>',
    pairs: 3,
    auto: 3,
    data: 1,
    withHeaders: 1,
  },
  {
    name: 'explicit-union',
    body:
      head +
      '<tr><td headers="private-a private-b">Value</td><td headers="private-b">Value</td></tr>',
    pairs: 3,
    explicit: 3,
    explicitCells: 2,
    data: 2,
    withHeaders: 2,
  },
  {
    name: 'explicit-empty',
    body: head + '<tr><td headers="">A</td><td>B</td></tr>',
    pairs: 1,
    auto: 1,
    explicitCells: 1,
    data: 2,
    withHeaders: 1,
  },
  {
    name: 'missing-does-not-fallback',
    body: head + '<tr><td headers="private-missing">A</td><td>B</td></tr>',
    pairs: 1,
    auto: 1,
    explicitCells: 1,
    data: 2,
    withHeaders: 1,
  },
  {
    name: 'duplicates',
    body:
      head +
      '<tr><td headers="private-a private-a private-b">A</td><td headers="private-b private-b">B</td></tr>',
    pairs: 3,
    explicit: 3,
    explicitCells: 2,
    data: 2,
    withHeaders: 2,
  },
  {
    name: 'self-removed',
    body: '<tr><th id="private-a" headers="private-a">A</th><td headers="private-a">B</td></tr>',
    pairs: 1,
    explicit: 1,
    explicitCells: 2,
    data: 1,
    withHeaders: 1,
  },
  {
    name: 'nontransitive',
    body: '<tr><th id="private-a" headers="private-b">A</th><th id="private-b" headers="private-c">B</th><th id="private-c" headers="">C</th></tr><tr><td headers="private-a">D</td></tr>',
    pairs: 3,
    explicit: 3,
    explicitCells: 4,
    data: 1,
    withHeaders: 1,
  },
  {
    name: 'empty-target',
    body: '<tr><th id="private-a" scope="col"> \t </th></tr><tr><td headers="private-a">Value</td></tr>',
    pairs: 0,
    explicitCells: 1,
    data: 1,
  },
  {
    name: 'element-target',
    body: '<tr><th id="private-a" scope="col"><span hidden></span></th></tr><tr><td headers="private-a">Value</td></tr>',
    pairs: 1,
    explicit: 1,
    explicitCells: 1,
    data: 1,
    withHeaders: 1,
  },
  {
    name: 'nbsp-token',
    body: '<tr><th id="private-a&#160;private-b" scope="col">A</th></tr><tr><td headers="private-a&#160;private-b">Value</td></tr>',
    pairs: 1,
    explicit: 1,
    explicitCells: 1,
    data: 1,
    withHeaders: 1,
  },
  {
    name: 'ascii-tokens',
    body:
      head +
      '<tr><td headers="private-a&#9;private-b&#10;private-a">A</td><td headers="">B</td></tr>',
    pairs: 2,
    explicit: 2,
    explicitCells: 2,
    data: 2,
    withHeaders: 1,
  },
  {
    name: 'first-id-noncell',
    before: '<p id="private-a">Outside</p>',
    body: '<tr><th id="private-a" scope="col">A</th></tr><tr><td headers="private-a">Value</td></tr>',
    pairs: 0,
    explicitCells: 1,
    data: 1,
  },
  {
    name: 'first-id-cell',
    body: '<tr><th id="private-a" scope="col">A</th><th id="private-a" scope="col">B</th></tr><tr><td headers="private-a">Value</td><td headers="">Value</td></tr>',
    pairs: 1,
    explicit: 1,
    explicitCells: 2,
    data: 2,
    withHeaders: 1,
  },
  {
    name: 'different-table',
    before: '<table><tr><th id="private-other">Other</th></tr></table>',
    body: '<tr><th>A</th></tr><tr><td headers="private-other">Value</td></tr>',
    pairs: 0,
    explicitCells: 1,
    data: 1,
  },
  {
    name: 'td-target',
    body: '<tr><td id="private-a">A</td><td headers="private-a">B</td></tr>',
    pairs: 1,
    explicit: 1,
    explicitCells: 1,
    data: 2,
    withHeaders: 1,
    dataTargets: 1,
  },
  {
    name: 'punctuation',
    body: '<tr><th id="private:a.b" scope="col">A</th></tr><tr><td headers="private:a.b">Value</td></tr>',
    pairs: 1,
    explicit: 1,
    explicitCells: 1,
    data: 1,
    withHeaders: 1,
  },
  {
    name: 'token-boundary',
    body:
      '<tr><th id="private-a" scope="col">A</th></tr><tr><td headers="' +
      Array(64).fill('private-a').join(' ') +
      '">Value</td></tr>',
    pairs: 1,
    explicit: 1,
    explicitCells: 1,
    data: 1,
    withHeaders: 1,
  },
  {
    name: 'token-limit',
    body:
      '<tr><th id="private-a" scope="col">A</th></tr><tr><td headers="' +
      Array(65).fill('private-a').join(' ') +
      '">Value</td></tr>',
    reason: 'headers-token-limit',
  },
  {
    name: 'attribute-boundary',
    body: '<tr><th>A</th></tr><tr><td headers="' + ' '.repeat(8192) + '">Value</td></tr>',
    pairs: 0,
    explicitCells: 1,
    data: 1,
  },
  {
    name: 'attribute-limit',
    body: '<tr><th>A</th></tr><tr><td headers="' + ' '.repeat(8193) + '">Value</td></tr>',
    reason: 'headers-attribute-limit',
  },
  {
    name: 'td-content-limit',
    body: '<tr><td id="private-a">' + 'A'.repeat(8193) + '</td><td headers="private-a">B</td></tr>',
    reason: 'target-content-limit',
  },
  {
    name: 'overlap-unknown',
    body: '<tr><th>A</th><th rowspan="2">B</th></tr><tr><td colspan="2">C</td></tr>',
    reason: 'overlapping-model',
  },
];
for (const example of cases)
  test(`table header union: ${example.name}`, async ({ page }, info) => {
    let requests = 0;
    await page.route('**/*', route => {
      requests++;
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Header assignments</title><style>${css}</style><body class="bg-white text-slate-900"><main class="space-y-4 p-4"><h1 class="text-2xl">Header assignments</h1>${example.before ?? ''}<div class="overflow-x-auto"><table class="w-full border-separate border-spacing-2 [&_td]:p-2 [&_th]:p-2"><caption>Private comparison</caption>${example.body}</table></div></main></body></html>`,
      });
    });
    await page.goto('http://127.0.0.1:45996/header-union');
    const before = await page.locator('body').innerHTML(),
      count = requests;
    const report = await inspectDataWidgets(page);
    expect(await page.locator('body').innerHTML()).toBe(before);
    expect(requests).toBe(count);
    const index = example.name === 'different-table' ? 1 : 0;
    const result = report.observations.tables[index].spanOccupancy.headerAssignments;
    expect(result).toMatchObject({
      tokenLimit: 64,
      attributeLimit: 8192,
      accessibilityTreeVerified: false,
      speechVerified: false,
    });
    if (example.reason)
      expect(result).toMatchObject({
        status: 'unverified',
        reason: example.reason,
        assignedPairs: null,
        automaticPairs: null,
        explicitPairs: null,
        cells: null,
        structuralAssignmentSubsetVerified: false,
      });
    else {
      expect(result).toMatchObject({
        status: 'observed',
        assignedPairs: example.pairs,
        automaticPairs: example.auto ?? 0,
        explicitPairs: example.explicit ?? 0,
        explicitCells: example.explicitCells ?? 0,
        dataCells: example.data ?? 0,
        dataCellsWithHeaders: example.withHeaders ?? 0,
        dataCellsWithoutHeaders: (example.data ?? 0) - (example.withHeaders ?? 0),
        explicitDataTargets: example.dataTargets ?? 0,
        structuralAssignmentSubsetVerified: true,
      });
      expect(JSON.stringify(result)).not.toMatch(
        /private-a|private-b|Private comparison|Private A/,
      );
    }
    if (
      example.name === 'group-union' &&
      ['Desktop Chrome', 'Mobile Chrome'].includes(info.project.name)
    )
      await page.screenshot({ path: info.outputPath('header-union.png'), fullPage: true });
  });
