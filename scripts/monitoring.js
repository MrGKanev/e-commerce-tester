'use strict';
const { createHash } = require('node:crypto');
function classification(scenario) {
  const text = [
    ...(scenario.reasons || []),
    ...(scenario.attempts || []).flatMap(a => a.errors || []),
  ].join('\n');
  if (/HTTP 429|rate.?limit|Cloudflare|captcha|access denied|HTTP 403/i.test(text))
    return 'blocked';
  if (/product.*(?:not found|missing|404)|no available.*product/i.test(text))
    return 'product-missing';
  if (/selector|locator.*(?:resolved to 0|not found)|strict mode violation/i.test(text))
    return 'selector';
  if (/ECONN|ENOTFOUND|browser.*closed|executable.*exist/i.test(text)) return 'infrastructure';
  if (/expect\(|assert|Expected:|unexpected status/i.test(text)) return 'storefront';
  return 'unverified';
}
function checkKey(scenario) {
  return JSON.stringify([
    scenario.project,
    (scenario.file || '').replace(/^tests\//, ''),
    scenario.title || scenario.name,
  ]);
}
function scope(summary) {
  const m = summary.metadata;
  return createHash('sha256')
    .update(
      JSON.stringify({
        mode: m.mode,
        platform: m.configuration?.platform || m.site?.platform,
        projects: m.projects,
        configuration: m.configuration,
        checks: summary.scenarios.map(checkKey).sort(),
      }),
    )
    .digest('hex');
}
function transition(previous = {}, summary, run) {
  const incidents = { ...(previous.incidents || {}) };
  const events = [];
  if (previous.run === run) return { state: previous, events };
  for (const scenario of summary.scenarios) {
    const key = checkKey(scenario),
      old = incidents[key];
    const category = classification(scenario);
    if (scenario.outcome === 'failed') {
      const consecutive = old?.category === category ? old.count + 1 : 1;
      incidents[key] = { category, count: consecutive, name: scenario.name };
      if (consecutive <= 2)
        events.push({
          state: consecutive === 1 ? 'new' : 'confirmed',
          category,
          check: scenario.name,
        });
    } else if (old && scenario.outcome === 'passed') {
      delete incidents[key];
      events.push({ state: 'recovered', category: old.category, check: scenario.name });
    }
  }
  let runnerIncident = previous.runnerIncident || false;
  if (
    summary.globalErrors?.length ||
    summary.reportIssue ||
    ['interrupted', 'empty'].includes(summary.status)
  ) {
    const category = classification({
      outcome: 'failed',
      attempts: [{ errors: summary.globalErrors || [] }],
    });
    if (!runnerIncident)
      events.push({
        state: 'new',
        category: category === 'unverified' ? 'infrastructure' : category,
        check: 'Run could not complete',
      });
    runnerIncident = true;
  } else if (
    runnerIncident &&
    ['passed', 'failed', 'flaky', 'not-applicable'].includes(summary.status)
  ) {
    events.push({
      state: 'recovered',
      category: 'infrastructure',
      check: 'Run could not complete',
    });
    runnerIncident = false;
  }
  return { state: { run, incidents, runnerIncident }, events };
}
function compareReports(candidate, production) {
  const old = new Map(production.scenarios.map(s => [checkKey(s), s]));
  const current = new Map(candidate.scenarios.map(s => [checkKey(s), s]));
  return [...new Set([...old.keys(), ...current.keys()])].map(key => {
    const before = old.get(key),
      after = current.get(key);
    return {
      check: after?.name || before.name,
      project: after?.project || before.project,
      production: before?.outcome || 'not-run',
      candidate: after?.outcome || 'not-run',
      change:
        !before ||
        !after ||
        !['passed', 'failed'].includes(before.outcome) ||
        !['passed', 'failed'].includes(after.outcome)
          ? 'unverified'
          : before.outcome === after.outcome
            ? 'unchanged'
            : after.outcome === 'failed'
              ? 'regression'
              : 'improved',
    };
  });
}
function scriptChanges(current, previous) {
  if (!previous) return { baseline: true, added: [], removed: [] };
  return {
    baseline: false,
    added: current.filter(s => !previous.includes(s)),
    removed: previous.filter(s => !current.includes(s)),
  };
}
module.exports = { classification, checkKey, scope, transition, compareReports, scriptChanges };
