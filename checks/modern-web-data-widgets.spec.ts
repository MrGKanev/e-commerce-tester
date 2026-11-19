import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { inspectDataWidgets } from '../tests/modern-web-data-widgets';

const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
const fixture = (body: string) =>
  `<!doctype html><html lang="en"><head><title>Data widgets fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main class="space-y-4 p-4"><h1>Data widgets fixture</h1>${body}</main></body></html>`;
const ring =
  '<svg viewBox="0 0 40 40" class="size-10 fill-none stroke-blue-600" aria-hidden="true"><circle cx="20" cy="20" r="15"/></svg>';
async function load(page: import('@playwright/test').Page, body: string) {
  await page.route('**/*', route =>
    route.fulfill({ contentType: 'text/html', body: fixture(body) }),
  );
  await page.goto('http://127.0.0.1:45996/data-widgets');
}

test('explicit table header references reject missing, non-header and foreign-table targets without content evidence', async ({
  page,
}) => {
  await load(
    page,
    `<span id="not-header">private-header-text</span>
    <table><tr><th id="foreign">Foreign header</th></tr></table>
    <table id="bad" role="table"><caption>private-caption</caption><tr><td headers="missing not-header foreign">private-cell</td><td>Other</td></tr><tr><td>Data</td><td>Data</td></tr></table>`,
  );
  const report = await inspectDataWidgets(page);
  expect(report.findings.map(f => f.rule)).toEqual(
    expect.arrayContaining(['table-header-reference', 'table-header-structure']),
  );
  expect(report.findings.find(f => f.rule === 'table-header-reference')?.evidence).toMatchObject({
    referenceCount: 3,
    invalidReferenceCount: 3,
  });
  expect(report.findings.every(f => f.severity === 'warning')).toBe(true);
  expect(JSON.stringify(report)).not.toMatch(
    /private-header-text|private-caption|private-cell|not-header|foreign/,
  );
});

test('native semantic table relationships and accessible overflow do not require sticky headers or container queries', async ({
  page,
}) => {
  await load(
    page,
    `<div class="w-32 overflow-x-auto" role="region" aria-label="Product sizes" tabindex="0">
    <table id="safe" class="w-96"><caption>Product sizes</caption><thead><tr><th id="size">Size</th><th id="length">Length</th></tr></thead><tbody><tr><th id="small">Small</th><td headers="small length">10</td></tr></tbody></table>
    </div>
    <table role="presentation"><tr><td>Layout content</td></tr></table>
    <div hidden><table role="table"><tr><td>Hidden</td></tr></table></div>`,
  );
  const report = await inspectDataWidgets(page);
  expect(report.findings).toEqual([]);
  expect(report.coverage.tables).toBe(1);
  expect(report.observations.tables[0]).toMatchObject({
    headerCount: 3,
    horizontalScrollContainer: true,
    scrollContainerHasName: true,
    scrollContainerExplicitTabStop: true,
    keyboardScrollVerified: false,
  });
});

test('actual table clipping remains advisory while nested scrolling is an accepted route', async ({
  page,
}) => {
  await load(
    page,
    `<div class="w-32 overflow-hidden"><table id="clipped" class="w-96"><tr><th>Size</th><th>Length</th></tr><tr><td>Small</td><td>10</td></tr></table></div>
    <div class="w-32 overflow-hidden"><div class="w-32 overflow-x-auto"><table id="scrollable" class="w-96"><tr><th>Size</th><th>Length</th></tr><tr><td>Small</td><td>10</td></tr></table></div></div>`,
  );
  const report = await inspectDataWidgets(page);
  expect(
    report.findings.filter(f => f.rule === 'table-clipped-content').map(f => f.selector),
  ).toEqual(['#clipped']);
});

test('SVG ring semantics require an accessible task name and valid determinate values', async ({
  page,
}) => {
  await load(
    page,
    `<div id="broken-ring" role="progressbar" aria-valuemin="10" aria-valuemax="5" aria-valuenow="private-nonnumeric">${ring}</div>
    <div id="good-ring" role="progressbar" aria-label="Upload progress" aria-valuenow="50" aria-valuetext="private-progress-description">${ring}</div>
    <div id="indeterminate" role="progressbar" aria-label="Loading">${ring}</div>
    <div id="title-ring" role="progressbar" title="Loading task">${ring}</div>`,
  );
  const report = await inspectDataWidgets(page);
  expect(report.coverage.ringCandidates).toBe(4);
  expect(report.findings.map(f => [f.rule, f.selector])).toEqual([
    ['progress-range-semantics', '#broken-ring'],
    ['progress-ring-name', '#broken-ring'],
  ]);
  expect(report.observations.progress.find(p => p.selector === '#indeterminate')).toMatchObject({
    determinate: false,
    currentValueInRange: true,
  });
  expect(JSON.stringify(report)).not.toMatch(
    /private-nonnumeric|private-progress-description|Upload progress/,
  );
});

test('native progress clamping and optional indeterminate state remain valid platform behavior', async ({
  page,
}) => {
  await load(
    page,
    `<label for="native">Upload</label><progress id="native" value="999" max="100"></progress>
    <progress id="pending" aria-label="Waiting"></progress>
    <div role="progressbar" aria-label="Complete empty work" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">${ring}</div>`,
  );
  const report = await inspectDataWidgets(page);
  expect(report.findings).toEqual([]);
  expect(report.observations.progress.find(p => p.selector === '#native')).toMatchObject({
    native: true,
    nativeValueClampingApplied: true,
    currentValueInRange: true,
    namePresent: true,
  });
  expect(report.observations.progress.find(p => p.selector === '#pending')).toMatchObject({
    native: true,
    determinate: false,
  });
});

