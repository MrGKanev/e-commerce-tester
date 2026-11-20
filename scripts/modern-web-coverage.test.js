'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateModernWebCoverage } = require('./check-modern-web-coverage');

function fixture(t) {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-web-coverage-'));
  t.after(() => fs.rmSync(repositoryRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repositoryRoot, 'docs'));
  fs.mkdirSync(path.join(repositoryRoot, 'tests'));
  fs.writeFileSync(path.join(repositoryRoot, 'tests/probe.ts'), '// fixture assertion');
  const row = (id, status, evidence = '[probe](../tests/probe.ts)') =>
    `| [\`${id}\`](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/${id}.md) | ${status} | ${evidence} | Explicit bounded contract and remaining gap | ${status === 'Not applicable' ? '—' : 'P1'} |`;
  const rows = [
    row('one', 'Covered'),
    row('two', 'Partial'),
    row('three', 'Pending', 'None credited'),
    row('four', 'Not applicable', 'Outside scope'),
  ];
  const modernWeb = `The current CLI-visible upstream catalog has **4 guides**.
| Covered | 1 | Count |
| Partial | 1 | Count |
| Pending | 1 | Count |
| Not applicable | 1 | Count |
| Total | 4 | Count |
**Remaining work spans 2 guide topics: 1 pending plus 1 partial.**
${rows.join('\n')}`;
  const testsReference =
    'Current catalog totals: **1 Covered / 1 Partial / 1 Pending / 1 outside scope** (4 guides).\n| Area | Remaining partial guide topics |\n| --- | --- |\n| Forms | `two` |\n';
  const catalog = ['one', 'two', 'three', 'four'].map(id => ({ id, description: 'fixture' }));
  return { repositoryRoot, modernWeb, testsReference, catalog, row };
}

test('consistent matrix, counts, repository evidence and optional offline CLI catalog pass', t => {
  const input = fixture(t);
  const result = validateModernWebCoverage(input);
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.total, 4);
  assert.deepEqual(result.counts, { Covered: 1, Partial: 1, Pending: 1, 'Not applicable': 1 });
  assert.equal(validateModernWebCoverage({ ...input, catalog: undefined }).valid, true);
});

test('duplicate rows fail even when ID-set equality would otherwise hide them', t => {
  const input = fixture(t);
  input.modernWeb += '\n' + input.row('two', 'Partial');
  const result = validateModernWebCoverage(input);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('Duplicate guide ID: two'));
  assert.ok(result.errors.some(error => error.startsWith('Summary Partial:')));
});

test('unknown and malformed status rows cannot silently disappear from coverage', t => {
  const input = fixture(t);
  input.modernWeb = input.modernWeb.replace('| Partial | [probe]', '| Complete | [probe]');
  assert.ok(validateModernWebCoverage(input).errors.includes('Unknown status for two: Complete'));
  input.modernWeb += '\n| [`broken`](https://example.test/broken.md) | Partial |';
  assert.ok(
    validateModernWebCoverage(input).errors.some(error => error.startsWith('Malformed guide row:')),
  );
});

test('missing evidence, external-only evidence and repository escapes fail credited rows', t => {
  const input = fixture(t);
  for (const [link, expected] of [
    ['[missing](../tests/missing.ts)', 'Missing evidence file for two:'],
    ['[outside](../../outside.ts)', 'Evidence link escapes repository for two:'],
    ['[external](https://example.test/probe.ts)', 'Missing executable repository evidence for two'],
  ]) {
    const result = validateModernWebCoverage({
      ...input,
      modernWeb: input.modernWeb.replace(
        input.row('two', 'Partial'),
        input.row('two', 'Partial', link),
      ),
    });
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some(error => error.startsWith(expected)),
      result.errors.join('\n'),
    );
  }
});

test('summary, remaining-work prose and TESTS index drift are independently rejected', t => {
  const input = fixture(t);
  const cases = [
    {
      modernWeb: input.modernWeb.replace('| Total | 4 |', '| Total | 5 |'),
      error: 'Summary Total:',
    },
    {
      modernWeb: input.modernWeb.replace('**4 guides**', '**5 guides**'),
      error: 'Catalog prose total',
    },
    {
      modernWeb: input.modernWeb.replace('2 guide topics: 1 pending', '3 guide topics: 2 pending'),
      error: 'Remaining-work counts',
    },
    {
      testsReference: input.testsReference.replace('1 Partial', '2 Partial'),
      error: 'TESTS.md catalog summary',
    },
  ];
  for (const entry of cases) {
    const result = validateModernWebCoverage({ ...input, ...entry });
    assert.ok(
      result.errors.some(error => error.startsWith(entry.error)),
      result.errors.join('\n'),
    );
  }
});

test('offline catalog compares exact IDs and rejects duplicate or malformed catalog input', t => {
  const input = fixture(t);
  let result = validateModernWebCoverage({
    ...input,
    catalog: [{ id: 'one' }, { id: 'two' }, { id: 'three' }, { id: 'new' }],
  });
  assert.ok(result.errors.includes('Guide not present in catalog: four'));
  assert.ok(result.errors.includes('Catalog guide missing from matrix: new'));
  result = validateModernWebCoverage({ ...input, catalog: [...input.catalog, { id: 'one' }] });
  assert.ok(result.errors.includes('Catalog contains duplicate IDs'));
  for (const catalog of [{ ids: ['one'] }, [{ description: 'missing id' }], [null]]) {
    result = validateModernWebCoverage({ ...input, catalog });
    assert.ok(result.errors.some(error => error.startsWith('Catalog must be a CLI list array')));
  }
});

test('empty matrices and nonofficial source links fail', t => {
  const input = fixture(t);
  assert.ok(
    validateModernWebCoverage({ ...input, modernWeb: '' }).errors.includes(
      'No catalog guide rows found',
    ),
  );
  const result = validateModernWebCoverage({
    ...input,
    modernWeb: input.modernWeb.replace(
      'https://github.com/GoogleChrome/modern-web-guidance/',
      'https://example.test/',
    ),
  });
  assert.ok(result.errors.includes('Unexpected upstream source for one'));
});

test('partial-topic index rejects missing, stale and duplicate guide membership', t => {
  const input = fixture(t);
  for (const [replacement, expected] of [
    ['| Forms | — |', 'Partial guide missing from TESTS.md index: two'],
    ['| Forms | `two`, `three` |', 'Stale guide in TESTS.md partial-topic index: three'],
    ['| Forms | `two`, `two` |', 'Duplicate guide in TESTS.md partial-topic index'],
  ]) {
    const result = validateModernWebCoverage({
      ...input,
      testsReference: input.testsReference.replace('| Forms | `two` |', replacement),
    });
    assert.ok(result.errors.includes(expected), result.errors.join('\n'));
  }
  assert.ok(
    validateModernWebCoverage({
      ...input,
      testsReference: input.testsReference.split('\n| Area |')[0],
    }).errors.includes('Missing TESTS.md partial-topic index'),
  );
});
