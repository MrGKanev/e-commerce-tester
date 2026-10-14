'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { backup, restore } = require('./backup');
const { pruneReports, pinReport } = require('./retention');
const { listIssues, updateIssue, issueId } = require('./issues');
const { resolveSiteSettings } = require('../config/site-settings');
const { transition } = require('./monitoring');
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'operations-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}
test('backup restores configuration, approved pixels and incident state, rejects tampering and existing destinations', t => {
  const root = temporary(t),
    source = path.join(root, 'source'),
    archive = path.join(root, 'backup'),
    restored = path.join(root, 'restored');
  write(path.join(source, 'managed-config/configuration.json'), { sites: [] });
  write(path.join(source, 'visual-baselines/shop/approved.json'), { revision: 'one' });
  write(path.join(source, 'reports/shop/.monitoring/state.json'), { incident: true });
  write(path.join(source, 'scheduler-state/schedule.json'), { jobs: {} });
  assert.equal(backup(source, archive).files, 4);
  assert.equal(restore(archive, restored).files, 4);
  assert.equal(
    fs.readFileSync(path.join(restored, 'visual-baselines/shop/approved.json'), 'utf8'),
    '{"revision":"one"}',
  );
  assert.throws(() => restore(archive, restored), /nonexistent/);
  fs.writeFileSync(path.join(archive, 'visual-baselines/shop/approved.json'), 'corrupt');
  assert.throws(() => restore(archive, path.join(root, 'bad')), /checksum/);
  assert.equal(fs.existsSync(path.join(root, 'bad')), false);
  fs.symlinkSync(source, path.join(root, 'source-alias'));
  assert.throws(() => backup(source, path.join(root, 'source-alias/reports/backup')), /outside/);
  fs.symlinkSync(source, path.join(source, 'reports/link'));
  assert.throws(() => backup(source, path.join(root, 'linked')), /symbolic/);
});
test('backup refuses a running scheduler', t => {
  const root = temporary(t);
  write(path.join(root, 'source/scheduler-state/scheduler.lock'), {
    pid: process.pid,
    host: os.hostname(),
  });
  assert.throws(
    () => backup(path.join(root, 'source'), path.join(root, 'backup')),
    /Another scheduler/,
  );
});
test('incident annotations survive repeats, use revision conflicts, and retention preserves first/latest evidence and pins', t => {
  const root = temporary(t),
    reports = path.join(root, 'reports'),
    scope = 'a'.repeat(64);
  const names = Array.from({ length: 7 }, (_, i) => `2026-10-0${i + 1}_12-00`);
  for (const name of names)
    write(path.join(reports, 'shop', name, 'run-metadata.json'), {
      phase: 'finished',
      startedAt: '2026-10-01T12:00:00Z',
    });
  const summary = {
    metadata: { startedAt: '2026-10-01T12:00:00Z' },
    scenarios: [
      { name: 'Cart', title: 'Cart', file: 'cart.ts', project: 'Chrome', outcome: 'failed' },
    ],
  };
  const first = transition({}, summary, names[0]).state;
  const next = transition(first, summary, names[2]).state;
  const stateFile = path.join(reports, 'shop/.monitoring', scope + '.json');
  write(stateFile, next);
  const issue = listIssues(reports)[0];
  assert.equal(issue.firstRun, names[0]);
  assert.equal(issue.lastRun, names[2]);
  const update = {
    site: 'shop',
    id: issue.id,
    severity: 'high',
    owner: 'Ana',
    note: 'Investigating',
    mutedUntil: '2030-01-01T00:00:00Z',
  };
  updateIssue(reports, update);
  assert.throws(() => updateIssue(reports, update), /another tab/);
  assert.equal(listIssues(reports)[0].owner, 'Ana');
  pinReport(reports, 'shop', names[3], true);
  const deleted = pruneReports(reports, [
    { slug: 'shop', settings: { retention: { maxRuns: 1, maxDays: 1, maxBytes: 1 } } },
  ]);
  assert.deepEqual(
    deleted,
    [names[1], names[4], names[5]].map(n => 'shop/' + n),
  );
  const recovered = transition(
    next,
    { ...summary, scenarios: [{ ...summary.scenarios[0], outcome: 'passed' }] },
    'recovered',
  ).state;
  write(stateFile, recovered);
  assert.equal(listIssues(reports).length, 0);
  assert.equal(issue.id, issueId(scope, Object.keys(first.incidents)[0]));
});
test('new configuration rejects impossible totals, bad paths and unsupported form actions', () => {
  const totals = {
    fields: [],
    shippingMethod: '#shipping',
    currency: 'EUR',
    taxIncluded: false,
    subtotal: 1000,
    shipping: 100,
    tax: 200,
    discount: 0,
    total: 1300,
    subtotalSelector: '#subtotal',
    shippingSelector: '#shipping-cost',
    taxSelector: '#tax',
    discountSelector: '#discount',
    totalSelector: '#total',
  };
  assert.equal(resolveSiteSettings({ checkoutTotals: totals }).checkoutTotals.total, 1300);
  assert.throws(
    () => resolveSiteSettings({ checkoutTotals: { ...totals, total: 1301 } }),
    /must equal/,
  );
  assert.throws(
    () => resolveSiteSettings({ checkoutTotals: { ...totals, freeShippingThreshold: 1000 } }),
    /shipping must be zero/,
  );
  assert.throws(() =>
    resolveSiteSettings({
      checkoutTotals: { ...totals, fields: [{ selector: '#order', kind: 'click' }] },
    }),
  );
  const market = {
    name: 'France',
    path: '/',
    locale: 'fr-FR',
    language: 'fr',
    currency: 'EUR',
    unitPrice: 500,
    checkoutTotals: totals,
  };
  assert.throws(() => resolveSiteSettings({ markets: [market, market] }), /unique/);
  assert.throws(() => resolveSiteSettings({ markets: [{ ...market, path: '//external.test' }] }));
  assert.throws(() => resolveSiteSettings({ retention: { maxRuns: 0 } }));
});
