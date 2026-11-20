// Sources: https://html.spec.whatwg.org/multipage/tables.html#attr-th-scope
// https://html.spec.whatwg.org/multipage/tables.html#algorithm-for-assigning-header-cells
// https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-atoms/responsive-table.md
// Confirm group anchoring and candidate counts only. Explicit headers overrides
// automatic selection even when empty; HTML empty-cell syntax is not an AX name.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { inspectDataWidgets } from '../tests/modern-web-data-widgets';
const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
const group = '<colgroup span="2"></colgroup>';
const head = '<tr><th id="private-header" colspan="2" scope="colgroup">Private group</th></tr>';
const data = '<tr><td>A</td><td>B</td></tr>';
const cases = [
  { name: 'ordinary', body: '<tr><th>A</th><th>B</th></tr>' + data },
  { name: 'valid-colgroup', body: group + head + data, col: 1, colPairs: 2 },
  { name: 'missing-colgroup', body: head + data, col: 1, invalid: 1 },
  {
    name: 'outside-declared-group',
    body: '<colgroup></colgroup><tr><th>A</th><th scope="colgroup">Group</th></tr>' + data,
    col: 1,
    invalid: 1,
  },
  {
    name: 'header-crosses-groups',
    body: '<colgroup></colgroup><colgroup></colgroup>' + head + data,
    col: 1,
    colPairs: 1,
  },
  {
    name: 'principal-crosses-groups',
    body: '<colgroup></colgroup><colgroup></colgroup><tr><th scope="colgroup">A</th><th scope="colgroup">B</th></tr><tr><td colspan="2">Value</td></tr>',
    col: 2,
    colPairs: 1,
  },
  {
    name: 'rowgroup',
    body: '<tbody><tr><th scope="rowgroup">Group</th><td>A</td></tr>' + data + '</tbody>',
    row: 1,
    rowPairs: 3,
  },
  {
    name: 'rowgroup-isolation',
    body: '<tbody><tr><th scope="rowgroup">A</th><td>B</td></tr></tbody><tbody><tr><th scope="rowgroup">C</th><td>D</td></tr></tbody>',
    row: 2,
    rowPairs: 2,
  },
  {
    name: 'later-row-header',
    body: data + '<tr><th scope="rowgroup">Group</th><td>C</td></tr>',
    row: 1,
    rowPairs: 1,
  },
  {
    name: 'right-row-header',
    body: '<tr><td>A</td><th scope="rowgroup">Group</th></tr>' + data,
    row: 1,
    rowPairs: 1,
  },
  {
    name: 'principal-reaches-later-row',
    body: '<tr><td>A</td><td rowspan="2">B</td></tr><tr><th scope="rowgroup">Group</th><td>C</td></tr>',
    row: 1,
    rowPairs: 2,
  },
  {
    name: 'explicit-empty-and-invalid',
    body: group + head + '<tr><td headers="">A</td><td headers="missing">B</td></tr>',
    col: 1,
    explicit: 2,
  },
  {
    name: 'header-own-headers',
    body: group + head.replace('scope="colgroup"', 'scope="colgroup" headers=""') + data,
    col: 1,
    colPairs: 2,
    explicit: 1,
  },
  {
    name: 'ascii-empty-header',
    body: group + head.replace('Private group', ' \t\n\f\r ') + data,
    col: 1,
    empty: 1,
  },
  {
    name: 'comment-empty-header',
    body: group + head.replace('Private group', '<!-- Private comment -->') + data,
    col: 1,
    empty: 1,
  },
  {
    name: 'nbsp-header',
    body: group + head.replace('Private group', '&nbsp;') + data,
    col: 1,
    colPairs: 2,
  },
  {
    name: 'element-header',
    body: group + head.replace('Private group', '<span hidden></span>') + data,
    col: 1,
    colPairs: 2,
  },
  {
    name: 'uppercase-scope',
    body: group + head.replace('scope="colgroup"', 'scope="COLGROUP"') + data,
    col: 1,
    colPairs: 2,
  },
  {
    name: 'invalid-scope-defaults-auto',
    body: group + head.replace('scope="colgroup"', 'scope=" colgroup "') + data,
  },
  {
    name: 'td-scope-is-not-header',
    body: group + '<tr><td scope="colgroup">A</td><td>B</td></tr>',
  },
  {
    name: 'deferred-footer',
    body: group + '<tfoot>' + head + '</tfoot><tbody>' + data + '</tbody>',
    col: 1,
  },
  {
    name: 'body-header-applies-to-footer',
    body: group + '<tfoot>' + data + '</tfoot><tbody>' + head + '</tbody>',
    col: 1,
    colPairs: 2,
  },
  {
    name: 'zero-implied-group',
    body: '<tr><th scope="rowgroup" rowspan="0">Group</th><td rowspan="3">A</td></tr>',
    row: 1,
    rowPairs: 1,
  },
  {
    name: 'nested-isolation',
    body: group + head + '<tr><td><table>' + head + data + '</table></td><td>A</td></tr>',
    col: 1,
    colPairs: 2,
  },
  {
    name: 'overlap-unknown',
    body: '<tr><th scope="colgroup">A</th><th rowspan="2">B</th></tr><tr><td colspan="2">C</td></tr>',
    reason: 'overlapping-model',
  },
  { name: 'late-column-unknown', body: head + data, reason: 'late-column-group' },
  {
    name: 'content-boundary',
    body: group + head.replace('Private group', 'A'.repeat(8192)) + data,
    col: 1,
    colPairs: 2,
  },
  {
    name: 'content-limit',
    body: head.replace('Private group', 'A'.repeat(8193)) + data,
    reason: 'header-content-limit',
  },
  {
    name: 'pair-boundary',
    body: '<tr><th scope="rowgroup">A</th><th scope="rowgroup">B</th></tr>'.repeat(100),
    row: 200,
    rowPairs: 14950,
  },
  {
    name: 'cell-limit',
    body: '<tr><th scope="rowgroup">A</th><th scope="rowgroup">B</th><th scope="rowgroup">C</th></tr>'.repeat(
      67,
    ),
    reason: 'cell-or-row-limit',
  },
];
for (const example of cases)
  test(`table group scopes: ${example.name}`, async ({ page }, info) => {
    let requests = 0;
    await page.route('**/*', route => {
      requests++;
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Table group scopes</title><style>${css}</style><body class="bg-white text-slate-900"><main class="space-y-4 p-4"><h1 class="text-2xl">Table group scopes</h1><div class="overflow-x-auto"><table class="w-full border-separate border-spacing-2 [&_td]:p-2 [&_th]:p-2"><caption>Comparison</caption>${example.body}</table></div></main></body></html>`,
      });
    });
    await page.goto('http://127.0.0.1:45996/group-scopes');
    if (example.name === 'late-column-unknown')
      await page
        .locator('main > div > table')
        .evaluate(table => table.appendChild(document.createElement('colgroup')));
    const before = await page.locator('body').innerHTML(),
      count = requests;
    const report = await inspectDataWidgets(page);
    expect(await page.locator('body').innerHTML()).toBe(before);
    expect(requests).toBe(count);
    const scopes = report.observations.tables[0].spanOccupancy.groupScopes;
    const findings = report.findings.filter(
      item =>
        item.rule === 'table-header-colgroup-anchor' &&
        !item.selector.includes('td:nth-of-type(1) > table'),
    );
    expect(scopes).toMatchObject({
      pairLimit: 40000,
      headerTextLimit: 8192,
      completeHeaderAssociationsVerified: false,
      speechVerified: false,
    });
    if (example.reason) {
      expect(scopes).toMatchObject({
        status: 'unverified',
        reason: example.reason,
        rowGroupHeaders: null,
        columnGroupHeaders: null,
        unanchoredColumnGroupHeaders: null,
        rowGroupCandidatePairs: null,
        columnGroupCandidatePairs: null,
      });
      expect(findings).toEqual([]);
    } else {
      expect(scopes).toMatchObject({
        status: 'observed',
        rowGroupHeaders: example.row ?? 0,
        columnGroupHeaders: example.col ?? 0,
        unanchoredColumnGroupHeaders: example.invalid ?? 0,
        rowGroupCandidatePairs: example.rowPairs ?? 0,
        columnGroupCandidatePairs: example.colPairs ?? 0,
        explicitHeadersCells: example.explicit ?? 0,
        emptyGroupHeaders: example.empty ?? 0,
      });
      expect(findings).toHaveLength(example.invalid ?? 0);
      expect(
        findings.every(item => item.guide === 'responsive-table' && item.severity === 'warning'),
      ).toBe(true);
      expect(JSON.stringify({ scopes, findings })).not.toMatch(
        /private-header|Private group|Comparison|Private comment/,
      );
    }
    if (
      example.name === 'valid-colgroup' &&
      ['Desktop Chrome', 'Mobile Chrome'].includes(info.project.name)
    )
      await page.screenshot({ path: info.outputPath('valid-group-scopes.png'), fullPage: true });
  });
