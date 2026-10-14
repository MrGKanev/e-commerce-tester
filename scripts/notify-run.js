'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { summarizeRun } = require('./report-model');
const { scope, transition, scriptChanges } = require('./monitoring');
const { annotations, issueId } = require('./issues');
function read(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
}
function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
}
async function processRun(runDir, options = {}, env = process.env) {
  const metadata = read(path.join(runDir, 'run-metadata.json'), {});
  const results = read(path.join(runDir, 'results.json'), {});
  const summary = summarizeRun(results, metadata);
  const key = scope(summary);
  const stateFile = path.join(runDir, '..', '.monitoring', key + '.json');
  const previous = read(stateFile, {});
  const run = path.basename(runDir);
  const { state, events } = transition(previous, summary, run);
  if (previous.run === run) return;
  const scripts = read(path.join(runDir, 'third-party-scripts.json'), null);
  if (
    scripts?.complete &&
    summary.scenarios.some(s => s.name === 'third-party script inventory') &&
    summary.scenarios
      .filter(s => s.name === 'third-party script inventory')
      .every(s => s.outcome === 'passed')
  ) {
    const changes = scriptChanges(scripts.scripts, previous.scripts);
    write(path.join(runDir, 'script-changes.json'), changes);
    if (changes.added.length || changes.removed.length)
      events.push({ state: 'changed', category: 'third-party', ...changes });
    state.scripts = scripts.scripts;
  } else state.scripts = previous.scripts;
  const suppressed = (options.maintenance || []).some(
    window => Date.now() >= Date.parse(window.start) && Date.now() < Date.parse(window.end),
  );
  const site = path.basename(path.dirname(runDir));
  const notes = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(site)
    ? annotations(path.resolve(runDir, '../..'), site)
    : {};
  const pending = [...(previous.pending || []), ...events];
  const deliverable = pending.filter(
    event => !event.key || !(Date.parse(notes[issueId(key, event.key)]?.mutedUntil) > Date.now()),
  );
  state.pending = options.enabled ? pending : [];
  const reportPath = `/reports/${encodeURIComponent(metadata.site?.slug || path.basename(path.dirname(runDir)))}/${encodeURIComponent(run)}/html/index.html`;
  const payload = {
    site: metadata.site?.slug,
    run,
    reportUrl: env.REPORT_BASE_URL ? new URL(reportPath, env.REPORT_BASE_URL).href : reportPath,
    events: deliverable,
  };
  // Persist before delivery: repeat runner invocations must not resend the same transition.
  write(stateFile, state);
  const delivery = {
    events: deliverable,
    suppressed,
    status: suppressed ? 'suppressed' : options.enabled ? 'no-changes' : 'disabled',
  };
  if (options.enabled && deliverable.length && !suppressed) {
    try {
      const endpoint = new URL(env[options.webhookEnv || 'MONITORING_WEBHOOK_URL']);
      if (
        !['http:', 'https:'].includes(endpoint.protocol) ||
        endpoint.username ||
        endpoint.password
      )
        throw new Error('Invalid webhook URL');
      const response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`Webhook HTTP ${response.status}`);
      delivery.status = 'delivered';
      state.pending = pending.filter(event => !deliverable.includes(event));
      write(stateFile, state);
    } catch {
      delivery.status = 'failed';
      delivery.error = 'Webhook delivery failed; check endpoint configuration and receiver logs.';
    }
  }
  write(path.join(runDir, 'notifications.json'), delivery);
}
if (require.main === module)
  processRun(process.argv[2], JSON.parse(process.env.NOTIFICATION_SETTINGS || '{}')).catch(
    error => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
module.exports = { processRun };
