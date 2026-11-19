'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const sorted = values => [...new Set(values)].sort();
function identity(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol))
      return { origin: url.protocol, pathHash: hash(url.protocol), urlHash: hash(value) };
    return { origin: url.origin, pathHash: hash(url.pathname), urlHash: hash(url.href) };
  } catch {
    return { origin: 'unresolved', pathHash: hash('unresolved'), urlHash: hash(value) };
  }
}
function scopeKey(scope) {
  return hash(
    JSON.stringify(
      ['site', 'project', 'page', 'role', 'choice', 'profile', 'locale', 'timezoneId', 'stage'].map(
        key => scope[key],
      ),
    ),
  );
}
function signature(stage) {
  return {
    scripts: [
      ...new Map(
        stage.scripts
          .filter(script => script.status === 'hashed')
          .map(script => [
            script.key + ':' + script.sha256,
            { key: script.key, sha256: script.sha256 },
          ]),
      ).values(),
    ].sort((a, b) => (a.key + a.sha256).localeCompare(b.key + b.sha256)),
    destinations: sorted(stage.destinations.map(destination => destination.key)),
    payment: {
      documents: sorted(stage.payment.documents),
      forms: sorted(stage.payment.forms),
      formActions: sorted(stage.payment.formActions),
      frames: sorted(stage.payment.frames),
      cardFields: stage.payment.cardFields,
      overlayCardFields: stage.payment.overlayCardFields,
    },
  };
}
function compare(stage, baseline) {
  const findings = [];
  const add = (rule, evidence, severity = 'warning') => findings.push({ rule, severity, evidence });
  const current = signature(stage);
  const approved = baseline?.approvals.find(item => scopeKey(item.scope) === scopeKey(stage.scope));
  if (!approved) add('security-baseline-missing', { scope: scopeKey(stage.scope) });
  else {
    const known = new Map();
    for (const script of approved.signature.scripts) {
      if (!known.has(script.key)) known.set(script.key, new Set());
      known.get(script.key).add(script.sha256);
    }
    const seen = new Set();
    for (const script of current.scripts) {
      seen.add(script.key);
      if (!known.has(script.key)) add('security-script-added', { key: script.key });
      else if (!known.get(script.key).has(script.sha256))
        add('security-script-content-changed', { key: script.key, sha256: script.sha256 });
    }
    for (const key of known.keys()) if (!seen.has(key)) add('security-script-removed', { key });
    for (const key of current.destinations)
      if (!approved.signature.destinations.includes(key))
        add('security-destination-added', { key });
    if (!isDeepStrictEqual(current.payment, approved.signature.payment))
      add('security-payment-interface-changed', { current: current.payment });
  }
  return findings;
}
function validateBaseline(value) {
  const fail = () => {
    throw new Error('Invalid security baseline structure');
  };
  const keys = (object, allowed) =>
    object &&
    typeof object === 'object' &&
    !Array.isArray(object) &&
    Object.keys(object).every(key => allowed.includes(key));
  const strings = array =>
    Array.isArray(array) &&
    array.length <= 2000 &&
    array.every(item => typeof item === 'string' && item.length <= 1000);
  if (
    !keys(value, ['schemaVersion', 'approvals']) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.approvals) ||
    value.approvals.length > 2000
  )
    fail();
  const scopes = new Set();
  for (const item of value.approvals) {
    if (
      !keys(item, ['scope', 'approvedAt', 'signature']) ||
      !keys(item.scope, [
        'site',
        'project',
        'page',
        'role',
        'choice',
        'profile',
        'locale',
        'timezoneId',
        'stage',
      ]) ||
      Object.keys(item.scope).length !== 9 ||
      Object.values(item.scope).some(v => typeof v !== 'string' || !v || v.length > 200) ||
      !Number.isFinite(Date.parse(item.approvedAt))
    )
      fail();
    if (scopes.has(scopeKey(item.scope))) fail();
    scopes.add(scopeKey(item.scope));
    const sig = item.signature;
    if (
      !keys(sig, ['scripts', 'destinations', 'payment']) ||
      !Array.isArray(sig.scripts) ||
      sig.scripts.length > 2000 ||
      !strings(sig.destinations)
    )
      fail();
    const digests = new Set();
    for (const script of sig.scripts) {
      if (
        !keys(script, ['key', 'sha256']) ||
        typeof script.key !== 'string' ||
        !script.key ||
        script.key.length > 1000 ||
        !/^[a-f0-9]{64}$/.test(script.sha256) ||
        digests.has(script.key + ':' + script.sha256)
      )
        fail();
      digests.add(script.key + ':' + script.sha256);
    }
    const p = sig.payment;
    if (
      !keys(p, [
        'documents',
        'forms',
        'formActions',
        'frames',
        'cardFields',
        'overlayCardFields',
      ]) ||
      !strings(p.documents) ||
      !strings(p.forms) ||
      !strings(p.formActions) ||
      !strings(p.frames) ||
      !Number.isInteger(p.cardFields) ||
      p.cardFields < 0 ||
      !Number.isInteger(p.overlayCardFields) ||
      p.overlayCardFields < 0
    )
      fail();
  }
  return value;
}
function baselinePath(file, repositoryRoot = path.resolve(__dirname, '..')) {
  const root = path.resolve(repositoryRoot, 'security-baselines'),
    target = path.resolve(repositoryRoot, file);
  const relative = path.relative(root, target);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith('..' + path.sep) ||
    path.isAbsolute(relative) ||
    !target.endsWith('.json')
  )
    throw new Error('Security baselines must be JSON files inside security-baselines/');
  let cursor = root;
  for (const part of ['', ...relative.split(path.sep)]) {
    if (part) cursor = path.join(cursor, part);
    let stat;
    try {
      stat = fs.lstatSync(cursor);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (stat?.isSymbolicLink()) throw new Error('Security baseline symlinks are not supported');
  }
  return target;
}
function loadBaseline(file, repositoryRoot) {
  if (!file) return undefined;
  const target = baselinePath(file, repositoryRoot);
  if (!fs.existsSync(target)) throw new Error('Configured security baseline does not exist');
  if (fs.statSync(target).size > 5 * 1024 * 1024)
    throw new Error('Security baseline exceeds size limit');
  return validateBaseline(JSON.parse(fs.readFileSync(target, 'utf8')));
}
function approve(candidate, existing, options = {}) {
  if (!options.reviewed) throw new Error('Explicit --reviewed approval is required');
  if (
    candidate?.schemaVersion !== 1 ||
    !Array.isArray(candidate.stages) ||
    !candidate.stages.length ||
    candidate.stages.length > 2 ||
    candidate.stages.some(
      stage =>
        stage.coverage?.complete !== true ||
        !Array.isArray(stage.scripts) ||
        stage.scripts.some(
          script => script.status !== 'hashed' || !/^[a-f0-9]{64}$/.test(script.sha256),
        ),
    )
  )
    throw new Error('Only complete observed stages can be approved');
  const result = structuredClone(existing || { schemaVersion: 1, approvals: [] });
  validateBaseline(result);
  for (const stage of candidate.stages) {
    const next = {
      scope: stage.scope,
      approvedAt: new Date().toISOString(),
      signature: signature(stage),
    };
    validateBaseline({ schemaVersion: 1, approvals: [next] });
    const index = result.approvals.findIndex(
      item => scopeKey(item.scope) === scopeKey(stage.scope),
    );
    if (index >= 0 && !options.replace && !options.addVariant)
      throw new Error('Scope already approved; use --replace or --add-variant after review');
    if (index >= 0 && options.addVariant) {
      const old = result.approvals[index].signature;
      if (
        !isDeepStrictEqual(
          sorted(old.scripts.map(item => item.key)),
          sorted(next.signature.scripts.map(item => item.key)),
        ) ||
        !isDeepStrictEqual(old.destinations, next.signature.destinations) ||
        !isDeepStrictEqual(old.payment, next.signature.payment)
      )
        throw new Error(
          'Variants may add digests only to the same script keys and unchanged destinations/payment contract',
        );
      next.signature.scripts = [
        ...new Map(
          [...old.scripts, ...next.signature.scripts].map(item => [
            item.key + ':' + item.sha256,
            item,
          ]),
        ).values(),
      ].sort((a, b) => (a.key + a.sha256).localeCompare(b.key + b.sha256));
    }
    if (index < 0) result.approvals.push(next);
    else result.approvals[index] = next;
  }
  return validateBaseline(result);
}
function main(argv = process.argv.slice(2)) {
  if (argv[0] !== 'approve')
    throw new Error(
      'Usage: security-model.js approve --candidate <report.json> --baseline security-baselines/<file.json> --reviewed [--replace|--add-variant]',
    );
  const flags = {};
  for (let i = 1; i < argv.length; i++) {
    const key = argv[i];
    if (['--reviewed', '--replace', '--add-variant'].includes(key)) {
      if (flags[key]) throw new Error('Duplicate approval option');
      flags[key] = true;
    } else if (['--candidate', '--baseline'].includes(key) && argv[i + 1] && !flags[key])
      flags[key] = argv[++i];
    else throw new Error('Unknown or incomplete security approval option');
  }
  if (
    !flags['--candidate'] ||
    !flags['--baseline'] ||
    (flags['--replace'] && flags['--add-variant'])
  )
    throw new Error('Invalid approval arguments');
  if (fs.statSync(flags['--candidate']).size > 5 * 1024 * 1024)
    throw new Error('Candidate exceeds size limit');
  const candidate = JSON.parse(fs.readFileSync(flags['--candidate'], 'utf8'));
  const target = baselinePath(flags['--baseline']);
  const result = approve(
    candidate,
    fs.existsSync(target) ? loadBaseline(flags['--baseline']) : undefined,
    {
      reviewed: flags['--reviewed'],
      replace: flags['--replace'],
      addVariant: flags['--add-variant'],
    },
  );
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = target + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify(result, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  console.log('Reviewed security baseline written; no store was contacted.');
}
module.exports = {
  hash,
  identity,
  scopeKey,
  signature,
  compare,
  validateBaseline,
  baselinePath,
  loadBaseline,
  approve,
};
if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
