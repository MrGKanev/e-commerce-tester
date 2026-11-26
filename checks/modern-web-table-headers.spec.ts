// Sources: https://html.spec.whatwg.org/multipage/tables.html#attr-tdth-headers
// https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-atoms/responsive-table.md
// Validate authored graph/token contracts; neither a cycle-free graph nor spans
// certify the browser's inferred associations or screen-reader announcements.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { inspectDataWidgets } from '../tests/modern-web-data-widgets';
const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
const cases = [
  {
    name: 'reachable-cycle-not-member',
    body: '<tr><th id="private-a" headers="private-b">A</th><th id="private-b" headers="private-c">B</th><th id="private-c" headers="private-b">C</th></tr>',
    cycles: 2,
    duplicates: 0,
  },
  {
    name: 'foreign-nested',
    body: '<tr><th id="private-a" headers="private-b">A</th><td><table><tr><th id="private-b" headers="private-a">B</th></tr></table></td></tr>',
    cycles: 0,
    duplicates: 0,
  },
  {
    name: 'token-limit-boundary',
    body:
      '<tr>' +
      Array.from({ length: 64 }, (_, i) => '<th id="private-' + i + '">Header</th>').join('') +
      '<td headers="' +
      Array.from({ length: 64 }, (_, i) => 'private-' + i).join(' ') +
      '">Data</td></tr>',
    cycles: 0,
    duplicates: 0,
  },
  {
    name: 'self',
    body: '<tr><th id="private-a" headers="private-a">Private header text</th></tr>',
    cycles: 1,
    duplicates: 0,
  },
  {
    name: 'mutual',
    body: '<tr><th id="private-a" headers="private-b">A</th><th id="private-b" headers="private-a">B</th></tr>',
    cycles: 2,
    duplicates: 0,
  },
  {
    name: 'transitive',
    body: '<tr><th id="private-a" headers="private-b">A</th><th id="private-b" headers="private-c">B</th><th id="private-c" headers="private-a">C</th><td headers="private-a">Private data text</td></tr>',
    cycles: 3,
    duplicates: 0,
  },
  {
    // Acyclic references still need a real group for scope=colgroup.
    // https://html.spec.whatwg.org/multipage/tables.html#attr-th-scope
    name: 'acyclic-spans',
    body: '<colgroup span="2"></colgroup><thead><tr><th id="private-group" colspan="2" scope="colgroup">Group</th></tr><tr><th id="private-a" headers="private-group" scope="col">A</th><th id="private-b" headers="private-group" scope="col">B</th></tr></thead><tbody><tr><td headers="private-group private-a">Data</td><td headers="private-group private-b">Data</td></tr></tbody>',
    cycles: 0,
    duplicates: 0,
  },
  {
    name: 'duplicate-tokens',
    body: '<tr><th id="private-a">A</th><td headers="private-a private-a private-a">Data</td></tr>',
    cycles: 0,
    duplicates: 2,
  },
  {
    name: 'ascii-whitespace',
    body: '<tr><th id="private-a">A</th><td headers="\tprivate-a\nprivate-a\fprivate-a\rprivate-a ">Data</td></tr>',
    cycles: 0,
    duplicates: 3,
  },
  {
    name: 'nbsp-is-id',
    body: '<tr><th id="private\u00a0a">A</th><td headers="private\u00a0a">Data</td></tr>',
    cycles: 0,
    duplicates: 0,
  },
  {
    name: 'case-distinct',
    body: '<tr><th id="private-a">A</th><th id="PRIVATE-A">B</th><td headers="private-a PRIVATE-A">Data</td></tr>',
    cycles: 0,
    duplicates: 0,
  },
  {
    name: 'hidden-edge',
    body: '<tr><th id="private-a" headers="private-b">A</th><th hidden id="private-b" headers="private-a">B</th></tr>',
    cycles: 1,
    duplicates: 0,
  },
  {
    name: 'hidden-cycle',
    body: '<tr><th hidden id="private-a" headers="private-a">A</th><td>Data</td></tr>',
    cycles: 0,
    duplicates: 0,
  },
  {
    name: 'duplicate-id',
    body: '<tr><th id="private-a" headers="private-b">A</th><th id="private-b" headers="private-a">B</th><th id="private-b">Ambiguous</th></tr>',
    cycles: 0,
    duplicates: 0,
    limited: true,
  },
  {
    name: 'outside-sample',
    body:
      '<tr><th id="private-a" headers="private-last">A</th>' +
      '<td>Data</td>'.repeat(199) +
      '<th id="private-last" headers="private-a">Z</th></tr>',
    cycles: 0,
    duplicates: 0,
    limited: true,
  },
  {
    name: 'attribute-limit',
    body: '<tr><th headers="' + 'x'.repeat(8193) + '">A</th></tr>',
    cycles: 0,
    duplicates: 0,
    limited: true,
    limitedCells: 1,
  },
  {
    name: 'token-limit',
    body:
      '<tr><th headers="' +
      Array.from({ length: 65 }, (_, i) => 'private-' + i).join(' ') +
      '">A</th></tr>',
    cycles: 0,
    duplicates: 0,
    limited: true,
    limitedCells: 1,
  },
];
for (const example of cases)
  test(`explicit table headers: ${example.name}`, async ({ page }, info) => {
    let requests = 0;
    await page.route('**/*', route => {
      requests++;
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Header graph fixture</title><style>${css}</style><body class="bg-white text-slate-900"><main class="mx-auto max-w-3xl space-y-4 p-4"><h1 class="text-2xl font-bold">Table header relationships</h1><div class="overflow-x-auto"><table class="w-full border-separate border-spacing-2"><caption>Local grouped data</caption>${example.body}</table></div></main></body></html>`,
      });
    });
    await page.goto('http://127.0.0.1:45996/header-graph');
    const before = await page.locator('body').innerHTML();
    const previousRequests = requests;
    const result = await inspectDataWidgets(page);
    expect(requests).toBe(previousRequests);
    expect(await page.locator('body').innerHTML()).toBe(before);
    expect(result.findings.filter(f => f.rule === 'table-header-cycle')).toHaveLength(
      example.cycles,
    );
    const observation = result.observations.tables[0];
    expect(observation).toMatchObject({
      cyclicRenderedHeaders: example.cycles,
      duplicateReferenceTokens: example.duplicates,
      headerGraphLimited: example.limited ?? false,
      referenceLimitedCells: example.limitedCells ?? 0,
      headerAssociationsAndSpeechVerified: false,
    });
    expect(result.findings.filter(f => f.rule === 'table-header-reference-duplicate')).toHaveLength(
      example.duplicates ? 1 : 0,
    );
    expect(result.findings.every(f => f.severity === 'warning')).toBe(true);
    // Existing ambiguous-reference selectors can contain IDs; new graph/token
    // findings use structural paths and never export target IDs or table text.
    expect(
      JSON.stringify(
        result.findings.filter(f =>
          ['table-header-cycle', 'table-header-reference-duplicate'].includes(f.rule),
        ),
      ),
    ).not.toMatch(/private|PRIVATE|Private/);
    if (['acyclic-spans', 'nbsp-is-id', 'case-distinct', 'hidden-cycle'].includes(example.name))
      expect(result.findings).toEqual([]);
    if (example.name === 'acyclic-spans')
      await page.screenshot({ path: info.outputPath('table-headers.png'), fullPage: true });
  });
