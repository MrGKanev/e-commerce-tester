'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeRun } = require('./report-model');

function spec(name, outcome, annotations = [], results) {
  return { title: name, file: 'sample.spec.ts', line: 1, tags: ['@smoke'], id: name,
    tests: [{ status: outcome, projectName: 'Chrome', annotations,
      results: results || [{ workerIndex: 0, status: outcome === 'expected' ? 'passed' : outcome === 'skipped' ? 'skipped' : 'failed', retry: 0, errors: [] }] }] };
}
function report(specs) { return { suites: [{ title: 'Shopping', specs }], errors: [] }; }

test('pass rate counts completed outcomes while coverage excludes only explicitly inapplicable skips', () => {
  const r = summarizeRun(report([
    ...Array.from({ length: 7 }, (_, i) => spec(`pass-${i}`, 'expected')),
    spec('flaky', 'flaky', [], [{ workerIndex: 0, status: 'failed', retry: 0, errors: [{ message: 'Delayed price' }] }, { workerIndex: 1, status: 'passed', retry: 1 }]),
    spec('failed', 'unexpected'),
    spec('absent', 'skipped', [{ type: 'skip', description: 'Not configured' }, { type: 'not-applicable', description: 'Optional widget' }]),
    spec('fixme', 'skipped', [{ type: 'fixme', description: 'Known broken scenario' }]),
  ]));
  assert.equal(r.executed, 9);
  assert.equal(r.applicable, 10);
  assert.equal(r.passRate, 89); // 8 successful final outcomes / 9 completed
  assert.equal(r.coverage, 90);
  assert.equal(r.unclassifiedSkipped, 1);
  assert.equal(r.scenarios.find(s => s.outcome === 'flaky').attempts[0].errors[0], 'Delayed price');
  assert.ok(r.scenarios.find(s => s.notApplicable).reasons.includes('Optional widget'));
});

test('interrupted and unstarted tests are not completed and remain applicable', () => {
  const r = summarizeRun(report([
    spec('done', 'expected'),
    spec('cancelled', 'unexpected', [], [{ workerIndex: 0, status: 'interrupted', retry: 0 }]),
    spec('not started', 'skipped', [], [{ workerIndex: -1, status: 'skipped', retry: 0 }]),
  ]));
  assert.equal(r.status, 'interrupted');
  assert.equal(r.passRate, 100);
  assert.equal(r.coverage, 33);
  assert.equal(r.notRun, 1);
});

test('empty, globally errored, flaky and all-inapplicable runs have distinct non-green states', () => {
  assert.equal(summarizeRun({}).status, 'empty');
  assert.equal(summarizeRun({}).passRate, null);
  assert.equal(summarizeRun({}).coverage, null);
  assert.equal(summarizeRun({ errors: [{ message: 'Setup failed' }] }).status, 'global-errors');
  const flaky = summarizeRun(report([spec('retry', 'flaky')]));
  assert.equal(flaky.status, 'flaky');
  assert.equal(flaky.passRate, 100);
  assert.equal(flaky.allPassed, false);
  const na = summarizeRun(report([spec('unsupported', 'skipped', [{ type: 'skip' }, { type: 'not-applicable' }])]));
  assert.equal(na.status, 'not-applicable');
  assert.equal(na.coverage, null);
});

test('missing final JSON uses checkpointed scenarios and never reports a clean run', () => {
  const r = summarizeRun({}, { phase: 'running', scenarios: [
    { title: 'One', file: 'one.ts', project: 'Chrome', outcome: 'passed' },
    { title: 'Two', file: 'two.ts', project: 'Chrome', outcome: 'not-run' },
  ] }, 'No final results');
  assert.equal(r.status, 'incomplete');
  assert.equal(r.coverage, 50);
  assert.equal(r.errors, 0); // Missing artifacts are not fabricated global test errors.
});

test('a truncated suite keeps planned scenarios missing from the final report', () => {
  const r = summarizeRun(report([spec('done', 'expected')]), { phase: 'finished', scenarios: [
    { name: 'done', title: 'Shopping › done', file: 'sample.spec.ts', line: 1, project: 'Chrome', outcome: 'passed' },
    { name: 'missing', title: 'Shopping › missing', file: 'sample.spec.ts', line: 2, project: 'Chrome', outcome: 'not-run' },
  ] });
  assert.equal(r.total, 2);
  assert.equal(r.coverage, 50);
  assert.equal(r.status, 'incomplete');
});

test('legacy stats-only JSON retains conservative coverage and deduplicates global errors', () => {
  const r = summarizeRun({ stats: { expected: 8, unexpected: 2, skipped: 5, flaky: 0 }, errors: [{ message: 'Global' }] }, { errors: ['Global'] });
  assert.equal(r.passRate, 80);
  assert.equal(r.coverage, 67);
  assert.equal(r.errors, 1);
  assert.equal(r.unclassifiedSkipped, 5);
});


test('active test checkpoints distinguish interrupted attempts from unstarted scenarios', () => {
  const scenario = { title: 'Cart', file: 'cart.ts', project: 'Chrome', outcome: 'running', activeRetry: 1, attempts: [] };
  const interrupted = summarizeRun({}, { phase: 'finished', status: 'interrupted', scenarios: [{ ...scenario }] }, 'Final report missing');
  assert.equal(interrupted.interrupted, 1);
  assert.equal(interrupted.notRun, 0);
  assert.equal(interrupted.coverage, 0);
  const unknown = summarizeRun({}, { phase: 'running', scenarios: [{ ...scenario }] }, 'Final report missing');
  assert.equal(unknown.status, 'incomplete');
  assert.equal(unknown.unfinished, 1);
  assert.equal(unknown.notRun, 0);
});