test('empty scope, sample limits and passive execution remain explicit', async ({ page }) => {
  await load(page, '');
  const empty = await inspectDataWidgets(page);
  expect(empty.coverage).toMatchObject({
    tables: 0,
    progressIndicators: 0,
    ringCandidates: 0,
    passive: true,
  });
  expect(empty.findings).toEqual([]);
  await page.evaluate(() => {
    for (let i = 0; i < 25; i++) {
      const table = document.createElement('table');
      table.innerHTML = '<tr><th>Header</th></tr><tr><td>Value</td></tr>';
      document.querySelector('main')!.append(table);
    }
  });
  const before = await page.locator('body').innerHTML();
  const report = await inspectDataWidgets(page);
  expect(report.coverage).toMatchObject({ tables: 25, tableSampleTruncated: true, tableLimit: 20 });
  expect(report.observations.tables).toHaveLength(20);
  expect(await page.locator('body').innerHTML()).toBe(before);
});

test('unknown authored header scope is advisory while standard and omitted scopes are accepted', async ({
  page,
}) => {
  await load(
    page,
    '<table><tr><th id="bad-scope" scope="private-invalid-axis">Bad</th><th scope="ROW">Row</th><th scope="col">Column</th><th scope="rowgroup">Rows</th><th scope="colgroup">Columns</th><th>Auto</th><th scope="">Empty auto</th></tr></table>',
  );
  const report = await inspectDataWidgets(page);
  expect(report.findings).toEqual([
    expect.objectContaining({
      rule: 'table-header-scope',
      severity: 'warning',
      selector: '#bad-scope',
      evidence: { recognizedScopeKeyword: false, browserAutoFallback: true },
    }),
  ]);
  expect(JSON.stringify(report)).not.toContain('private-invalid-axis');
});

test('hidden responsive cells are not audited but visible cells may reference hidden headers', async ({
  page,
}) => {
  await load(
    page,
    '<table><tr hidden><th id="column">Hidden header</th></tr><tr><td hidden headers="private-missing">Hidden data</td><td headers="column">Visible data</td></tr></table>',
  );
  const report = await inspectDataWidgets(page);
  expect(report.findings).toEqual([]);
  expect(report.observations.tables[0]).toMatchObject({
    sampledCells: 3,
    renderedSampledCells: 1,
    invalidReferences: 0,
  });
  expect(JSON.stringify(report)).not.toContain('private-missing');
});

test('content-visibility hidden table and progress ancestors are outside rendered scope', async ({
  page,
}) => {
  await load(
    page,
    '<div id="hidden-scope"><table><tr><th scope="invalid">Header</th></tr></table><div role="progressbar" aria-valuenow="invalid">' +
      ring +
      '</div></div>',
  );
  await page.locator('#hidden-scope').evaluate(el => {
    (el as HTMLElement).style.contentVisibility = 'hidden';
  });
  const report = await inspectDataWidgets(page);
  expect(report.coverage).toMatchObject({ tables: 0, progressIndicators: 0 });
  expect(report.findings).toEqual([]);
});

test('explicit header references detect duplicate IDs even when the first target is valid', async ({
  page,
}) => {
  await load(
    page,
    `<table><tr><th id="private-duplicate">Header</th></tr><tr><td headers="private-duplicate private-duplicate">Private value</td></tr></table>
    <span hidden id="private-duplicate">Hidden duplicate</span>`,
  );
  const before = await page.locator('body').innerHTML();
  const report = await inspectDataWidgets(page);
  expect(report.findings).toEqual([
    expect.objectContaining({
      rule: 'table-header-reference-ambiguous',
      severity: 'warning',
      evidence: { ambiguousReferenceCount: 1, uniqueTargetVerified: false },
    }),
  ]);
  expect(report.observations.tables[0]).toMatchObject({
    invalidReferences: 0,
    ambiguousReferences: 1,
  });
  expect(JSON.stringify(report)).not.toMatch(/private-duplicate|Private value|Hidden duplicate/);
  expect(await page.locator('body').innerHTML()).toBe(before);
});

test('unique punctuation IDs and repeated header tokens are accepted; unrelated duplicates are ignored', async ({
  page,
}) => {
  await load(
    page,
    `<span id="unrelated">One</span><span id="unrelated">Two</span>
    <table><tr><th id="column:1">Header</th></tr><tr><td headers="column:1 column:1">Value</td></tr></table>`,
  );
  const report = await inspectDataWidgets(page);
  expect(report.findings).toEqual([]);
  expect(report.observations.tables[0]).toMatchObject({
    invalidReferences: 0,
    ambiguousReferences: 0,
  });
});

test('duplicate header references in hidden cells remain outside rendered scope', async ({
  page,
}) => {
  await load(
    page,
    `<table><tr><th id="duplicate">Header</th><th id="duplicate">Other</th></tr>
    <tr><td hidden headers="duplicate">Hidden data</td><td>Visible data</td></tr></table>`,
  );
  const report = await inspectDataWidgets(page);
  expect(report.findings).toEqual([]);
  expect(report.observations.tables[0].ambiguousReferences).toBe(0);
});
