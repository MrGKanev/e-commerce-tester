'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { summarizeRun } = require('./report-model');
const count = value => (Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);
const RUN = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}(?:-\d{2}-\d{3})?$/;
function catalog(reportsDir, sites = []) {
  if (!fs.existsSync(reportsDir)) return [];
  const root = fs.realpathSync(reportsDir);
  const names = new Map(sites.map(site => [site.slug, site.name || site.slug]));
  const safe = file => {
    try {
      return fs.realpathSync(file).startsWith(root + path.sep) && fs.statSync(file).isFile();
    } catch {
      return false;
    }
  };
  function read(file) {
    if (!safe(file))
      return { data: {}, issue: fs.existsSync(file) ? 'Report file unavailable' : null };
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new Error('Invalid report');
      return { data, issue: null };
    } catch {
      return { data: {}, issue: 'Unreadable report JSON' };
    }
  }
  function runs(directory, prefix) {
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && RUN.test(entry.name))
      .sort((a, b) => b.name.localeCompare(a.name))
      .map(entry => {
        const dir = path.join(directory, entry.name);
        const metadata = read(path.join(dir, 'run-metadata.json'));
        const results = read(path.join(dir, 'results.json'));
        const reportPath = ['html/index.html', 'index.html'].find(relative =>
          safe(path.join(dir, relative)),
        );
        const issue =
          results.issue ||
          metadata.issue ||
          (!safe(path.join(dir, 'results.json')) ? 'No final results' : null);
        const summary = summarizeRun(results.data, metadata.data, issue);
        return {
          id: entry.name,
          storeName:
            typeof metadata.data.site?.name === 'string' ? metadata.data.site.name : undefined,
          mode: typeof metadata.data.mode === 'string' ? metadata.data.mode : '',
          status: summary.status,
          passed: count(summary.passed),
          failed: count(summary.failed),
          skipped: count(summary.skipped),
          reportUrl: reportPath
            ? '/reports/' +
              [...prefix, entry.name, ...reportPath.split('/')].map(encodeURIComponent).join('/')
            : null,
        };
      });
  }
  const groups = fs
    .readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !RUN.test(entry.name))
    .map(entry => {
      const entries = runs(path.join(root, entry.name), [entry.name]);
      return {
        id: 'site:' + entry.name,
        name: names.get(entry.name) || entries.find(run => run.storeName)?.storeName || entry.name,
        runs: entries,
      };
    })
    .filter(group => group.runs.length);
  const direct = runs(root, []);
  if (direct.length) groups.push({ id: 'legacy-direct', name: 'Direct runs', runs: direct });
  return groups.sort((a, b) => a.name.localeCompare(b.name));
}
module.exports = { catalog };
