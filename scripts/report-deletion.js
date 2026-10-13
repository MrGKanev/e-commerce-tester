'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { catalog } = require('./report-catalog');
const { readQueue } = require('./run-queue');
const { loadState } = require('./scheduler');
function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  throw error;
}
function deleteReports({ reportsDir, stateDir, group: groupId, runs: ids }) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 1000 ||
    ids.some(id => typeof id !== 'string') ||
    new Set(ids).size !== ids.length
  )
    throw new Error('Select reports to delete');
  const group = catalog(reportsDir).find(group => group.id === groupId);
  if (!group || ids.some(id => !group.runs.some(run => run.id === id)))
    conflict('Reports changed. Refresh the list before deleting.');
  const site = group.id.startsWith('site:') ? group.id.slice(5) : null;
  const active = readQueue(stateDir).active;
  const scheduled = loadState(path.join(stateDir, 'schedule.json')).running;
  if (
    (active && (!site || active.site === site)) ||
    (scheduled && (!site || scheduled.key.startsWith(site + '/')))
  )
    conflict('Wait for this store’s active run to finish before deleting reports.');
  const root = fs.realpathSync(reportsDir);
  const directory = site ? path.join(root, site) : root;
  if (
    site &&
    (path.basename(site) !== site ||
      fs.lstatSync(directory).isSymbolicLink() ||
      fs.realpathSync(directory) !== directory)
  )
    throw new Error('Invalid report directory');
  const files = ids.map(id => {
    const file = path.join(directory, id);
    if (
      !/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}(?:-\d{2}-\d{3})?$/.test(id) ||
      fs.lstatSync(file).isSymbolicLink() ||
      !fs.lstatSync(file).isDirectory() ||
      !fs.realpathSync(file).startsWith(root + path.sep)
    )
      throw new Error('Invalid report path');
    return file;
  });
  const trashRoot = path.join(root, '.trash');
  if (
    fs.existsSync(trashRoot) &&
    (fs.lstatSync(trashRoot).isSymbolicLink() || !fs.lstatSync(trashRoot).isDirectory())
  )
    throw new Error('Invalid report trash directory');
  const batch = randomUUID();
  const destination = path.join(trashRoot, batch);
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(
    path.join(destination, 'manifest.json'),
    JSON.stringify({ group: groupId, runs: ids, deletedAt: new Date().toISOString() }, null, 2),
  );
  const moved = [];
  try {
    for (const file of files) {
      const target = path.join(destination, path.basename(file));
      fs.renameSync(file, target);
      moved.push({ file, target });
    }
    execFileSync(process.execPath, [path.join(__dirname, 'update-history.js')], {
      env: { ...process.env, REPORTS_DIR: root },
      stdio: 'pipe',
      timeout: 30000,
    });
  } catch (error) {
    for (const { file, target } of moved.reverse()) fs.renameSync(target, file);
    fs.rmSync(destination, { recursive: true, force: true });
    throw new Error('Could not delete reports; files were restored.', { cause: error });
  }
  // Clear obsolete generated overview so it cannot show removed runs.
  fs.rmSync(path.join(root, 'history.html'), { force: true });
  return { deleted: ids.length, trashBatch: batch };
}
module.exports = { deleteReports };
