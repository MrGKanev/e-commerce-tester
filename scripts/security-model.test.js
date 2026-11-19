'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const {
  hash,
  identity,
  compare,
  approve,
  validateBaseline,
  baselinePath,
  loadBaseline,
} = require('./security-model');
const { resolveSiteSettings } = require('../config/site-settings');
function candidate() {
  return {
    schemaVersion: 1,
    stages: [
      {
        scope: {
          site: 'fixture',
          project: 'Desktop Chrome',
          page: 'home',
          role: 'storefront',
          choice: 'initial',
          stage: 'initial',
          profile: 'eu',
          locale: 'en-US',
          timezoneId: 'UTC',
        },
        scripts: [{ key: 'script-key', sha256: hash('known-good'), status: 'hashed' }],
        destinations: [{ key: 'script:GET:https://cdn.test:main' }],
        payment: {
          documents: ['https://store.test'],
          forms: ['https://store.test'],
          formActions: ['action-digest'],
          frames: [],
          cardFields: 0,
          overlayCardFields: 0,
        },
        coverage: { complete: true },
      },
    ],
  };
}
test('URL evidence exposes origins and fingerprints without credentials, paths or query values', () => {
  const value = identity(
    'https://private-user:private-password@example.test/private-path?email=private-email',
  );
  assert.equal(value.origin, 'https://example.test');
  assert.equal(value.urlHash.length, 64);
  assert.doesNotMatch(JSON.stringify(value), /private-/);
  assert.notEqual(
    identity('https://example.test/a?code=1').urlHash,
    identity('https://example.test/a?code=2').urlHash,
  );
});
test('baseline approval requires explicit review and complete observations', () => {
  assert.throws(() => approve(candidate()), /reviewed/);
  const incomplete = candidate();
  incomplete.stages[0].coverage.complete = false;
  assert.throws(() => approve(incomplete, undefined, { reviewed: true }), /complete/);
  const pending = candidate();
  pending.stages[0].scripts[0].status = 'pending';
  assert.throws(() => approve(pending, undefined, { reviewed: true }), /complete/);
});
test('approved baseline matches observed content and never mutates during comparisons', () => {
  const c = candidate(),
    baseline = approve(c, undefined, { reviewed: true }),
    before = JSON.stringify(baseline);
  assert.deepEqual(compare(c.stages[0], baseline), []);
  assert.equal(JSON.stringify(baseline), before);
});
test('same URL/group changed contents, added/removed scripts and new destinations require review', () => {
  const c = candidate(),
    baseline = approve(c, undefined, { reviewed: true });
  c.stages[0].scripts[0].sha256 = hash('injected');
  assert.ok(compare(c.stages[0], baseline).some(f => f.rule === 'security-script-content-changed'));
  c.stages[0].scripts = [{ key: 'new-key', sha256: hash('new'), status: 'hashed' }];
  c.stages[0].destinations.push({ key: 'fetch:POST:https://unknown.test:main' });
  const rules = compare(c.stages[0], baseline).map(f => f.rule);
  for (const rule of [
    'security-script-added',
    'security-script-removed',
    'security-destination-added',
  ])
    assert.ok(rules.includes(rule));
});
test('form-action drift on the same origin changes payment-interface evidence', () => {
  const c = candidate(),
    baseline = approve(c, undefined, { reviewed: true });
  c.stages[0].payment.formActions = ['other-path-digest'];
  assert.ok(
    compare(c.stages[0], baseline).some(f => f.rule === 'security-payment-interface-changed'),
  );
});
test('baselines cannot silently replace scopes; variants add only reviewed digests', () => {
  const c = candidate(),
    baseline = approve(c, undefined, { reviewed: true });
  c.stages[0].scripts[0].sha256 = hash('variant');
  assert.throws(() => approve(c, baseline, { reviewed: true }), /already approved/);
  const variants = approve(c, baseline, { reviewed: true, addVariant: true });
  assert.equal(variants.approvals[0].signature.scripts.length, 2);
  assert.deepEqual(compare(c.stages[0], variants), []);
  c.stages[0].destinations.push({ key: 'unknown' });
  assert.throws(() => approve(c, baseline, { reviewed: true, addVariant: true }), /unchanged/);
});
test('approval scopes separate projects, consent phases, roles and region profiles', () => {
  const c = candidate(),
    baseline = approve(c, undefined, { reviewed: true });
  for (const key of ['project', 'choice', 'role', 'profile', 'stage']) {
    const stage = structuredClone(c.stages[0]);
    stage.scope[key] = 'different';
    assert.equal(compare(stage, baseline)[0].rule, 'security-baseline-missing');
  }
});
test('malformed/duplicate baseline scopes and non-digests are rejected', () => {
  const baseline = approve(candidate(), undefined, { reviewed: true });
  const duplicate = structuredClone(baseline);
  duplicate.approvals.push(duplicate.approvals[0]);
  assert.throws(() => validateBaseline(duplicate), /Invalid/);
  baseline.approvals[0].signature.scripts[0].sha256 = 'not-a-digest';
  assert.throws(() => validateBaseline(baseline), /Invalid/);
});
test('baseline paths cannot escape the repository baseline directory or traverse symlinks', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'security-baselines-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => baselinePath('../outside.json', root), /inside/);
  fs.mkdirSync(path.join(root, 'security-baselines'));
  fs.symlinkSync(os.tmpdir(), path.join(root, 'security-baselines', 'linked'));
  assert.throws(() => baselinePath('security-baselines/linked/out.json', root), /symlink/);
  assert.throws(() => loadBaseline('security-baselines/missing.json', root), /does not exist/);
});
test('the offline approval CLI writes only after reviewed intent and keeps existing scopes protected', t => {
  const root = path.resolve(__dirname, '..'),
    name = 'security-model-' + crypto.randomUUID() + '.json';
  const baselineFile = 'security-baselines/' + name,
    full = path.join(root, baselineFile),
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'security-candidate-')),
    input = path.join(tmp, 'report.json');
  t.after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(full, { force: true });
  });
  fs.writeFileSync(input, JSON.stringify(candidate()));
  const run = extra =>
    spawnSync(
      process.execPath,
      [
        path.join(__dirname, 'security-model.js'),
        'approve',
        '--candidate',
        input,
        '--baseline',
        baselineFile,
        ...extra,
      ],
      { encoding: 'utf8' },
    );
  assert.equal(run([]).status, 1);
  assert.equal(fs.existsSync(full), false);
  assert.equal(run(['--reviewed']).status, 0);
  assert.equal(loadBaseline(baselineFile).approvals.length, 1);
  assert.equal(run(['--reviewed']).status, 1);
  assert.equal(run(['--reviewed', '--replace']).status, 0);
});
test('security settings validate strict shapes, origins, names, phase actions and byte budgets', () => {
  for (const securityMonitoring of [
    { mode: 'silently-approve' },
    { payment: { checkoutOrigins: ['https://example.test/path'] } },
    { phases: ['reject'] },
    { limits: { scriptBytes: 100, totalScriptBytes: 99 } },
    { pages: [{ name: 'one', path: 'https://outside.test', role: 'storefront' }] },
    { baselineFile: '../secret.json' },
  ])
    assert.throws(() => resolveSiteSettings({ securityMonitoring }));
  assert.equal(resolveSiteSettings({ monitorScripts: true }).securityMonitoring.enabled, true);
  assert.equal(
    resolveSiteSettings({ monitorScripts: true, securityMonitoring: { enabled: false } })
      .securityMonitoring.enabled,
    false,
  );
});
