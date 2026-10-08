'use strict';

const percent = (numerator, denominator) => denominator > 0 ? Math.round(numerator / denominator * 100) : null;
const errorText = error => typeof error === 'string' ? error : error?.message || error?.value || error?.stack || 'Unspecified error';

function collectScenarios(suites, parents = []) {
  return (suites || []).flatMap(suite => {
    const titles = suite.title ? [...parents, suite.title] : parents;
    return [
      ...(suite.specs || []).flatMap(spec => (spec.tests || []).map(test => {
        const attempts = test.results || [];
        const last = attempts.at(-1);
        const annotations = [...(test.annotations || []), ...attempts.flatMap(a => a.annotations || [])];
        const skipReasons = [...new Set(annotations.filter(a => ['skip', 'fixme', 'not-applicable'].includes(a.type)).map(a => a.description).filter(Boolean))];
        let outcome = { expected: 'passed', unexpected: 'failed', flaky: 'flaky', skipped: 'skipped' }[test.status];
        if (last?.status === 'interrupted') outcome = 'interrupted';
        else if (!attempts.length || (last?.workerIndex === -1 && !annotations.some(a => ['skip', 'fixme'].includes(a.type)))) outcome = 'not-run';
        else if (!outcome) outcome = { passed: 'passed', failed: 'failed', timedOut: 'failed', skipped: 'skipped' }[last?.status] || 'not-run';
        return {
          id: spec.id, name: spec.title, title: [...titles, spec.title].join(' › '), project: test.projectName || 'Unknown browser',
          file: spec.file || suite.file || '', line: spec.line, tags: spec.tags || [], outcome,
          urls: [...new Set(annotations.filter(a => a.type === 'url' || a.type === 'failure-url').map(a => a.description).filter(Boolean))],
          artifacts: attempts.flatMap(a => (a.attachments || []).filter(attachment => attachment.path && (attachment.contentType?.startsWith('image/') || attachment.name === 'trace')).map(attachment => ({ name: attachment.name, path: attachment.path, contentType: attachment.contentType }))),
          notApplicable: outcome === 'skipped' && annotations.some(a => a.type === 'not-applicable'),
          reasons: outcome === 'skipped' ? skipReasons.length ? skipReasons : ['No skip reason recorded'] : [],
          attempts: attempts.map(a => ({ retry: a.retry || 0, status: a.status || 'not-run', errors: [...new Set((a.errors?.length ? a.errors : a.error ? [a.error] : []).map(errorText))] })),
        };
      })),
      ...collectScenarios(suite.suites, titles),
    ];
  });
}

function summarizeRun(results = {}, metadata = {}, issue = null) {
  const scenarios = collectScenarios(results.suites);
  // Checkpoints let a killed process remain visible even without a final JSON report.
  const planned = new Map();
  const key = scenario => JSON.stringify([scenario.project, (scenario.file || '').replace(/^tests\//, ''), scenario.line || 0, scenario.name || scenario.title.split(' › ').at(-1)]);
  for (const scenario of metadata.scenarios || []) {
    const bucket = planned.get(key(scenario)) || [];
    bucket.push(scenario); planned.set(key(scenario), bucket);
  }
  const selected = [
    ...scenarios.map(scenario => ({ ...(planned.get(key(scenario))?.shift() || {}), ...scenario })),
    ...[...planned.values()].flat(),
  ];
  for (const scenario of selected) {
    if (scenario.outcome === 'running') scenario.outcome = metadata.status === 'interrupted' || metadata.signal ? 'interrupted' : 'unfinished';
  }
  const stats = results.stats || {};
  const count = outcome => selected.filter(s => s.outcome === outcome).length;
  const passed = selected.length ? count('passed') : stats.expected || 0;
  const failed = selected.length ? count('failed') : stats.unexpected || 0;
  const flaky = selected.length ? count('flaky') : stats.flaky || 0;
  const skipped = selected.length ? count('skipped') : stats.skipped || 0;
  const interrupted = count('interrupted');
  const notRun = count('not-run');
  const unfinished = count('unfinished');
  const total = selected.length || passed + failed + flaky + skipped;
  const notApplicable = selected.filter(s => s.notApplicable).length;
  const unclassifiedSkipped = skipped - notApplicable;
  const executed = passed + failed + flaky;
  const applicable = total - notApplicable;
  const globalErrors = [...new Set([...(results.errors || []), ...(metadata.errors || [])].map(errorText))];
  const ended = metadata.phase === 'finished';
  let status;
  if (metadata.status === 'interrupted' || metadata.signal || interrupted > 0) status = 'interrupted';
  else if (globalErrors.length) status = 'global-errors';
  else if (issue || (metadata.phase && !ended) || metadata.status === 'timedout' || notRun > 0 || unfinished > 0) status = 'incomplete';
  else if (total === 0) status = 'empty';
  else if (failed > 0 || metadata.status === 'failed' || (metadata.exitCode && !executed)) status = 'failed';
  else if (executed < applicable) status = 'incomplete';
  else if (flaky > 0) status = 'flaky';
  else if (executed === 0) status = 'not-applicable';
  else status = 'passed';
  return {
    passed, failed, skipped, flaky, interrupted, notRun, unfinished, total, executed, applicable,
    notApplicable, unclassifiedSkipped, scopeKnown: !!(results.stats || Array.isArray(results.suites) || Object.hasOwn(metadata, 'selectedTests') || selected.length), status, allPassed: status === 'passed',
    // Flaky tests succeeded on retry, but keep a warning status and their failed attempts.
    passRate: percent(passed + flaky, executed), coverage: percent(executed, applicable),
    errors: globalErrors.length, globalErrors, reportIssue: issue, scenarios: selected, metadata,
    durationSec: Math.round((stats.duration ?? metadata.duration ?? 0) / 1000),
  };
}

function compareRuns(current, previous) {
  if (!previous?.scenarios?.length || !current.scenarios.length) return { available: false, new: 0, recurring: 0, resolved: 0, unverified: 0 };
  const key = scenario => [scenario.project, scenario.file, scenario.title].join('\0');
  const old = new Map(previous.scenarios.map(scenario => [key(scenario), scenario]));
  const now = new Map(current.scenarios.map(scenario => [key(scenario), scenario]));
  const changes = { available: true, baseline: previous.dir, new: 0, recurring: 0, resolved: 0, unverified: 0 };
  for (const scenario of current.scenarios.filter(scenario => scenario.outcome === 'failed')) {
    scenario.change = old.get(key(scenario))?.outcome === 'failed' ? 'recurring' : 'new';
    changes[scenario.change]++;
  }
  for (const [id, scenario] of old) if (scenario.outcome === 'failed') {
    if (now.get(id)?.outcome === 'passed') changes.resolved++;
    else if (now.get(id)?.outcome !== 'failed') changes.unverified++;
  }
  return changes;
}
module.exports = { summarizeRun, collectScenarios, percent, compareRuns };
