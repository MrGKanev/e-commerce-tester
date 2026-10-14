'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const hash = /^[a-f0-9]{64}$/;
function issueId(scope, key) {
  return createHash('sha256')
    .update(scope + key)
    .digest('hex');
}
function read(file, fallback = {}) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
}
function directory(root, site) {
  if (!slug.test(site)) throw new Error('Invalid store ID');
  const dir = path.join(root, site, '.monitoring');
  for (const file of [path.join(root, site), dir])
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())
      throw new Error('Invalid monitoring path');
  return dir;
}
function annotations(root, site) {
  return read(path.join(directory(root, site), 'annotations.json'));
}
function listIssues(root) {
  if (!fs.existsSync(root)) return [];
  const issues = [];
  for (const site of fs
    .readdirSync(root, { withFileTypes: true })
    .filter(e => e.isDirectory() && slug.test(e.name))) {
    const dir = directory(root, site.name);
    if (!fs.existsSync(dir)) continue;
    const notes = annotations(root, site.name);
    for (const file of fs.readdirSync(dir).filter(f => /^[a-f0-9]{64}\.json$/.test(f))) {
      const scope = file.slice(0, -5),
        state = read(path.join(dir, file));
      for (const [key, issue] of Object.entries(state.incidents || {})) {
        const id = issueId(scope, key);
        issues.push({
          site: site.name,
          scope,
          id,
          ...issue,
          severity: 'review',
          owner: '',
          note: '',
          mutedUntil: '',
          ...notes[id],
        });
      }
      if (state.runnerIncident)
        issues.push({
          site: site.name,
          scope,
          id: issueId(scope, 'runner'),
          name: 'Run could not complete',
          category: 'infrastructure',
          severity: 'high',
          ...state.runnerEvidence,
          ...notes[issueId(scope, 'runner')],
        });
    }
  }
  return issues.sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''));
}
function updateIssue(root, input) {
  if (
    !hash.test(input.id) ||
    !listIssues(root).some(i => i.site === input.site && i.id === input.id)
  )
    throw new Error('Open problem no longer exists; refresh the list');
  if (!['critical', 'high', 'review', 'low'].includes(input.severity))
    throw new Error('Invalid severity');
  for (const key of ['owner', 'note', 'mutedUntil'])
    if (typeof input[key] !== 'string' || input[key].length > (key === 'note' ? 4000 : 200))
      throw new Error('Invalid issue annotation');
  if (input.mutedUntil && !Number.isFinite(Date.parse(input.mutedUntil)))
    throw new Error('Invalid mute expiry');
  const file = path.join(directory(root, input.site), 'annotations.json');
  const notes = annotations(root, input.site);
  const previous = notes[input.id] || {};
  if ((input.revision || 0) !== (previous.revision || 0)) {
    const error = new Error('Problem edited in another tab; refresh first');
    error.status = 409;
    throw error;
  }
  notes[input.id] = {
    severity: input.severity,
    owner: input.owner,
    note: input.note,
    mutedUntil: input.mutedUntil,
    revision: (previous.revision || 0) + 1,
  };
  require('./scheduler').atomicWrite(file, notes);
  return notes[input.id];
}
module.exports = { listIssues, updateIssue, annotations, issueId };
