#!/usr/bin/env node
'use strict';

// Offline preview only: every datum here is synthetic and marked DEMO.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-dashboard-preview-'));
fs.mkdirSync(path.join(root, 'scripts'));
for (const file of ['update-history.js', 'report-model.js']) fs.copyFileSync(path.join(__dirname, file), path.join(root, 'scripts', file));
fs.writeFileSync(path.join(root, 'sites.json'), JSON.stringify([{ name: 'DEMO — примерни резултати', slug: 'demo', url: '' }]));

function scenario(title, status, annotations = [], results) {
  return { title, id: title, file: 'demo.spec.ts', line: 1, tags: ['@demo'], tests: [{
    projectName: 'Demo Chrome', status, annotations,
    results: results || [{ status: status === 'expected' ? 'passed' : status === 'skipped' ? 'skipped' : 'failed', workerIndex: 0, retry: 0, errors: [] }],
  }] };
}
const successful = () => [scenario('Homepage content', 'expected'), scenario('Add to cart', 'expected')];
const notApplicable = () => scenario('Optional wishlist', 'skipped', [{ type: 'skip', description: 'DEMO: store has no wishlist' }, { type: 'not-applicable', description: 'Feature not configured' }]);
const samples = [
  { date: '2026-10-01_10-00', specs: [...successful(), scenario('Checkout redirect', 'unexpected', [], [{ status: 'failed', workerIndex: 0, retry: 0, errors: [{ message: 'DEMO: checkout redirect was not observed' }] }])] },
  { date: '2026-10-02_10-00', specs: [...successful(), scenario('Price update', 'flaky', [], [{ status: 'failed', workerIndex: 0, retry: 0, errors: [{ message: 'DEMO: first attempt timed out while updating price' }] }, { status: 'passed', workerIndex: 1, retry: 1, errors: [] }])] },
  { date: '2026-10-03_10-00', specs: [...successful(), scenario('Keyboard journey', 'skipped', [{ type: 'fixme', description: 'DEMO: applicable check awaiting a fix' }])] },
  { date: '2026-10-04_10-00', specs: [], status: 'passed' },
  { date: '2026-10-05_10-00', specs: [...successful(), scenario('Product details', 'unexpected', [], [{ status: 'interrupted', workerIndex: 0, retry: 0, errors: [] }])], status: 'interrupted' },
  { date: '2026-10-06_10-00', specs: successful(), errors: [{ message: 'DEMO: global teardown could not complete' }] },
  { date: '2026-10-07_10-00', specs: [...successful(), notApplicable()], status: 'passed' },
];
for (const sample of samples) {
  const dir = path.join(root, 'reports/demo', sample.date);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ stats: { duration: 90000 }, errors: sample.errors || [], suites: [{ title: 'DEMO shopping journey', specs: sample.specs }] }));
  fs.writeFileSync(path.join(dir, 'run-metadata.json'), JSON.stringify({
    phase: 'finished', status: sample.status || 'passed', versions: { project: 'demo', playwright: 'demo', node: 'demo' },
    projects: [{ name: 'Demo Chrome', browser: 'chromium', locale: 'bg-BG', timezone: 'Europe/Sofia', retries: 1, repeatEach: 1 }],
    browserVersions: { 'Demo Chrome': 'demo version' }, selection: { tags: ['@demo'], grep: '/@demo/' },
  }));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html lang="bg"><meta charset="utf-8"><h1>Демонстрационен отчет</h1><p>Това са примерни данни. Не са изпълнявани заявки към магазин.</p></html>');
}
const result = spawnSync(process.execPath, [path.join(root, 'scripts/update-history.js')], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
const file = path.join(root, 'reports/dashboard.html');
fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/Store Health Dashboard/g, 'DEMO — Store Health Dashboard'));
console.log(`Offline demo: ${file}`);
if (!process.argv.includes('--no-open')) spawnSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [file], { stdio: 'inherit' });
