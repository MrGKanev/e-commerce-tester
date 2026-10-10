'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { approved, approve, review, baselineImage, digest, pin } = require('./visual-baselines');
const { resolveSiteSettings } = require('../config/site-settings');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);
test('component budgets inherit the store default and reject invalid ratios or names', () => {
  const settings = resolveSiteSettings({
    thresholds: { visual: { components: { header: 0.005 } } },
  });
  assert.equal(settings.thresholds.visual.maxDiffPixelRatio, 0.03);
  assert.equal(settings.thresholds.visual.components.header, 0.005);
  for (const components of [{ header: -1 }, { header: 2 }, { '../header': 0.1 }, null])
    assert.throws(() => resolveSiteSettings({ thresholds: { visual: { components } } }));
});
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'approved-visual-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'baselines');
  const reportsDir = path.join(directory, 'reports');
  const run = '2026-10-10_10-00-00-001';
  function candidate(
    site = 'one',
    id = 'a'.repeat(32),
    bytes = png,
    environment = { platform: 'test' },
  ) {
    const runDir = path.join(reportsDir, site, run);
    const visualDir = path.join(runDir, 'visual');
    fs.mkdirSync(path.join(visualDir, 'entries'), { recursive: true });
    fs.writeFileSync(path.join(runDir, 'run-metadata.json'), JSON.stringify({ phase: 'finished' }));
    fs.writeFileSync(path.join(visualDir, id + '-current.png'), bytes);
    const entry = { id, site, run, sha256: digest(bytes), environment, status: 'missing' };
    fs.writeFileSync(path.join(visualDir, 'entries', id + '.json'), JSON.stringify(entry));
    return id;
  }
  const accept = (site, ids, revision = null) =>
    approve({ root, reportsDir, site, run, ids, revision });
  return { root, reportsDir, run, candidate, accept };
}
test('only explicit approval changes a store reference; old versions survive report deletion', t => {
  const f = fixture(t),
    id = f.candidate();
  assert.equal(approved(f.root, 'one').revision, null);
  assert.equal(review(f.reportsDir, f.root, 'one', f.run).entries.length, 1);
  const first = f.accept('one', [id]);
  const previousPin = process.env.VISUAL_BASELINE_PIN;
  t.after(() => {
    if (previousPin === undefined) delete process.env.VISUAL_BASELINE_PIN;
    else process.env.VISUAL_BASELINE_PIN = previousPin;
  });
  assert.equal(pin(f.root, 'one', f.run).revision, first.revision);
  const original = approved(f.root, 'one');
  f.candidate('one', id, Buffer.concat([png, Buffer.from('changed')]));
  assert.equal(approved(f.root, 'one').revision, first.revision);
  assert.deepEqual(baselineImage(f.root, 'one', original, id), png);
  const second = f.accept('one', [id], first.revision);
  assert.notEqual(second.revision, first.revision);
  assert.equal(
    pin(f.root, 'one', f.run).revision,
    first.revision,
    'An active run retains its approved version',
  );
  assert.equal(pin(f.root, 'one', 'next-run').revision, second.revision);
  assert.deepEqual(baselineImage(f.root, 'one', approved(f.root, 'one', first.revision), id), png);
  fs.rmSync(f.reportsDir, { recursive: true });
  assert.equal(approved(f.root, 'one').revision, second.revision);
});
test('partial approvals preserve other screenshots and stores; stale approval is rejected', t => {
  const f = fixture(t),
    a = f.candidate(),
    b = f.candidate('one', 'b'.repeat(32));
  const first = f.accept('one', [a, b]);
  f.candidate('two');
  const other = f.accept('two', [a]);
  f.candidate('one', a, Buffer.concat([png, Buffer.from('new')]));
  const next = f.accept('one', [a], first.revision);
  assert.equal(Object.keys(approved(f.root, 'one').entries).length, 2);
  assert.deepEqual(baselineImage(f.root, 'one', approved(f.root, 'one'), b), png);
  assert.equal(approved(f.root, 'two').revision, other.revision);
  assert.throws(() => f.accept('one', [b], first.revision), /version changed/);
  assert.equal(approved(f.root, 'one').revision, next.revision);
});
test('unfinished, tampered, missing and escaped artifacts cannot be approved', t => {
  const f = fixture(t),
    id = f.candidate();
  const runDir = path.join(f.reportsDir, 'one', f.run);
  fs.writeFileSync(path.join(runDir, 'run-metadata.json'), JSON.stringify({ phase: 'running' }));
  assert.throws(() => f.accept('one', [id]), /finish/);
  f.candidate();
  fs.writeFileSync(
    path.join(runDir, 'visual', id + '-current.png'),
    Buffer.concat([png, Buffer.from('tamper')]),
  );
  assert.throws(() => f.accept('one', [id]), /changed after capture/);
  assert.throws(() => f.accept('one', ['b'.repeat(32)]), /not available/);
  assert.throws(() => f.accept('../escape', [id]), /Invalid/);
  f.candidate();
  const file = path.join(runDir, 'visual', id + '-current.png');
  const outside = path.join(path.dirname(f.root), 'outside.png');
  fs.writeFileSync(outside, png);
  fs.unlinkSync(file);
  fs.symlinkSync(outside, file);
  assert.throws(() => f.accept('one', [id]), /outside/);
  assert.equal(approved(f.root, 'one').revision, null);
});
