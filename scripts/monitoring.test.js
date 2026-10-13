'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {
  transition,
  classification,
  scope,
  compareReports,
  scriptChanges,
} = require('./monitoring');
const { processRun } = require('./notify-run');
const { resolveSiteSettings } = require('../config/site-settings');
const scenario = outcome => ({
  name: 'cart',
  file: 'cart.ts',
  project: 'Chrome',
  outcome,
  attempts: [],
});
const summary = outcome => ({ metadata: { mode: 'smoke' }, scenarios: [scenario(outcome)] });
test('incident transitions group repeats and never recover a skipped check', () => {
  let prior = {};
  for (const [index, outcome] of ['failed', 'failed', 'failed', 'skipped', 'passed'].entries()) {
    const result = transition(prior, summary(outcome), String(index));
    assert.deepEqual(
      result.events.map(e => e.state),
      [['new'], ['confirmed'], [], [], ['recovered']][index],
    );
    prior = result.state;
  }
  assert.equal(transition(prior, summary('failed'), '4').events.length, 0);
  assert.notEqual(
    scope(summary('passed')),
    scope({ ...summary('passed'), metadata: { mode: 'full' } }),
  );
});
test('classification and candidate comparisons preserve unknown checks', () => {
  for (const [text, category] of [
    ['HTTP 429', 'blocked'],
    ['Cloudflare challenge', 'blocked'],
    ['Product not found', 'product-missing'],
    ['strict mode violation', 'selector'],
    ['ECONNRESET', 'infrastructure'],
    ['expect(price) Expected: 4', 'storefront'],
  ])
    assert.equal(
      classification({ ...scenario('failed'), attempts: [{ errors: [text] }] }),
      category,
    );
  assert.equal(compareReports(summary('failed'), summary('passed'))[0].change, 'regression');
  assert.equal(compareReports(summary('skipped'), summary('failed'))[0].change, 'unverified');
  assert.deepEqual(scriptChanges(['b'], ['a']), { baseline: false, added: ['b'], removed: ['a'] });
  assert.equal(scriptChanges(['b'], null).baseline, true);
});
test('monitoring configuration validates expectation limits and maintenance dates', () => {
  assert.throws(() => resolveSiteSettings({ expectations: { minProducts: 101 } }));
  assert.throws(() => resolveSiteSettings({ expectations: { currency: 'bad' } }));
  assert.throws(() => resolveSiteSettings({ expectations: { paymentPath: '//elsewhere.test' } }));
  assert.throws(() =>
    resolveSiteSettings({ notifications: { maintenance: [{ start: 'bad', end: 'bad' }] } }),
  );
});
test('webhook delivery retries after failure and maintenance, records recovery and does not repeat', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monitoring-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let status = 500;
  const messages = [];
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    messages.push(JSON.parse(body));
    response.writeHead(status);
    response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const env = {
    MONITORING_WEBHOOK_URL: `http://127.0.0.1:${server.address().port}`,
    REPORT_BASE_URL: 'https://reports.example.test',
  };
  async function run(id, outcome, options = { enabled: true }) {
    const dir = path.join(root, 'shop', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'run-metadata.json'),
      JSON.stringify({
        phase: 'finished',
        mode: 'smoke',
        site: { slug: 'shop' },
        scenarios: [scenario(outcome)],
      }),
    );
    await processRun(dir, options, env);
    return JSON.parse(fs.readFileSync(path.join(dir, 'notifications.json')));
  }
  assert.equal((await run('one', 'failed')).status, 'failed');
  status = 200;
  assert.equal(
    (
      await run('two', 'failed', {
        enabled: true,
        maintenance: [{ start: '2000-01-01', end: '2100-01-01' }],
      })
    ).suppressed,
    true,
  );
  assert.equal(messages.length, 1);
  assert.equal((await run('three', 'failed')).status, 'delivered');
  assert.deepEqual(
    messages[1].events.map(e => e.state),
    ['new', 'confirmed'],
  );
  await run('three', 'failed');
  assert.equal(messages.length, 2);
  await run('four', 'skipped');
  assert.equal(messages.length, 2);
  await run('five', 'passed');
  assert.equal(messages[2].events[0].state, 'recovered');
  assert.match(messages[2].reportUrl, /^https:\/\/reports.example.test\/reports\/shop\//);
});
test('script drift uses a successful inventory and preserves its baseline when collection is skipped', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'script-drift-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  async function run(id, scripts, outcome = 'passed') {
    const dir = path.join(root, id);
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, 'run-metadata.json'),
      JSON.stringify({
        phase: 'finished',
        scenarios: [{ ...scenario(outcome), name: 'third-party script inventory' }],
      }),
    );
    fs.writeFileSync(
      path.join(dir, 'third-party-scripts.json'),
      JSON.stringify({ complete: true, scripts }),
    );
    await processRun(dir);
    return fs.existsSync(path.join(dir, 'script-changes.json'))
      ? JSON.parse(fs.readFileSync(path.join(dir, 'script-changes.json')))
      : null;
  }
  assert.equal((await run('one', ['old.js'])).baseline, true);
  assert.equal(await run('two', [], 'skipped'), null);
  assert.deepEqual(await run('three', ['new.js']), {
    baseline: false,
    added: ['new.js'],
    removed: ['old.js'],
  });
});
test('global runner errors are reported separately and recover only after a completed run', () => {
  const failed = transition(
    {},
    { ...summary('not-run'), globalErrors: ['ECONNRESET'], status: 'global-errors' },
    'one',
  );
  assert.equal(failed.events[0].category, 'infrastructure');
  const skipped = transition(failed.state, { ...summary('skipped'), status: 'incomplete' }, 'two');
  assert.equal(skipped.events.length, 0);
  assert.equal(
    transition(skipped.state, { ...summary('passed'), status: 'passed' }, 'three').events[0].state,
    'recovered',
  );
});
test('history preserves missing metrics and calculates the median of measured samples', t => {
  const { catalog } = require('./report-catalog');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-history-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'shop', '2026-10-13_12-00-00-001');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'results.json'),
    JSON.stringify({ stats: { expected: 2, unexpected: 1 } }),
  );
  assert.equal(catalog(root)[0].runs[0].lcp, null);
  fs.writeFileSync(
    path.join(dir, 'web-vitals.json'),
    JSON.stringify({
      documents: [
        { metrics: { lcp: { status: 'measured', value: 1000 } } },
        { metrics: { lcp: { status: 'measured', value: 3000 } } },
        { metrics: { lcp: { status: 'unmeasured', value: 0 } } },
      ],
    }),
  );
  const run = catalog(root)[0].runs[0];
  assert.equal(run.lcp, 2000);
  assert.equal(run.passRate, 67);
});
