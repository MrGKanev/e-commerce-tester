'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createControlServer } = require('./control-server');
const { emptyConfiguration } = require('./managed-config');
async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'control-test-'));
  const configFile = path.join(directory, 'config/configuration.json');
  const server = createControlServer({
    configFile,
    stateDir: path.join(directory, 'state'),
    reportsDir: path.join(directory, 'reports'),
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const initial = await (await fetch(origin + '/api/config')).json();
  const put = (data, headers = {}) =>
    fetch(origin + '/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Control-Token': initial.token, ...headers },
      body: JSON.stringify({ ...data, revision: initial.revision }),
    });
  return { directory, configFile, origin, initial, put };
}
function data() {
  const value = emptyConfiguration();
  value.sites = [
    {
      slug: 'store',
      name: 'Example',
      url: 'https://example.test',
      productHandle: 'one',
      productHandle2: 'two',
      spelling: { allowWords: ['OriginalBrand'], acceptedFindings: ['reviewed-id'] },
      selectors: { price: '.price' },
    },
  ];
  value.scheduler.sites.store = {
    enabled: false,
    jobs: [
      { id: 'smoke', mode: 'smoke', intervalMinutes: [120, 240], projects: ['Desktop Chrome'] },
    ],
  };
  return value;
}
test('empty installation serves the editor and does not create implicit live stores', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.initial.sites, []);
  assert.equal(fs.existsSync(f.configFile), false);
  const page = await fetch(f.origin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Stores &amp; schedules|Stores & schedules/);
  const reports = await fetch(f.origin + '/reports/dashboard.html');
  assert.match(await reports.text(), /No reports yet/);
});
test('valid configuration is saved together, preserving advanced settings and disabled stores', async t => {
  const f = await fixture(t),
    value = data();
  const response = await f.put(value);
  assert.equal(response.status, 200);
  const saved = JSON.parse(fs.readFileSync(f.configFile));
  assert.deepEqual(saved, value);
  const loaded = await (await fetch(f.origin + '/api/config')).json();
  assert.notEqual(loaded.revision, f.initial.revision);
  assert.deepEqual(loaded.sites[0].spelling.acceptedFindings, ['reviewed-id']);
});
test('invalid configuration and missing/cross-origin tokens cannot change persisted settings', async t => {
  const f = await fixture(t);
  const value = data();
  value.sites[0].slug = '../escape';
  assert.equal((await f.put(value)).status, 400);
  assert.equal((await f.put(data(), { 'X-Control-Token': 'wrong' })).status, 403);
  assert.equal((await f.put(data(), { Origin: 'https://unrelated.test' })).status, 403);
  assert.equal(fs.existsSync(f.configFile), false);
});
test('optimistic revisions protect edits from another tab and all stores can be removed', async t => {
  const f = await fixture(t);
  assert.equal((await f.put(data())).status, 200);
  assert.equal((await f.put(data())).status, 409);
  const current = await (await fetch(f.origin + '/api/config')).json();
  const response = await fetch(f.origin + '/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Control-Token': current.token },
    body: JSON.stringify({ ...emptyConfiguration(), revision: current.revision }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.configFile)).sites, []);
});
test('report serving blocks traversal and symlinks outside the report directory', async t => {
  const f = await fixture(t);
  fs.mkdirSync(path.join(f.directory, 'reports'));
  fs.writeFileSync(path.join(f.directory, 'secret.txt'), 'sensitive');
  fs.symlinkSync(
    path.join(f.directory, 'secret.txt'),
    path.join(f.directory, 'reports', 'escape.txt'),
  );
  assert.equal((await fetch(f.origin + '/reports/escape.txt')).status, 404);
  fs.symlinkSync(
    path.join(f.directory, 'secret.txt'),
    path.join(f.directory, 'reports', 'dashboard.html'),
  );
  assert.equal((await fetch(f.origin + '/reports/dashboard.html')).status, 404);
  assert.equal((await fetch(f.origin + '/reports/%2e%2e%2fsecret.txt')).status, 404);
  const response = await fetch(f.origin + '/api/status');
  const status = await response.json();
  assert.equal(status.healthy, false);
  assert.deepEqual(status.jobs, []);
});

test('import validation normalizes missing slugs without saving or launching checks', async t => {
  const f = await fixture(t),
    value = data();
  delete value.sites[0].slug;
  value.scheduler.sites = {};
  value.scheduler.defaults = {
    jobs: [{ id: 'smoke', mode: 'smoke', intervalMinutes: [120, 240] }],
  };
  const response = await fetch(f.origin + '/api/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Control-Token': f.initial.token },
    body: JSON.stringify(value),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).sites[0].slug, 'example-test');
  assert.equal(fs.existsSync(f.configFile), false);
});

test('report catalog lists newest runs, supports legacy HTML and remains embeddable', async t => {
  const f = await fixture(t);
  const root = path.join(f.directory, 'reports');
  for (const date of ['2026-10-09_09-00-00-001', '2026-10-09_10-00-00-001']) {
    const dir = path.join(root, 'shop', date, 'html');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), '<html><body>Saved report</body></html>');
    fs.writeFileSync(path.join(dir, '../results.json'), JSON.stringify({ stats: { expected: 1 } }));
    fs.writeFileSync(
      path.join(dir, '../run-metadata.json'),
      JSON.stringify({ phase: 'finished', site: { name: 'Example Shop' }, mode: 'smoke' }),
    );
  }
  const legacy = path.join(root, '2026-10-08_10-00');
  fs.mkdirSync(legacy);
  fs.writeFileSync(path.join(legacy, 'index.html'), '<html>Legacy</html>');
  fs.writeFileSync(path.join(legacy, 'results.json'), 'null');
  fs.symlinkSync(f.directory, path.join(root, 'outside'));
  const { groups } = await (await fetch(f.origin + '/api/reports')).json();
  assert.equal(groups.length, 2);
  const shop = groups.find(group => group.id === 'site:shop');
  assert.equal(shop.name, 'Example Shop');
  assert.equal(shop.runs[0].id, '2026-10-09_10-00-00-001');
  assert.equal(shop.runs[0].mode, 'smoke');
  const report = await fetch(f.origin + shop.runs[0].reportUrl + '?embedded=1');
  assert.equal(report.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(await report.text(), /Saved report/);
  assert.equal((await fetch(f.origin)).headers.get('x-frame-options'), 'DENY');
  const direct = groups.find(group => group.id === 'legacy-direct');
  assert.equal(direct.runs[0].status, 'incomplete');
  assert.match(direct.runs[0].reportUrl, /index.html$/);
});
