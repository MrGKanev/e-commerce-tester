'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'config'));
  fs.copyFileSync(path.join(__dirname, '../config/site-settings.js'), path.join(root, 'config/site-settings.js'));
  fs.mkdirSync(path.join(root, 'reports'));
  for (const name of ['run-sites.js', 'update-history.js', 'report-model.js']) {
    fs.copyFileSync(path.join(__dirname, name), path.join(root, 'scripts', name));
  }
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  // Stub the browser runner: regression checks must never contact a real store.
  fs.writeFileSync(path.join(bin, 'pnpm'), `#!/usr/bin/env node
require('fs').appendFileSync('invocations.jsonl', JSON.stringify({args: process.argv.slice(2), url: process.env.STORE_URL, handle: process.env.PRODUCT_HANDLE, slug: process.env.SITE_SLUG, run: process.env.TEST_RUN_DATE}) + '\\n');
process.exit(Number(process.env.STUB_EXIT || 0));
`, { mode: 0o755 });
  return { root, env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` } };
}

function run(f, script = 'run-sites.js', args = []) {
  return spawnSync(process.execPath, [path.join(f.root, 'scripts', script), ...args], {
    cwd: f.root, env: f.env, encoding: 'utf8',
  });
}

function sites(f, data) {
  fs.writeFileSync(path.join(f.root, 'sites.json'), JSON.stringify(data));
}

function report(f, slug, date, stats, errors = []) {
  const dir = path.join(f.root, 'reports', slug, date);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ stats, errors }));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');
}

test('loads .env, preserves environment overrides, forwards arguments and creates precise run IDs', t => {
  const f = fixture(t);
  for (const key of ['STORE_URL', 'PRODUCT_HANDLE', 'PRODUCT_HANDLE_2', 'SEARCH_TERM']) delete f.env[key];
  fs.writeFileSync(path.join(f.root, '.env'), 'STORE_URL=https://example.test\nPRODUCT_HANDLE=from-file\n');
  f.env.PRODUCT_HANDLE = 'explicit';
  const result = run(f, 'run-sites.js', ['--project=Desktop Chrome']);
  assert.equal(result.status, 0, result.stderr);
  const call = JSON.parse(fs.readFileSync(path.join(f.root, 'invocations.jsonl'), 'utf8'));
  assert.equal(call.url, 'https://example.test');
  assert.equal(call.handle, 'explicit');
  assert.match(call.run, /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}$/);
  assert.ok(call.args.includes('--project=Desktop Chrome'));
});

test('rejects invalid URLs, traversal slugs and duplicate slugs before launching browsers', t => {
  const f = fixture(t);
  for (const data of [
    [{ url: 'file:///etc/passwd' }],
    [{ url: 'https://example.test', slug: '../escape' }],
    [{ url: 'https://example.test', slug: 'same' }, { url: 'https://other.test', slug: 'same' }],
    [{ url: 'https://example.test', productHandle: 42 }],
    [null],
  ]) {
    sites(f, data);
    assert.equal(run(f).status, 1);
    assert.equal(fs.existsSync(path.join(f.root, 'invocations.jsonl')), false);
  }
});

test('propagates failures while continuing other stores', t => {
  const f = fixture(t);
  sites(f, [{ url: 'https://a.test' }, { url: 'https://b.test' }]);
  f.env.STUB_EXIT = '1';
  assert.equal(run(f).status, 1);
  const calls = fs.readFileSync(path.join(f.root, 'invocations.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(c => c.handle.length > 0));
});

test('prunes before generating dashboard and reads both legacy and precise timestamps', t => {
  const f = fixture(t);
  sites(f, [{ url: 'https://example.test', slug: 'store' }]);
  for (let i = 1; i <= 31; i++) report(f, 'store', `2026-01-${String(i).padStart(2, '0')}_10-00`, { expected: 1 });
  report(f, 'store', '2026-02-01_10-00-01-001', { expected: 1 });
  assert.equal(run(f).status, 0);
  const html = fs.readFileSync(path.join(f.root, 'reports/dashboard.html'), 'utf8');
  assert.equal(fs.existsSync(path.join(f.root, 'reports/store/2026-01-01_10-00')), false);
  assert.ok(!html.includes('./store/2026-01-01_10-00/index.html'));
  assert.ok(html.includes('./store/2026-02-01_10-00-01-001/index.html'));
});

test('empty, setup-error and flaky reports cannot appear green', t => {
  const f = fixture(t);
  for (const [slug, stats, errors] of [
    ['empty', {}, []],
    ['setup', { expected: 2 }, [{ message: 'Setup failed' }]],
    ['flaky', { expected: 2, flaky: 1 }, []],
  ]) {
    report(f, slug, '2026-01-01_10-00', stats, errors);
  }
  const result = run(f, 'update-history.js');
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(path.join(f.root, 'reports/dashboard.html'), 'utf8');
  assert.ok(!html.includes('>Passed</span>'));
  assert.ok(html.includes('Errors: 1'));
  assert.ok(html.includes('Flaky: 1'));
});


test('links to the separated HTML report while preserving legacy report links', t => {
  const f = fixture(t);
  report(f, 'store', '2026-01-01_10-00', { expected: 1 });
  report(f, 'store', '2026-01-02_10-00-01-001', { expected: 1 });
  const htmlDir = path.join(f.root, 'reports/store/2026-01-02_10-00-01-001/html');
  fs.mkdirSync(htmlDir);
  fs.writeFileSync(path.join(htmlDir, 'index.html'), '<html></html>');
  assert.equal(run(f, 'update-history.js').status, 0);
  const html = fs.readFileSync(path.join(f.root, 'reports/dashboard.html'), 'utf8');
  assert.ok(html.includes('./store/2026-01-01_10-00/index.html'));
  assert.ok(html.includes('./store/2026-01-02_10-00-01-001/html/index.html'));
  assert.ok(html.includes('>Passed</span>'));
});


test('runner saves metadata before launch and records interruption without final results', t => {
  const f = fixture(t);
  sites(f, [{ url: 'https://example.test', slug: 'store' }]);
  f.env.STUB_EXIT = '130';
  assert.equal(run(f, 'run-sites.js', ['--grep', '@smoke', '--project=Desktop Chrome']).status, 1);
  const call = JSON.parse(fs.readFileSync(path.join(f.root, 'invocations.jsonl'), 'utf8'));
  const file = path.join(f.root, 'reports/store', call.run, 'run-metadata.json');
  const metadata = JSON.parse(fs.readFileSync(file));
  assert.equal(metadata.status, 'interrupted');
  assert.equal(metadata.site.slug, 'store');
  assert.ok(metadata.selection.args.includes('@smoke'));
  const html = fs.readFileSync(path.join(f.root, 'reports/dashboard.html'), 'utf8');
  assert.ok(html.includes('>Interrupted</span>'));
  assert.ok(html.includes('No HTML report'));
  assert.ok(html.includes('Metadata JSON'));
});

test('unfinished, corrupt and legacy direct runs remain visible', t => {
  const f = fixture(t);
  const interrupted = path.join(f.root, 'reports/store/2026-01-01_10-00');
  fs.mkdirSync(interrupted, { recursive: true });
  fs.writeFileSync(path.join(interrupted, 'run-metadata.json'), JSON.stringify({ phase: 'running' }));
  const corrupt = path.join(f.root, 'reports/store/2026-01-02_10-00');
  fs.mkdirSync(corrupt, { recursive: true });
  fs.writeFileSync(path.join(corrupt, 'results.json'), '{');
  const legacy = path.join(f.root, 'reports/2026-01-03_10-00');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'results.json'), JSON.stringify({ stats: { expected: 1 } }));
  assert.equal(run(f, 'update-history.js').status, 0);
  const html = fs.readFileSync(path.join(f.root, 'reports/dashboard.html'), 'utf8');
  assert.ok(html.includes('>Incomplete</span>'));
  assert.ok(html.includes('Unreadable results.json'));
  assert.ok(html.includes('Direct runs (legacy)'));
  assert.ok(html.includes('Versions not recorded'));
});


test('dashboard escapes scenario reasons, global errors and metadata', t => {
  const f = fixture(t);
  const dir = path.join(f.root, 'reports/store/2026-01-01_10-00');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({
    errors: [{ message: '<script>global</script>' }],
    suites: [{ title: 'Cart', specs: [{ title: 'Scenario <script>title</script>', file: 'cart.ts', tests: [{
      projectName: 'Chrome', status: 'skipped', annotations: [{ type: 'skip', description: '<img onerror="bad">' }],
      results: [{ status: 'skipped', workerIndex: 0 }],
    }] }] }],
  }));
  fs.writeFileSync(path.join(dir, 'run-metadata.json'), JSON.stringify({ phase: 'finished', versions: { node: '<script>version</script>' } }));
  assert.equal(run(f, 'update-history.js').status, 0);
  const html = fs.readFileSync(path.join(f.root, 'reports/dashboard.html'), 'utf8');
  assert.ok(html.includes('&lt;script&gt;global&lt;/script&gt;'));
  assert.ok(html.includes('&lt;img onerror=&quot;bad&quot;&gt;'));
  assert.ok(html.includes('&lt;script&gt;version&lt;/script&gt;'));
  assert.ok(!html.includes('<script>global'));
});
