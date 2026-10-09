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
  const result = spawnSync('pnpm', ['exec', 'playwright', 'test', '--config=checks/reporting.config.ts'], {
    stdio: 'inherit', env: { ...process.env, REPORTING_METADATA_FILE: metadataFile, REPORTING_RESULTS_FILE: resultsFile,
      STORE_URL: 'http://127.0.0.1:45982', SITE_SLUG: 'reporting-local',
      TEST_DELAY_MS: '0', TEST_JITTER_MS: '0', REQUEST_DELAY_MS: '0', REQUEST_JITTER_MS: '0' },
  });
  assert.equal(result.status, 0, 'The offline reporter suite must complete');
  const metadata = JSON.parse(fs.readFileSync(metadataFile));
  const results = JSON.parse(fs.readFileSync(resultsFile));
  const run = summarizeRun(results, metadata);
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
  assert.ok(run.scenarios.find(s => s.outcome === 'flaky').attempts[0].errors[0].includes('Price update'));
  assert.equal(run.notApplicable, 1);
  const vitals = JSON.parse(fs.readFileSync(path.join(dir, 'web-vitals.json')));
  assert.equal(vitals.documents.length, 1);
  assert.equal(vitals.documents[0].synthetic, true);
  assert.equal(vitals.documents[0].activeObservers, 0);
  assert.equal(vitals.documents[0].metrics.cls.status, 'unmeasured');
  assert.equal(vitals.documents[0].metrics.cls.value, null);
  console.log('Offline reporting acceptance checks passed: metadata, real browser version, tags, applicability and flaky diagnostics.');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
