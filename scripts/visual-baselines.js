'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const ROOT = path.join(__dirname, '..');
const RUN = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}(?:-\d{2}-\d{3})?$/;
const ID = /^[a-f0-9]{32}$/;
const REVISION = /^[a-f0-9-]{36}$/;
const digest = value => createHash('sha256').update(value).digest('hex');
function siteName(site) {
  if (typeof site !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(site))
    throw new Error('Invalid visual baseline store');
  return site;
}
function baselineRoot() {
  return process.env.VISUAL_BASELINES_DIR || path.join(ROOT, 'visual-baselines');
}
// Worker processes inherit this pin even if approval changes between tests.
function pin(root, site, run) {
  const previous = process.env.VISUAL_BASELINE_PIN
    ? JSON.parse(process.env.VISUAL_BASELINE_PIN)
    : null;
  if (previous?.site === site && previous?.run === run && previous.root === path.resolve(root))
    return { site, run, revision: previous.revision };
  const pinned = { site, run, revision: approved(root, site).revision };
  process.env.VISUAL_BASELINE_PIN = JSON.stringify({ ...pinned, root: path.resolve(root) });
  return pinned;
}
function confined(root, file) {
  const base = fs.realpathSync(root);
  const target = fs.realpathSync(file);
  if (!target.startsWith(base + path.sep) || !fs.statSync(target).isFile())
    throw new Error('Visual artifact is outside its directory');
  return target;
}
function atomic(file, data) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2));
  fs.renameSync(temporary, file);
}
function approved(root, site, revision) {
  const directory = path.join(root, siteName(site));
  if (revision === undefined) {
    const pointer = path.join(directory, 'approved.json');
    revision = fs.existsSync(pointer)
      ? JSON.parse(fs.readFileSync(confined(root, pointer), 'utf8')).revision
      : null;
  }
  if (revision === null) return { revision: null, entries: {} };
  if (!REVISION.test(revision)) throw new Error('Invalid visual baseline revision');
  const file = path.join(directory, 'versions', revision, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(confined(root, file), 'utf8'));
  if (manifest.site !== site || manifest.revision !== revision || !manifest.entries)
    throw new Error('Invalid approved visual manifest');
  return manifest;
}
function image(root, file, expectedHash) {
  const data = fs.readFileSync(confined(root, file));
  if (data.length < 24 || !data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
    throw new Error('Visual candidate must be a PNG image');
  if (expectedHash && digest(data) !== expectedHash)
    throw new Error('Visual artifact changed after capture; run the check again');
  return data;
}
function baselineImage(root, site, manifest, id) {
  if (!ID.test(id) || !manifest.entries[id]) throw new Error('Unknown approved screenshot');
  return image(
    root,
    path.join(root, siteName(site), 'versions', manifest.revision, id + '.png'),
    manifest.entries[id].sha256,
  );
}
function candidates(reportsDir, site, run) {
  siteName(site);
  if (typeof run !== 'string' || !RUN.test(run)) throw new Error('Invalid visual run');
  const directory = path.join(reportsDir, site, run);
  const entriesDir = path.join(directory, 'visual', 'entries');
  let complete = false;
  const metadata = path.join(directory, 'run-metadata.json');
  if (fs.existsSync(metadata))
    complete =
      JSON.parse(fs.readFileSync(confined(reportsDir, metadata), 'utf8')).phase === 'finished';
  if (!fs.existsSync(entriesDir)) return { complete, entries: [] };
  const entries = fs
    .readdirSync(entriesDir)
    .filter(file => /^[a-f0-9]{32}\.json$/.test(file))
    .sort()
    .map(file => {
      const entry = JSON.parse(
        fs.readFileSync(confined(reportsDir, path.join(entriesDir, file)), 'utf8'),
      );
      if (entry.id + '.json' !== file || entry.site !== site || entry.run !== run)
        throw new Error('Invalid visual candidate manifest');
      return entry;
    });
  return { complete, entries };
}
function review(reportsDir, root, site, run) {
  const baseline = approved(root, site);
  const data = candidates(reportsDir, site, run);
  const url = file => '/reports/' + [site, run, 'visual', file].map(encodeURIComponent).join('/');
  return {
    site,
    run,
    revision: baseline.revision,
    complete: data.complete,
    approvedAt: baseline.approvedAt || null,
    entries: data.entries.map(entry => ({
      ...entry,
      currentUrl: url(entry.id + '-current.png'),
      baselineUrl: entry.hasBaseline ? url(entry.id + '-baseline.png') : null,
      diffUrl: entry.hasDiff ? url(entry.id + '-diff.png') : null,
      approvedUrl: baseline.entries[entry.id]
        ? `/api/visual/image?site=${encodeURIComponent(site)}&revision=${baseline.revision}&id=${entry.id}`
        : null,
      currentlyApproved:
        baseline.entries[entry.id]?.sha256 === entry.sha256 &&
        JSON.stringify(baseline.entries[entry.id]?.environment) ===
          JSON.stringify(entry.environment),
    })),
  };
}
function approve({ reportsDir, root, site, run, revision, ids }) {
  siteName(site);
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    new Set(ids).size !== ids.length ||
    ids.some(id => !ID.test(id))
  )
    throw new Error('Select screenshots to approve');
  fs.mkdirSync(root, { recursive: true });
  const directory = path.join(root, site);
  fs.mkdirSync(directory, { recursive: true });
  if (!fs.realpathSync(directory).startsWith(fs.realpathSync(root) + path.sep))
    throw new Error('Invalid baseline store directory');
  const lock = path.join(directory, '.approval-lock');
  try {
    fs.mkdirSync(lock);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw Object.assign(new Error('Another approval is in progress; refresh and try again'), {
      status: 409,
      cause: error,
    });
  }
  let versionDir;
  try {
    const previous = approved(root, site);
    if (revision !== previous.revision)
      throw Object.assign(new Error('The approved version changed. Refresh before approving.'), {
        status: 409,
      });
    const data = candidates(reportsDir, site, run);
    if (!data.complete) throw new Error('Wait for the run to finish before approving');
    const selected = ids.map(id => {
      const entry = data.entries.find(candidate => candidate.id === id);
      if (
        !entry ||
        !['matched', 'changed', 'missing', 'incompatible'].includes(entry.status) ||
        !entry.environment
      )
        throw new Error('Screenshot is not available for approval');
      const bytes = image(
        reportsDir,
        path.join(reportsDir, site, run, 'visual', id + '-current.png'),
        entry.sha256,
      );
      return { entry, bytes };
    });
    const next = randomUUID();
    const versions = path.join(directory, 'versions');
    fs.mkdirSync(versions, { recursive: true });
    if (!fs.realpathSync(versions).startsWith(fs.realpathSync(directory) + path.sep))
      throw new Error('Invalid baseline versions directory');
    versionDir = path.join(versions, next);
    fs.mkdirSync(versionDir);
    const entries = { ...previous.entries };
    for (const id of Object.keys(entries))
      fs.writeFileSync(path.join(versionDir, id + '.png'), baselineImage(root, site, previous, id));
    for (const { entry, bytes } of selected) {
      fs.writeFileSync(path.join(versionDir, entry.id + '.png'), bytes);
      entries[entry.id] = { ...entry, sourceRun: run };
    }
    const manifest = {
      schemaVersion: 1,
      site,
      revision: next,
      previousRevision: previous.revision,
      approvedAt: new Date().toISOString(),
      sourceRun: run,
      approvedIds: ids,
      entries,
    };
    atomic(path.join(versionDir, 'manifest.json'), manifest);
    atomic(path.join(directory, 'approved.json'), { revision: next });
    return { revision: next, approvedAt: manifest.approvedAt, approvedCount: ids.length };
  } catch (error) {
    if (versionDir) fs.rmSync(versionDir, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmdirSync(lock);
  }
}
module.exports = {
  pin,
  baselineRoot,
  approved,
  baselineImage,
  candidates,
  review,
  approve,
  digest,
  atomic,
  siteName,
};
