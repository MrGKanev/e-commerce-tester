'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const visual = require('./visual-baselines');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-check-'));
const root = path.join(directory, 'baselines');
const reportsDir = path.join(__dirname, '..', 'reports');
const site = 'local-visual-' + process.pid;
const projects =
  process.env.VISUAL_CHECK_ALL_BROWSERS === '1'
    ? []
    : ['--project=Desktop Chrome', '--project=Mobile Chrome'];
let revision = null;
function run(
  index,
  changed = false,
  extra = [],
  environment = process.env.VISUAL_ENVIRONMENT || 'native',
) {
  const run = `2026-10-10_10-00-00-00${index}`;
  const result = spawnSync(
    'pnpm',
    ['exec', 'playwright', 'test', '--config=checks/visual.config.ts', ...projects, ...extra],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        SITE_SLUG: site,
        TEST_RUN_DATE: run,
        VISUAL_BASELINES_DIR: root,
        VISUAL_TEST_CHANGED: changed ? '1' : '',
        VISUAL_ENVIRONMENT: environment,
        SITE_SETTINGS_JSON: JSON.stringify({
          thresholds: { visual: { components: { header: 0 } } },
        }),
      },
    },
  );
  const runDir = path.join(reportsDir, site, run);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-metadata.json'), JSON.stringify({ phase: 'finished' }));
  return { run, status: result.status, review: visual.review(reportsDir, root, site, run) };
}
try {
  const first = run(1);
  assert.equal(first.status, 1, 'Missing approval must fail');
  assert.equal(first.review.entries.length, projects.length ? 4 : 10);
  assert.ok(first.review.entries.every(entry => entry.status === 'missing'));
  revision = visual.approve({
    root,
    reportsDir,
    site,
    run: first.run,
    revision,
    ids: first.review.entries.map(entry => entry.id),
  }).revision;
  const match = run(2);
  assert.equal(match.status, 0, 'Approved appearance must pass');
  assert.ok(match.review.entries.every(entry => entry.status === 'matched'));
  assert.ok(
    match.review.entries
      .filter(entry => entry.name === 'header.png')
      .every(entry => entry.maxDiffPixelRatio === 0),
  );
  const changed = run(3, true);
  assert.equal(changed.status, 1, 'Unapproved layout must fail');
  assert.ok(changed.review.entries.some(entry => entry.status === 'changed' && entry.hasDiff));
  assert.equal(visual.approved(root, site).revision, revision, 'Runs must not replace approval');
  const blocked = run(4, true, ['--update-snapshots']);
  assert.equal(blocked.status, 1, 'Automatic snapshot updates must be rejected');
  assert.equal(visual.approved(root, site).revision, revision);
  const next = visual.approve({
    root,
    reportsDir,
    site,
    run: changed.run,
    revision,
    ids: changed.review.entries.filter(entry => entry.status === 'changed').map(entry => entry.id),
  });
  assert.notEqual(next.revision, revision);
  assert.equal(run(5, true).status, 0, 'Explicitly approved change becomes the reference');
  const incompatible = run(6, true, [], 'different-environment');
  assert.equal(incompatible.status, 1, 'Different rendering environments must fail explicitly');
  assert.ok(incompatible.review.entries.every(entry => entry.status === 'incompatible'));
  assert.equal(visual.approved(root, site).revision, next.revision);
  console.log(
    'Visual approval acceptance passed: missing, matched, changed, diff, explicit approval, immutable versions and viewport/component settings.',
  );
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.rmSync(path.join(reportsDir, site), { recursive: true, force: true });
}
