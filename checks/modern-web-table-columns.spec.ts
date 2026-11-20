// Sources: https://html.spec.whatwg.org/multipage/tables.html#forming-a-table (step 9)
// https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-atoms/responsive-table.md
// Column declarations set a minimum grid width, not cell anchors. Group span is
// ignored when col children exist. Native IDL normalization is intentionally used;
// work limits and CSS exclusions are local audit scope, not merchant requirements.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { inspectDataWidgets } from '../tests/modern-web-data-widgets';
const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
const cells = (count: number) => '<tr>' + '<td>Value</td>'.repeat(count) + '</tr>';
const cases = [
  {
    name: 'matching-group',
    columns: '<colgroup span="2"></colgroup>',
    declared: 2,
    groups: 1,
    cols: 0,
  },
  {
    name: 'extra-declared-column',
    columns: '<colgroup span="3"></colgroup>',
    declared: 3,
    groups: 1,
    cols: 0,
    gaps: 1,
    anchors: 1,
  },
  { name: 'cells-extend-width', columns: '<colgroup></colgroup>', declared: 1, groups: 1, cols: 0 },
  {
    name: 'child-columns',
    columns: '<colgroup><col><col></colgroup>',
    declared: 2,
    groups: 1,
    cols: 2,
  },
  {
    name: 'child-span',
    columns: '<colgroup><col span="2"></colgroup>',
    declared: 2,
    groups: 1,
    cols: 1,
  },
  {
    name: 'ignore-group-span',
    columns: '<colgroup span="9999"><col><col></colgroup>',
    declared: 2,
    groups: 1,
    cols: 2,
  },
  {
    name: 'multiple-groups',
    columns: '<colgroup></colgroup><colgroup><col></colgroup>',
    declared: 2,
    groups: 2,
    cols: 1,
  },
  {
    name: 'group-zero',
    columns: '<colgroup span="0"></colgroup>',
    declared: 1,
    groups: 1,
    cols: 0,
  },
  {
    name: 'group-negative',
    columns: '<colgroup span="-2"></colgroup>',
    declared: 1,
    groups: 1,
    cols: 0,
  },
  {
    name: 'group-invalid',
    columns: '<colgroup span="invalid"></colgroup>',
    declared: 1,
    groups: 1,
    cols: 0,
  },
  {
    name: 'col-zero',
    columns: '<colgroup><col span="0"></colgroup>',
    declared: 1,
    groups: 1,
    cols: 1,
  },
  {
    name: 'col-invalid',
    columns: '<colgroup><col span="invalid"></colgroup>',
    declared: 1,
    groups: 1,
    cols: 1,
  },
  {
    name: 'col-parsed-prefix',
    columns: '<colgroup><col span="2suffix"></colgroup>',
    declared: 2,
    groups: 1,
    cols: 1,
  },
  {
    name: 'group-boundary',
    columns: '<colgroup span="128"></colgroup>',
    declared: 128,
    groups: 1,
    cols: 0,
    gaps: 126,
    anchors: 126,
  },
  {
    name: 'group-limit',
    columns: '<colgroup span="129"></colgroup>',
    reason: 'declared-column-limit',
  },
  {
    name: 'col-clamped-limit',
    columns: '<colgroup><col span="9999"></colgroup>',
    reason: 'declared-column-limit',
  },
  {
    name: 'summed-limit',
    columns: '<colgroup span="64"></colgroup><colgroup span="65"></colgroup>',
    reason: 'declared-column-limit',
  },
  {
    name: 'hidden-group',
    columns: '<colgroup hidden span="3"></colgroup>',
    reason: 'non-native-or-hidden-column',
  },
  {
    name: 'collapsed-group',
    columns: '<colgroup class="collapse"></colgroup><colgroup></colgroup>',
    reason: 'non-native-or-hidden-column',
  },
  {
    name: 'hidden-col',
    columns: '<colgroup><col hidden><col></colgroup>',
    reason: 'non-native-or-hidden-column',
  },
  {
    name: 'collapsed-col',
    columns: '<colgroup><col class="collapse"><col></colgroup>',
    reason: 'non-native-or-hidden-column',
  },
  {
    name: 'block-col',
    columns: '<colgroup><col class="block"><col></colgroup>',
    reason: 'non-native-or-hidden-column',
  },
  {
    name: 'template-child',
    columns: '<colgroup><template><col span="99"></template><col span="2"></colgroup>',
    declared: 2,
    groups: 1,
    cols: 1,
  },
  {
    name: 'nested-isolation',
    columns: '<colgroup span="2"></colgroup>',
    declared: 2,
    groups: 1,
    cols: 0,
  },
  { name: 'late-group', columns: '', reason: 'late-column-group' },
  { name: 'direct-col', columns: '', reason: 'unsupported-column-ownership' },
  {
    name: 'malformed-child',
    columns: '<colgroup span="2"></colgroup>',
    reason: 'unsupported-column-structure',
  },
  {
    name: 'structure-boundary',
    columns: '<colgroup><col></colgroup>'.repeat(127),
    declared: 127,
    groups: 127,
    cols: 127,
    cellCount: 127,
  },
  {
    name: 'structure-limit',
    columns: '<colgroup><col><col></colgroup>' + '<colgroup><col></colgroup>'.repeat(126),
    reason: 'column-structure-limit',
  },
];
for (const example of cases)
  test(`declared table columns: ${example.name}`, async ({ page }, info) => {
    let requests = 0;
    await page.route('**/*', route => {
      requests++;
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Declared columns</title><style>${css}</style><body class="bg-white text-slate-900"><main class="p-4"><h1 class="text-2xl">Declared columns</h1><div class="overflow-x-auto"><table class="w-full border-separate border-spacing-2 [&_td]:p-2"><caption>Comparison</caption>${example.columns}<tbody>${example.name === 'nested-isolation' ? '<tr><td>Value</td><td><table><colgroup span="4"></colgroup><tr><td>Nested</td></tr></table></td></tr>' : cells(example.cellCount ?? 2)}</tbody></table></div></main></body></html>`,
      });
    });
    await page.goto('http://127.0.0.1:45996/table-columns');
    await page.locator('main > div > table').evaluate((table, scenario) => {
      if (scenario === 'late-group') table.appendChild(document.createElement('colgroup'));
      if (scenario === 'direct-col')
        table.insertBefore(document.createElement('col'), table.firstChild);
      if (scenario === 'malformed-child')
        table.querySelector('colgroup')!.appendChild(document.createElement('div'));
    }, example.name);
    const before = await page.locator('body').innerHTML(),
      count = requests;
    const report = await inspectDataWidgets(page);
    expect(requests).toBe(count);
    expect(await page.locator('body').innerHTML()).toBe(before);
    const outer = report.observations.tables[0];
    const model = outer.spanOccupancy.gridCoverage;
    // Excluded columns do not erase independently observed cell-span occupancy.
    if (!example.name.startsWith('collapsed-'))
      expect(outer.spanOccupancy).toMatchObject({ status: 'observed', overlapPlacements: 0 });
    const findings = report.findings.filter(
      item =>
        ['table-grid-gap', 'table-grid-anchors'].includes(item.rule) &&
        item.selector ===
          'html > body:nth-of-type(1) > main:nth-of-type(1) > div:nth-of-type(1) > table:nth-of-type(1)',
    );
    if (example.reason) {
      expect(model).toMatchObject({
        status: 'unverified',
        ...(example.name.startsWith('collapsed-') ? {} : { reason: example.reason }),
        declaredColumns: null,
        uncoveredSlots: null,
        columnsWithoutAnchors: null,
      });
      if (example.name.startsWith('collapsed-'))
        expect(['non-native-or-hidden-cell', 'non-native-or-hidden-column']).toContain(
          'reason' in model ? model.reason : undefined,
        );
      expect(findings).toEqual([]);
    } else {
      expect(model).toMatchObject({
        status: 'observed',
        declaredColumns: example.declared,
        columnGroups: example.groups,
        columnElements: example.cols,
        uncoveredSlots: example.gaps ?? 0,
        columnsWithoutAnchors: example.anchors ?? 0,
        rowsWithoutAnchors: 0,
        columnStructureLimit: 256,
        headerAssociationsVerified: false,
        renderedGapsVerified: false,
      });
      expect(findings.map(item => item.rule).sort()).toEqual(
        [
          ...(example.gaps ? ['table-grid-gap'] : []),
          ...(example.anchors ? ['table-grid-anchors'] : []),
        ].sort(),
      );
      expect(JSON.stringify(findings)).not.toMatch(/Comparison|Value|Nested/);
    }
    if (
      example.name === 'matching-group' &&
      ['Desktop Chrome', 'Mobile Chrome'].includes(info.project.name)
    )
      await page.screenshot({ path: info.outputPath('declared-columns.png'), fullPage: true });
  });
