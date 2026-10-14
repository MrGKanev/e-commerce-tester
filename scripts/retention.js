'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { listIssues } = require('./issues');
const RUN = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}(?:-\d{2}-\d{3})?$/;
function size(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((total, file) => {
    if (file.isSymbolicLink()) throw new Error('Retention refuses symbolic links');
    const target = path.join(directory, file.name);
    return total + (file.isDirectory() ? size(target) : fs.statSync(target).size);
  }, 0);
}
function pruneReports(reportsDir, sites, now = Date.now()) {
  const issues = listIssues(reportsDir);
  const deleted = [];
  for (const site of sites) {
    const dir = path.join(reportsDir, site.slug);
    if (!fs.existsSync(dir)) continue;
    if (fs.lstatSync(dir).isSymbolicLink()) throw new Error('Invalid report path');
    const policy = site.settings?.retention || { maxRuns: 30, maxDays: 0, maxBytes: 0 };
    const protectedRuns = new Set(
      issues.filter(i => i.site === site.slug).flatMap(i => [i.firstRun, i.lastRun]),
    );
    const runs = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && RUN.test(e.name))
      .map(e => {
        const file = path.join(dir, e.name),
          metadata = path.join(file, 'run-metadata.json');
        const data = fs.existsSync(metadata) ? JSON.parse(fs.readFileSync(metadata, 'utf8')) : {};
        return {
          name: e.name,
          file,
          bytes: size(file),
          time: Date.parse(data.startedAt) || fs.statSync(file).mtimeMs,
          protected:
            protectedRuns.has(e.name) ||
            fs.existsSync(path.join(file, '.pinned')) ||
            (data.phase
              ? data.phase !== 'finished'
              : !fs.existsSync(path.join(file, 'results.json'))),
        };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
    let total = runs.reduce((sum, r) => sum + r.bytes, 0),
      count = runs.length;
    for (const run of [...runs].reverse()) {
      if (run === runs[0] || run.protected) continue;
      if (
        count <= policy.maxRuns &&
        (!policy.maxDays || now - run.time <= policy.maxDays * 86400000) &&
        (!policy.maxBytes || total <= policy.maxBytes)
      )
        continue;
      fs.rmSync(run.file, { recursive: true });
      count--;
      total -= run.bytes;
      deleted.push(site.slug + '/' + run.name);
    }
  }
  return deleted;
}
function pinReport(reportsDir, site, run, pinned) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(site) || !RUN.test(run) || typeof pinned !== 'boolean')
    throw new Error('Invalid report selection');
  const root = fs.realpathSync(reportsDir),
    dir = path.join(root, site, run);
  if (fs.realpathSync(dir) !== dir || !fs.statSync(dir).isDirectory())
    throw new Error('Invalid report path');
  const file = path.join(dir, '.pinned');
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())
    throw new Error('Invalid pin file');
  if (pinned) fs.writeFileSync(file, '', { flag: 'w' });
  else fs.rmSync(file, { force: true });
  return { pinned };
}
module.exports = { pruneReports, pinReport };
