#!/usr/bin/env node
'use strict';

// Offline preview only: sample results never enter the real reports directory.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-dashboard-preview-'));
fs.mkdirSync(path.join(root, 'scripts'));
fs.copyFileSync(path.join(__dirname, 'update-history.js'), path.join(root, 'scripts/update-history.js'));
fs.writeFileSync(path.join(root, 'sites.json'), JSON.stringify([
  { name: 'DEMO — примерни резултати', slug: 'demo', url: '' },
]));
for (const [date, stats] of [
  ['2026-10-01_10-00', { expected: 15, unexpected: 0, skipped: 2, flaky: 0, duration: 90000 }],
  ['2026-10-02_10-00', { expected: 13, unexpected: 2, skipped: 2, flaky: 0, duration: 120000 }],
  ['2026-10-03_10-00', { expected: 16, unexpected: 0, skipped: 1, flaky: 0, duration: 100000 }],
]) {
  const dir = path.join(root, 'reports/demo', date);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ stats, suites: [] }));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html lang="bg"><meta charset="utf-8"><h1>Демонстрационен отчет</h1><p>Това са примерни данни за преглед на интерфейса. Не са изпълнявани заявки към магазин.</p></html>');
}
const result = spawnSync(process.execPath, [path.join(root, 'scripts/update-history.js')], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
const file = path.join(root, 'reports/dashboard.html');
fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/Store Health Dashboard/g, 'DEMO — Store Health Dashboard'));
console.log(`Offline demo: ${file}`);
const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
spawnSync(opener, [file], { stdio: 'inherit' });
