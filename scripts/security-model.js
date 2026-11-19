'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { redactText } = require('./artifact-privacy');
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
const MAX_BYTES = 5 * 1024 * 1024;
const emptyBaseline = () => ({ schemaVersion: 1, approvals: [] });
function canonical(value, depth = 0) {
  if (depth > 32) throw new Error('Security review data exceeds nesting limit');
  if (Array.isArray(value)) return value.map(item => canonical(item, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonical(value[key], depth + 1)]),
    );
  return value;
}
const fingerprint = value => hash(JSON.stringify(canonical(value)));
const approvalsHash = value => fingerprint(value.approvals);
function reviewReason(value) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > 500 ||
    [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    throw new Error('Approval requires a nonempty single-line --reason of at most 500 characters');
  return value.trim();
}
function candidateStages(candidate, requireComplete = true) {
  if (
    candidate?.schemaVersion !== 1 ||
    !Array.isArray(candidate.stages) ||
    !candidate.stages.length ||
    candidate.stages.length > 2
  )
    throw new Error('Invalid security candidate structure');
  const scopes = new Set();
  return candidate.stages.map(stage => {
    if (
      !stage ||
      !Array.isArray(stage.scripts) ||
      stage.scripts.length > 200 ||
      !Array.isArray(stage.destinations) ||
      stage.destinations.length > 2000
    )
      throw new Error('Invalid security candidate structure');
    const complete =
      stage.coverage?.complete === true &&
      stage.scripts.every(
        script => script?.status === 'hashed' && /^[a-f0-9]{64}$/.test(script.sha256),
      );
    if (requireComplete && !complete)
      throw new Error('Only complete observed stages can be approved');
    let result;
    try {
      result = {
        scope: structuredClone(stage.scope),
        approvedAt: '2000-01-01T00:00:00.000Z',
        signature: signature(stage),
      };
    } catch {
      throw new Error('Invalid security candidate structure');
    }
    validateBaseline({ schemaVersion: 1, approvals: [result] });
    const key = scopeKey(result.scope);
    if (scopes.has(key)) throw new Error('Duplicate candidate scope');
    scopes.add(key);
    return { ...result, complete };
  });
}
function approvedSignature(next, previous, mode) {
  if (previous && mode === 'create')
    throw new Error('Scope already approved; use --replace or --add-variant after review');
  const result = structuredClone(next);
  if (previous && mode === 'add-variant') {
    const old = previous.signature;
    if (
      !isDeepStrictEqual(
        sorted(old.scripts.map(item => item.key)),
        sorted(result.scripts.map(item => item.key)),
      ) ||
      !isDeepStrictEqual(old.destinations, result.destinations) ||
      !isDeepStrictEqual(old.payment, result.payment)
    )
      throw new Error(
        'Variants may add digests only to the same script keys and unchanged destinations/payment contract',
      );
    result.scripts = [
      ...new Map(
        [...old.scripts, ...result.scripts].map(item => [item.key + ':' + item.sha256, item]),
      ).values(),
    ].sort((a, b) => (a.key + a.sha256).localeCompare(b.key + b.sha256));
  }
  return result;
}
function approvalMode(options) {
  if (options.replace && options.addVariant)
    throw new Error('Choose either --replace or --add-variant');
  return options.replace ? 'replace' : options.addVariant ? 'add-variant' : 'create';
}
function safeOrigin(value) {
  if (typeof value !== 'string') return null;
  const source =
    /^external:((?:https?):\/\/.+):[a-f0-9]{64}:(?:main|frame:[a-f0-9]{64}|worker-or-unknown)$/.exec(
      value,
    ) ||
    /^[^:]{1,50}:[A-Z]{1,20}:((?:https?|wss?):\/\/.+):(?:main|frame|worker-or-unknown|page-websocket)$/.exec(
      value,
    ) ||
    /^((?:https?|wss?):\/\/.+):[a-f0-9]{64}$/.exec(value);
  try {
    const url = new URL(source ? source[1] : value);
    return ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}
const publicKey = key => ({ keyHash: hash(key), origin: safeOrigin(key) });
const publicScope = scope =>
  Object.fromEntries(
    Object.entries(scope).map(([key, value]) => {
      const safe = redactText(value);
      return [key, /^[a-zA-Z0-9 _./+-]{1,200}$/.test(safe) ? safe : '[scope:' + hash(value) + ']'];
    }),
  );
function scriptDiff(before, after) {
  const group = list => {
    const result = new Map();
    for (const script of list) {
      if (!result.has(script.key)) result.set(script.key, []);
      result.get(script.key).push(script.sha256);
    }
    return result;
  };
  const old = group(before),
    next = group(after);
  return [...new Set([...old.keys(), ...next.keys()])].sort().flatMap(key => {
    const previous = sorted(old.get(key) || []),
      current = sorted(next.get(key) || []);
    return isDeepStrictEqual(previous, current)
      ? []
      : [{ ...publicKey(key), before: previous, after: current }];
  });
}
function paymentDiff(before, after) {
  const render = value =>
    Array.isArray(value)
      ? value.map(item => ({ valueHash: hash(item), origin: safeOrigin(item) }))
      : value;
  return Object.keys(after)
    .filter(key => !isDeepStrictEqual(before?.[key], after[key]))
    .map(field => ({
      field,
      before: before ? render(before[field]) : null,
      after: render(after[field]),
    }));
}
/** Read-only, bounded machine diff. No raw candidate bodies, arbitrary signature keys or URL paths are rendered. */
function review(candidate, existing, options = {}) {
  const baseline = validateBaseline(existing || emptyBaseline()),
    mode = approvalMode(options);
  const stages = candidateStages(candidate, false),
    issues = [];
  const scopes = stages.map(next => {
    const previous = baseline.approvals.find(item => scopeKey(item.scope) === scopeKey(next.scope));
    let proposed;
    if (!next.complete)
      issues.push({ scopeHash: scopeKey(next.scope), code: 'incomplete-observation' });
    try {
      proposed = approvedSignature(next.signature, previous, mode);
    } catch {
      issues.push({
        scopeHash: scopeKey(next.scope),
        code: previous && mode === 'create' ? 'scope-already-approved' : 'invalid-variant',
      });
      proposed = next.signature;
    }
    const old = previous?.signature;
    return {
      scopeHash: scopeKey(next.scope),
      scope: publicScope(next.scope),
      complete: next.complete,
      state: !previous ? 'new' : isDeepStrictEqual(old, proposed) ? 'unchanged' : 'changed',
      approvedAt: previous?.approvedAt || null,
      scripts: scriptDiff(old?.scripts || [], proposed.scripts),
      destinations: {
        added: proposed.destinations.filter(key => !old?.destinations.includes(key)).map(publicKey),
        removed: (old?.destinations || [])
          .filter(key => !proposed.destinations.includes(key))
          .map(publicKey),
      },
      payment: paymentDiff(old?.payment, proposed.payment),
    };
  });
  const result = {
    schemaVersion: 1,
    mode,
    baseHash: fingerprint(baseline),
    candidateHash: fingerprint(candidate),
    approvable: issues.length === 0,
    issues,
    scopes,
  };
  const output = { ...result, reviewHash: fingerprint(result) };
  if (Buffer.byteLength(JSON.stringify(output, null, 2) + '\n') > MAX_BYTES)
    throw new Error('Security review exceeds size limit');
  return output;
}

/** Paginated, redacted audit view. The baseline retains every record; pagination never prunes history. */
function history(existing, options = {}) {
  const baseline = validateBaseline(existing),
    limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('History limit must be from 1 to 100');
  const entries = [...(baseline.history || [])].reverse();
  let start = 0;
  if (options.before !== undefined) {
    if (typeof options.before !== 'string' || !/^[a-f0-9]{64}$/.test(options.before))
      throw new Error('Invalid history cursor');
    start = entries.findIndex(entry => entry.id === options.before) + 1;
    if (start === 0) throw new Error('History cursor is not present in this baseline');
  }
  const page = entries.slice(start, start + limit).map(entry => ({
    id: entry.id,
    previousId: entry.previousId,
    at: entry.at,
    reason: redactText(entry.reason),
    mode: entry.mode,
    candidateHash: entry.candidateHash,
    reviewHash: entry.reviewHash,
    beforeHash: entry.beforeHash,
    afterHash: entry.afterHash,
    scopes: entry.changes.map(change => ({
      scopeHash: scopeKey(change.after.scope),
      scope: publicScope(change.after.scope),
      scripts: scriptDiff(change.before?.signature.scripts || [], change.after.signature.scripts),
      destinations: {
        added: change.after.signature.destinations
          .filter(key => !change.before?.signature.destinations.includes(key))
          .map(publicKey),
        removed: (change.before?.signature.destinations || [])
          .filter(key => !change.after.signature.destinations.includes(key))
          .map(publicKey),
      },
      payment: paymentDiff(change.before?.signature.payment, change.after.signature.payment),
    })),
  }));
  const output = {
    schemaVersion: 1,
    baselineHash: fingerprint(baseline),
    total: entries.length,
    legacy: !entries.length,
    entries: page,
    nextBefore: start + limit < entries.length ? page.at(-1).id : null,
  };
  if (Buffer.byteLength(JSON.stringify(output, null, 2) + '\n') > MAX_BYTES)
    throw new Error('Security history page exceeds size limit; request a smaller limit');
  return output;
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
    !keys(value, ['schemaVersion', 'approvals', 'history']) ||
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
      typeof item.approvedAt !== 'string' ||
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
  if (value.history !== undefined) {
    if (!Array.isArray(value.history) || value.history.length > 1000) fail();
    let previousId = null,
      previousAfter = null;
    for (const entry of value.history) {
      if (
        !keys(entry, [
          'id',
          'previousId',
          'at',
          'reason',
          'mode',
          'candidateHash',
          'reviewHash',
          'beforeHash',
          'afterHash',
          'changes',
        ]) ||
        entry.previousId !== previousId ||
        typeof entry.at !== 'string' ||
        !Number.isFinite(Date.parse(entry.at)) ||
        !['create', 'replace', 'add-variant'].includes(entry.mode) ||
        ['id', 'candidateHash', 'reviewHash', 'beforeHash', 'afterHash'].some(
          key => typeof entry[key] !== 'string' || !/^[a-f0-9]{64}$/.test(entry[key]),
        ) ||
        !Array.isArray(entry.changes) ||
        !entry.changes.length ||
        entry.changes.length > 2 ||
        (previousAfter && entry.beforeHash !== previousAfter)
      )
        fail();
      try {
        if (reviewReason(entry.reason) !== entry.reason) fail();
      } catch {
        fail();
      }
      const changedScopes = new Set();
      for (const change of entry.changes) {
        if (!keys(change, ['before', 'after']) || !change.after || !Object.hasOwn(change, 'before'))
          fail();
        validateBaseline({ schemaVersion: 1, approvals: [change.after] });
        if (change.before !== null) {
          validateBaseline({ schemaVersion: 1, approvals: [change.before] });
          if (scopeKey(change.before.scope) !== scopeKey(change.after.scope)) fail();
        }
        if (changedScopes.has(scopeKey(change.after.scope))) fail();
        changedScopes.add(scopeKey(change.after.scope));
      }
      const { id, ...contents } = entry;
      if (fingerprint(contents) !== id) fail();
      previousId = id;
      previousAfter = entry.afterHash;
    }
    if (previousAfter && previousAfter !== approvalsHash(value)) fail();
    const restored = { approvals: structuredClone(value.approvals) };
    for (const entry of [...value.history].reverse()) {
      if (approvalsHash(restored) !== entry.afterHash) fail();
      for (const change of entry.changes) {
        const index = restored.approvals.findIndex(
          item => scopeKey(item.scope) === scopeKey(change.after.scope),
        );
        if (
          index < 0 ||
          !isDeepStrictEqual(restored.approvals[index], change.after) ||
          change.after.approvedAt !== entry.at
        )
          fail();
        if (change.before === null) restored.approvals.splice(index, 1);
        else restored.approvals[index] = structuredClone(change.before);
      }
      if (approvalsHash(restored) !== entry.beforeHash) fail();
    }
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
      if (error.code !== 'ENOENT') {
        // eslint-disable-next-line preserve-caught-error -- Do not retain filesystem paths in public review errors.
        throw new Error('Cannot inspect security baseline path');
      }
    }
    if (stat?.isSymbolicLink()) throw new Error('Security baseline symlinks are not supported');
  }
  return target;
}
function loadBaseline(file, repositoryRoot) {
  if (!file) return undefined;
  const target = baselinePath(file, repositoryRoot);
  if (!fs.existsSync(target)) throw new Error('Configured security baseline does not exist');
  try {
    const stat = fs.statSync(target);
    if (!stat.isFile() || stat.size > MAX_BYTES)
      throw new Error('Security baseline exceeds size limit or is not a regular file');
    return validateBaseline(JSON.parse(fs.readFileSync(target, 'utf8')));
  } catch (error) {
    if (
      error.message === 'Invalid security baseline structure' ||
      error.message === 'Security baseline exceeds size limit or is not a regular file'
    )
      throw error;
    // eslint-disable-next-line preserve-caught-error -- Parser errors can include private baseline contents.
    throw new Error('Cannot read a valid security baseline JSON file');
  }
}
function approve(candidate, existing, options = {}) {
  if (!options.reviewed) throw new Error('Explicit --reviewed approval is required');
  const reason = reviewReason(redactText(reviewReason(options.reason))),
    mode = approvalMode(options);
  const stages = candidateStages(candidate);
  const result = structuredClone(validateBaseline(existing || emptyBaseline()));
  const comparison = review(candidate, result, options);
  if (options.reviewHash !== undefined) {
    if (typeof options.reviewHash !== 'string' || !/^[a-f0-9]{64}$/.test(options.reviewHash))
      throw new Error('Invalid security review hash');
    if (options.reviewHash !== comparison.reviewHash)
      throw new Error('Security review is stale; review the current candidate and baseline again');
  }
  const beforeHash = approvalsHash(result),
    at = new Date().toISOString(),
    changes = [];
  for (const stage of stages) {
    const index = result.approvals.findIndex(
      item => scopeKey(item.scope) === scopeKey(stage.scope),
    );
    const previous = index < 0 ? null : result.approvals[index];
    const next = {
      scope: stage.scope,
      approvedAt: at,
      signature: approvedSignature(stage.signature, previous, mode),
    };
    changes.push({
      before: previous ? structuredClone(previous) : null,
      after: structuredClone(next),
    });
    if (index < 0) result.approvals.push(next);
    else result.approvals[index] = next;
  }
  const history = result.history || [];
  const contents = {
    previousId: history.at(-1)?.id || null,
    at,
    reason,
    mode,
    candidateHash: comparison.candidateHash,
    reviewHash: comparison.reviewHash,
    beforeHash,
    afterHash: approvalsHash(result),
    changes,
  };
  result.history = [...history, { id: fingerprint(contents), ...contents }];
  validateBaseline(result);
  if (Buffer.byteLength(JSON.stringify(result, null, 2) + '\n') > MAX_BYTES)
    throw new Error(
      'Security baseline exceeds size limit; archive reviewed history before continuing',
    );
  return result;
}
function readCandidate(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_BYTES)
      throw new Error('Candidate exceeds size limit or is not a regular file');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error('Cannot read a bounded security candidate JSON file');
  }
}
function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  if (!['review', 'approve', 'history'].includes(command))
    throw new Error(
      'Usage: security-model.js review|approve --candidate <report.json> --baseline security-baselines/<file.json> [--replace|--add-variant]; approve also requires --reviewed --reason <text> --review-hash <digest>; history --baseline <file> [--limit 1..100] [--before <id>]',
    );
  const flags = {};
  for (let i = 1; i < argv.length; i++) {
    const key = argv[i];
    if (['--reviewed', '--replace', '--add-variant'].includes(key)) {
      if (flags[key]) throw new Error('Duplicate security review option');
      flags[key] = true;
    } else if (
      ['--candidate', '--baseline', '--reason', '--review-hash', '--limit', '--before'].includes(
        key,
      ) &&
      argv[i + 1] &&
      !argv[i + 1].startsWith('--') &&
      !flags[key]
    )
      flags[key] = argv[++i];
    else throw new Error('Unknown or incomplete security review option');
  }
  if (command === 'history') {
    if (
      !flags['--baseline'] ||
      Object.keys(flags).some(key => !['--baseline', '--limit', '--before'].includes(key))
    )
      throw new Error('Invalid history arguments');
    if (flags['--limit'] !== undefined && !/^(?:[1-9][0-9]?|100)$/.test(flags['--limit']))
      throw new Error('History limit must be from 1 to 100');
    console.log(
      JSON.stringify(
        history(loadBaseline(flags['--baseline']), {
          limit: flags['--limit'] === undefined ? 20 : Number(flags['--limit']),
          before: flags['--before'],
        }),
        null,
        2,
      ),
    );
    return;
  }
  if (
    !flags['--candidate'] ||
    !flags['--baseline'] ||
    (flags['--replace'] && flags['--add-variant']) ||
    flags['--limit'] ||
    flags['--before'] ||
    (command === 'review' && (flags['--reviewed'] || flags['--reason'] || flags['--review-hash']))
  )
    throw new Error('Invalid security review arguments');
  const candidate = readCandidate(flags['--candidate']),
    target = baselinePath(flags['--baseline']);
  const options = {
    reviewed: flags['--reviewed'],
    replace: flags['--replace'],
    addVariant: flags['--add-variant'],
    reason: flags['--reason'],
    reviewHash: flags['--review-hash'],
  };
  if (command === 'review') {
    const output = review(
      candidate,
      fs.existsSync(target) ? loadBaseline(flags['--baseline']) : undefined,
      options,
    );
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  if (!options.reviewed) throw new Error('Explicit --reviewed approval is required');
  reviewReason(options.reason);
  if (typeof options.reviewHash !== 'string' || !/^[a-f0-9]{64}$/.test(options.reviewHash))
    throw new Error('Approval requires the --review-hash from the current offline review');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const lock = target + '.lock';
  let descriptor;
  try {
    descriptor = fs.openSync(lock, 'wx', 0o600);
  } catch {
    throw new Error(
      'Another baseline approval may be active; inspect the baseline lock before retrying',
    );
  }
  const temporary = target + '.' + crypto.randomUUID() + '.tmp';
  try {
    baselinePath(flags['--baseline']);
    const existing = fs.existsSync(target) ? loadBaseline(flags['--baseline']) : undefined;
    const before = existing ? fingerprint(existing) : null;
    const result = approve(candidate, existing, options);
    fs.writeFileSync(temporary, JSON.stringify(result, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    const current = fs.existsSync(target) ? fingerprint(loadBaseline(flags['--baseline'])) : null;
    if (current !== before) throw new Error('Baseline changed during approval; review again');
    fs.renameSync(temporary, target);
  } finally {
    fs.closeSync(descriptor);
    fs.rmSync(lock, { force: true });
    fs.rmSync(temporary, { force: true });
  }
  console.log('Reviewed security baseline and audit history written; no store was contacted.');
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
  review,
  history,
};
if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
