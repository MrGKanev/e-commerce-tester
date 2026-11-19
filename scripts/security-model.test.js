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
  review,
  history,
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
  assert.throws(
    () => approve(incomplete, undefined, { reviewed: true, reason: 'Owned local fixture review' }),
    /complete/,
  );
  const pending = candidate();
  pending.stages[0].scripts[0].status = 'pending';
  assert.throws(
    () => approve(pending, undefined, { reviewed: true, reason: 'Owned local fixture review' }),
    /complete/,
  );
});
test('approved baseline matches observed content and never mutates during comparisons', () => {
  const c = candidate(),
    baseline = approve(c, undefined, { reviewed: true, reason: 'Owned local fixture review' }),
    before = JSON.stringify(baseline);
  assert.deepEqual(compare(c.stages[0], baseline), []);
  assert.equal(JSON.stringify(baseline), before);
});
test('same URL/group changed contents, added/removed scripts and new destinations require review', () => {
  const c = candidate(),
    baseline = approve(c, undefined, { reviewed: true, reason: 'Owned local fixture review' });
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
    baseline = approve(c, undefined, { reviewed: true, reason: 'Owned local fixture review' });
  c.stages[0].payment.formActions = ['other-path-digest'];
  assert.ok(
    compare(c.stages[0], baseline).some(f => f.rule === 'security-payment-interface-changed'),
  );
});
test('baselines cannot silently replace scopes; variants add only reviewed digests', () => {
  const c = candidate(),
    baseline = approve(c, undefined, { reviewed: true, reason: 'Owned local fixture review' });
  c.stages[0].scripts[0].sha256 = hash('variant');
  assert.throws(
    () => approve(c, baseline, { reviewed: true, reason: 'Owned local fixture review' }),
    /already approved/,
  );
  const variants = approve(c, baseline, {
    reviewed: true,
    reason: 'Owned local fixture review',
    addVariant: true,
  });
  assert.equal(variants.approvals[0].signature.scripts.length, 2);
  assert.deepEqual(compare(c.stages[0], variants), []);
  c.stages[0].destinations.push({ key: 'unknown' });
  assert.throws(
    () =>
      approve(c, baseline, {
        reviewed: true,
        reason: 'Owned local fixture review',
        addVariant: true,
      }),
    /unchanged/,
  );
});
test('approval scopes separate projects, consent phases, roles and region profiles', () => {
  const c = candidate(),
    baseline = approve(c, undefined, { reviewed: true, reason: 'Owned local fixture review' });
  for (const key of ['project', 'choice', 'role', 'profile', 'stage']) {
    const stage = structuredClone(c.stages[0]);
    stage.scope[key] = 'different';
    assert.equal(compare(stage, baseline)[0].rule, 'security-baseline-missing');
  }
});
test('malformed/duplicate baseline scopes and non-digests are rejected', () => {
  const baseline = approve(candidate(), undefined, {
    reviewed: true,
    reason: 'Owned local fixture review',
  });
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
test('offline review is read-only, reports exact old/new digests and fingerprints arbitrary private labels', () => {
  const c = candidate(),
    baseline = approve(c, undefined, { reviewed: true, reason: 'Reviewed release A' });
  const before = JSON.stringify(baseline),
    oldDigest = c.stages[0].scripts[0].sha256;
  c.stages[0].scripts[0].sha256 = hash('next-code');
  c.stages[0].destinations = [{ key: 'fetch:POST:https://new.test:main' }];
  c.stages[0].payment.forms = ['https://pay.test/private?secret=private-sentinel'];
  c.rawBundle = 'private-raw-script';
  const output = review(c, baseline, { replace: true });
  assert.equal(output.approvable, true);
  assert.deepEqual(output.scopes[0].scripts[0].before, [oldDigest]);
  assert.deepEqual(output.scopes[0].scripts[0].after, [hash('next-code')]);
  assert.equal(output.scopes[0].destinations.added[0].origin, 'https://new.test');
  assert.equal(output.scopes[0].destinations.removed[0].origin, 'https://cdn.test');
  assert.equal(
    output.scopes[0].payment.some(change => change.field === 'forms'),
    true,
  );
  assert.doesNotMatch(JSON.stringify(output), /private-sentinel|private-raw-script|secret=/);
  assert.equal(JSON.stringify(baseline), before);
  c.stages[0].scope.site = 'https://private-user:private-pass@site.test?token=private-scope';
  assert.doesNotMatch(JSON.stringify(review(c)), /private-user|private-pass|private-scope/);
});
test('review preserves exact frame-script fingerprints and renders its origin without exposing paths', () => {
  const c = candidate();
  const key = `external:https://cdn.test:${hash('/private.js')}:frame:${hash('frame-context')}`;
  c.stages[0].scripts[0].key = key;
  const output = review(c);
  assert.equal(output.scopes[0].scripts[0].origin, 'https://cdn.test');
  assert.equal(output.scopes[0].scripts[0].keyHash, hash(key));
  assert.deepEqual(output.scopes[0].scripts[0].after, [hash('known-good')]);
  assert.doesNotMatch(JSON.stringify(output), /private.js|frame-context/);
});
test('approval reasons are redacted before the audit chain is hashed', () => {
  const baseline = approve(candidate(), undefined, {
    reviewed: true,
    reason: 'Release reviewed by private-reviewer@example.test; token=private-audit-token',
  });
  assert.doesNotMatch(JSON.stringify(baseline), /private-reviewer|private-audit-token/);
  assert.match(baseline.history[0].reason, /Release reviewed/);
  validateBaseline(baseline);
});
test('review marks incomplete observations and replacement/variant restrictions without changing approval rules', () => {
  const c = candidate(),
    baseline = approve(c, undefined, { reviewed: true, reason: 'Reviewed release A' });
  assert.equal(review(c, baseline).issues[0].code, 'scope-already-approved');
  c.stages[0].coverage.complete = false;
  assert.equal(review(c, undefined).issues[0].code, 'incomplete-observation');
  c.stages[0].coverage.complete = true;
  c.stages[0].destinations.push({ key: 'new-destination' });
  assert.equal(review(c, baseline, { addVariant: true }).issues[0].code, 'invalid-variant');
});
test('new approvals require a bounded reason and preserve an append-only reversible hash-linked history', () => {
  const c = candidate();
  assert.throws(() => approve(c, undefined, { reviewed: true }), /reason/);
  for (const reason of ['', 'x'.repeat(501), 'two\nlines'])
    assert.throws(() => approve(c, undefined, { reviewed: true, reason }), /reason/);
  assert.throws(
    () => approve(c, undefined, { reviewed: true, reason: 'Reviewed release A', reviewHash: '' }),
    /review hash/,
  );
  const first = approve(c, undefined, { reviewed: true, reason: 'Reviewed release A' });
  c.stages[0].scripts[0].sha256 = hash('release B');
  const next = approve(c, first, { reviewed: true, reason: 'Reviewed release B', replace: true });
  assert.equal(next.history.length, 2);
  assert.equal(next.history[1].previousId, first.history[0].id);
  assert.deepEqual(next.history[1].changes[0].before, first.approvals[0]);
  assert.deepEqual(next.history[1].changes[0].after, next.approvals[0]);
  assert.equal(first.history.length, 1);
  for (const mutate of [
    value => {
      value.history[0].reason = 'modified';
    },
    value => {
      value.history[1].changes[0].before.signature.scripts[0].sha256 = hash('forged');
    },
    value => {
      value.approvals[0].signature.scripts[0].sha256 = hash('forged');
    },
  ]) {
    const tampered = structuredClone(next);
    mutate(tampered);
    assert.throws(() => validateBaseline(tampered), /Invalid/);
  }
});
test('audit history is paginated newest first without pruning or exposing private signature strings', () => {
  const c = candidate();
  const first = approve(c, undefined, { reviewed: true, reason: 'Reviewed release A' });
  c.stages[0].scripts[0].sha256 = hash('release B');
  const next = approve(c, first, { reviewed: true, reason: 'Reviewed release B', replace: true });
  const page = history(next, { limit: 1 });
  assert.equal(page.total, 2);
  assert.equal(page.entries[0].reason, 'Reviewed release B');
  assert.equal(page.nextBefore, next.history[1].id);
  const earlier = history(next, { limit: 1, before: page.nextBefore });
  assert.equal(earlier.entries[0].reason, 'Reviewed release A');
  assert.equal(earlier.nextBefore, null);
  assert.equal(next.history.length, 2);
  assert.equal(history({ schemaVersion: 1, approvals: first.approvals }).legacy, true);
  assert.throws(() => history(next, { limit: 0 }), /limit/);
  assert.throws(() => history(next, { before: hash('missing') }), /cursor/);
});
test('legacy baselines without audit history remain readable and gain history only on explicit reviewed approval', () => {
  const c = candidate(),
    original = approve(c, undefined, { reviewed: true, reason: 'Owned fixture' });
  const legacy = { schemaVersion: 1, approvals: original.approvals };
  validateBaseline(legacy);
  assert.deepEqual(compare(c.stages[0], legacy), []);
  assert.equal(review(c, legacy, { replace: true }).approvable, true);
  const migrated = approve(c, legacy, {
    reviewed: true,
    reason: 'Reviewed legacy reference',
    replace: true,
  });
  assert.equal(migrated.history.length, 1);
  assert.deepEqual(migrated.history[0].changes[0].before, legacy.approvals[0]);
  assert.equal(legacy.history, undefined);
});
test('the offline CLI requires current review hash/reason, keeps the baseline unchanged on errors, and serializes approvals', t => {
  const root = path.resolve(__dirname, '..'),
    name = 'security-model-' + crypto.randomUUID() + '.json';
  const baselineFile = 'security-baselines/' + name,
    full = path.join(root, baselineFile),
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'security-candidate-')),
    input = path.join(tmp, 'report.json');
  t.after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(full, { force: true });
    fs.rmSync(full + '.lock', { force: true });
  });
  const c = candidate();
  fs.writeFileSync(input, JSON.stringify(c));
  const run = (command, extra = []) =>
    spawnSync(
      process.execPath,
      [
        path.join(__dirname, 'security-model.js'),
        command,
        '--candidate',
        input,
        '--baseline',
        baselineFile,
        ...extra,
      ],
      { encoding: 'utf8' },
    );
  const preview = run('review');
  assert.equal(preview.status, 0);
  assert.equal(fs.existsSync(full), false);
  const fresh = JSON.parse(preview.stdout);
  assert.equal(fresh.scopes[0].state, 'new');
  assert.equal(run('approve', ['--reviewed']).status, 1);
  assert.equal(fs.existsSync(full), false);
  const options = [
    '--reviewed',
    '--reason',
    'Reviewed local release',
    '--review-hash',
    fresh.reviewHash,
  ];
  assert.equal(run('approve', options).status, 0);
  assert.equal(loadBaseline(baselineFile).history.length, 1);
  const originalBytes = fs.readFileSync(full, 'utf8');
  assert.equal(run('approve', [...options, '--replace']).status, 1);
  assert.equal(fs.readFileSync(full, 'utf8'), originalBytes);
  const replacement = JSON.parse(run('review', ['--replace']).stdout);
  c.stages[0].scripts[0].sha256 = hash('unreviewed edit');
  fs.writeFileSync(input, JSON.stringify(c));
  const replacementOptions = [
    '--reviewed',
    '--reason',
    'Reviewed local replacement',
    '--replace',
    '--review-hash',
    replacement.reviewHash,
  ];
  assert.equal(run('approve', replacementOptions).status, 1);
  assert.equal(fs.readFileSync(full, 'utf8'), originalBytes);
  c.stages[0].scripts[0].sha256 = hash('known-good');
  fs.writeFileSync(input, JSON.stringify(c));
  fs.writeFileSync(full + '.lock', '');
  assert.equal(run('approve', replacementOptions).status, 1);
  assert.equal(fs.readFileSync(full, 'utf8'), originalBytes);
  assert.equal(fs.existsSync(full + '.lock'), true);
  fs.rmSync(full + '.lock');
  assert.equal(run('approve', replacementOptions).status, 0);
  assert.equal(loadBaseline(baselineFile).history.length, 2);
  const audit = spawnSync(
    process.execPath,
    [
      path.join(__dirname, 'security-model.js'),
      'history',
      '--baseline',
      baselineFile,
      '--limit',
      '1',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(audit.status, 0);
  assert.equal(JSON.parse(audit.stdout).entries.length, 1);
  const approvedBytes = fs.readFileSync(full, 'utf8');
  fs.writeFileSync(full, '{"private-baseline-sentinel":');
  const invalidBaseline = run('review');
  assert.equal(invalidBaseline.status, 1);
  assert.doesNotMatch(invalidBaseline.stderr, /private-baseline-sentinel/);
  assert.equal(run('approve', replacementOptions).status, 1);
  assert.equal(fs.readFileSync(full, 'utf8'), '{"private-baseline-sentinel":');
  fs.writeFileSync(full, approvedBytes);
  fs.writeFileSync(input, '{"private-sentinel":');
  const invalid = run('review');
  assert.equal(invalid.status, 1);
  assert.doesNotMatch(invalid.stderr, /private-sentinel/);
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
