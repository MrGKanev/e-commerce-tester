'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { summarizeRun } = require('./report-model');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-reporting-check-'));
try {
  const metadataFile = path.join(dir, 'run-metadata.json');
  const resultsFile = path.join(dir, 'results.json');
  const eventsFile = path.join(dir, 'events.jsonl');
  fs.writeFileSync(resultsFile, JSON.stringify({ stale: true }));
  const result = spawnSync(
    'pnpm',
    ['exec', 'playwright', 'test', '--config=checks/reporting.config.ts'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        REPORTING_METADATA_FILE: metadataFile,
        REPORTING_RESULTS_FILE: resultsFile,
        CONTROL_EVENTS_FILE: eventsFile,
        STORE_URL: 'http://127.0.0.1:45982',
        SITE_SLUG: 'reporting-local',
        TEST_DELAY_MS: '0',
        TEST_JITTER_MS: '0',
        REQUEST_DELAY_MS: '0',
        REQUEST_JITTER_MS: '0',
      },
    },
  );
  assert.equal(result.status, 0, 'The offline reporter suite must complete');
  const rawMetadata = fs.readFileSync(metadataFile, 'utf8'),
    rawResults = fs.readFileSync(resultsFile, 'utf8'),
    rawEvents = fs.readFileSync(eventsFile, 'utf8');
  for (const value of [rawMetadata, rawResults, rawEvents])
    assert.doesNotMatch(
      value,
      /private-navigation|private-event|private-user|private-password|private-error|private-console|private-buffer-console|private-attachment/,
    );
  const metadata = JSON.parse(rawMetadata);
  const results = JSON.parse(rawResults);
  const allSpecs = suites =>
    suites.flatMap(suite => [...(suite.specs || []), ...allSpecs(suite.suites || [])]);
  const attachments = allSpecs(results.suites).flatMap(spec =>
    spec.tests.flatMap(test => test.results.flatMap(result => result.attachments || [])),
  );
  const privacyAttachment = attachments.find(item => item.name === 'privacy-fixture.json');
  assert.ok(privacyAttachment?.body);
  const attachmentText = Buffer.from(privacyAttachment.body, 'base64').toString('utf8');
  assert.doesNotMatch(attachmentText, /private-/);
  assert.equal(JSON.parse(attachmentText).sha256, 'a'.repeat(64));
  const outputBuffers = allSpecs(results.suites)
    .flatMap(spec =>
      spec.tests.flatMap(test =>
        test.results.flatMap(result => [...(result.stdout || []), ...(result.stderr || [])]),
      ),
    )
    .filter(item => item.buffer);
  for (const item of outputBuffers)
    assert.doesNotMatch(Buffer.from(item.buffer, 'base64').toString(), /private-/);
  assert.match(
    metadata.scenarios
      .find(scenario => scenario.urls?.some(url => url.includes('unknown=')))
      .urls.join(' '),
    /redacted-[a-f0-9]{64}/,
  );
  const run = summarizeRun(results, metadata);
  const efficiency = metadata.efficiency.stages[0];
  assert.ok(efficiency.durationMs > 0);
  assert.equal(efficiency.attempts, 5, 'Retries and skipped results retain their durations');
  assert.equal(efficiency.documentRequests, 1);
  assert.equal(efficiency.browserRequests, 1);
  assert.equal(efficiency.apiRequests, 0);
  assert.equal(
    efficiency.measuredAttempts,
    5,
    'Entered fixtures measure traffic even when their test skips at runtime',
  );
  assert.deepEqual(
    JSON.parse(
      rawEvents
        .trim()
        .split('\n')
        .filter(line => JSON.parse(line).type === 'efficiency')
        .at(-1),
    ).stages,
    metadata.efficiency.stages,
  );
  assert.equal(metadata.phase, 'finished');
  assert.equal(metadata.selectedTests, 4);
  assert.ok(metadata.versions.playwright);
  assert.equal(metadata.projects[0].locale, 'bg-BG');
  assert.ok(metadata.browserVersions['Reporting Chrome']);
  assert.ok(metadata.selection.tags.includes('@smoke'));
  assert.equal(run.total, 4, 'Checkpoints must merge with JSON without counting tests twice');
  assert.equal(run.executed, 2);
  assert.equal(run.applicable, 3);
  assert.equal(run.coverage, 67);
  assert.equal(run.passRate, 100);
  assert.equal(run.flaky, 1);
  assert.ok(
    run.scenarios.find(s => s.outcome === 'flaky').attempts[0].errors[0].includes('Price update'),
  );
  assert.equal(run.notApplicable, 1);
  const vitals = JSON.parse(fs.readFileSync(path.join(dir, 'web-vitals.json')));
  assert.equal(vitals.documents.length, 1);
  assert.equal(vitals.documents[0].synthetic, true);
  assert.doesNotMatch(JSON.stringify(vitals), /private-navigation/);
  assert.equal(vitals.documents[0].activeObservers, 0);
  assert.equal(vitals.documents[0].metrics.cls.status, 'unmeasured');
  assert.equal(vitals.documents[0].metrics.cls.value, null);
  console.log(
    'Offline reporting acceptance checks passed: metadata, real browser version, tags, applicability and flaky diagnostics, filtered events/diagnostics/encoded attachments and private staged JSON publication.',
  );
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
