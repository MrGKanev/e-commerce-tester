'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { approve } = require('./security-model');
const root = path.resolve(__dirname, '..');
function specs(suites) {
  return suites.flatMap(suite => [...(suite.specs || []), ...specs(suite.suites || [])]);
}
function attachment(result) {
  const item = result.attachments.find(item => item.name === 'security-monitoring.json');
  assert.ok(item, 'Production entry must attach security evidence');
  return JSON.parse(
    item.path ? fs.readFileSync(item.path, 'utf8') : Buffer.from(item.body, 'base64').toString(),
  );
}
async function main() {
  let changed = false,
    policyMode = false;
  const writes = [];
  const server = http.createServer((request, response) => {
    if (request.method !== 'GET') writes.push(request.url);
    if (request.url === '/vendor.js') {
      response.writeHead(200, { 'content-type': 'application/javascript' });
      response.end(changed ? 'window.vendorVersion=2;' : 'window.vendorVersion=1;');
    } else if (request.url === '/consent') {
      response.writeHead(204);
      response.end();
    } else if (request.url === '/favicon.ico') {
      response.writeHead(204);
      response.end();
    } else {
      response.writeHead(200, {
        'content-type': 'text/html',
        ...(policyMode ? { 'content-security-policy': "connect-src 'none'" } : {}),
      });
      response.end(
        '<!doctype html><html lang="en"><title>Local security entry</title><button type="button" id="accept">Accept</button><button type="button" id="reject">Reject</button><form action="/payment"><button type="submit">Never submit</button></form><script src="/vendor.js"></script><script>for(const id of ["accept","reject"])document.getElementById(id).onclick=()=>fetch("/consent",{method:"POST",body:id});</script></html>',
      );
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const output = path.join(root, 'reports/local-security-entry');
  fs.mkdirSync(output, { recursive: true });
  const baselines = [];
  let count = 0;
  try {
    for (const platform of ['shopify', 'woocommerce']) {
      const baselineFile = `security-baselines/.entry-${process.pid}-${platform}.json`;
      baselines.push(path.join(root, baselineFile));
      const settings = {
        platform,
        url: origin,
        locale: 'en-US',
        timezoneId: 'UTC',
        cookieConsent: { mode: 'none' },
        securityMonitoring: {
          enabled: true,
          observeMs: 50,
          phases: ['initial', 'reject', 'accept'],
          pages: [
            { name: 'home', path: '/', role: 'storefront' },
            { name: 'checkout', path: '/checkout', role: 'checkout' },
          ],
          consent: { acceptSelector: '#accept', rejectSelector: '#reject' },
          payment: {
            checkoutOrigins: [origin],
            formOrigins: [origin],
            frameOrigins: [origin],
            allowTopDocumentCardFields: false,
          },
        },
      };
      async function run(label, expectedFailures) {
        const reportFile = path.join(output, `${platform}-${label}.json`);
        const exit = await new Promise((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [
              require.resolve('@playwright/test/cli'),
              'test',
              '--config=checks/security-monitoring-entry.config.ts',
            ],
            {
              cwd: root,
              stdio: 'inherit',
              env: {
                ...process.env,
                CONTROL_EVENTS_FILE: '',
                PAGE_INVENTORY_FILE: '',
                STORE_URL: origin,
                STORE_PLATFORM: platform,
                SITE_SLUG: `security-entry-${platform}`,
                SITE_SETTINGS_JSON: JSON.stringify(settings),
                REQUEST_DELAY_MS: '0',
                REQUEST_JITTER_MS: '0',
                TEST_DELAY_MS: '0',
                TEST_JITTER_MS: '0',
                SECURITY_ENTRY_REPORT_FILE: reportFile,
                SECURITY_ENTRY_OUTPUT_DIR: path.join(output, `${platform}-${label}`),
              },
            },
          );
          child.once('error', reject);
          child.once('exit', resolve);
        });
        assert.equal(exit, expectedFailures ? 1 : 0);
        const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
        assert.equal(report.stats.unexpected, expectedFailures);
        assert.equal(report.stats.skipped, 0);
        const cases = specs(report.suites).flatMap(spec => spec.tests);
        assert.equal(cases.length, 12);
        count += cases.length;
        return cases.map(test => {
          assert.equal(test.results.length, 1);
          const observed = attachment(test.results[0]);
          for (const stage of observed.stages) assert.equal(stage.coverage.complete, true);
          return observed;
        });
      }
      changed = false;
      policyMode = false;
      const candidates = await run('candidate', 0);
      let baseline;
      for (const candidate of candidates) {
        assert.equal(candidate.status, 'needs-review');
        baseline = approve(candidate, baseline, {
          reviewed: true,
          reason: 'Owned local fixture review',
        }); // Owned, deterministic local fixtures only.
      }
      assert.equal(
        baseline.history.length,
        candidates.length,
        'Every explicit fixture approval must retain an audit record',
      );
      assert.ok(baseline.history.every(entry => entry.reason === 'Owned local fixture review'));
      fs.mkdirSync(path.dirname(path.join(root, baselineFile)), { recursive: true });
      fs.writeFileSync(path.join(root, baselineFile), JSON.stringify(baseline), { flag: 'wx' });
      const approvedBytes = fs.readFileSync(path.join(root, baselineFile), 'utf8');
      settings.securityMonitoring.mode = 'strict';
      settings.securityMonitoring.baselineFile = baselineFile;
      for (const observed of await run('approved', 0))
        assert.equal(observed.status, 'matches-baseline');
      changed = true;
      for (const observed of await run('drift', 12)) {
        assert.equal(observed.status, 'needs-review');
        assert.ok(
          observed.stages.some(stage =>
            stage.findings.some(finding => finding.rule === 'security-script-content-changed'),
          ),
        );
      }
      changed = false;
      policyMode = true;
      const previousWrites = writes.length;
      for (const observed of await run('csp-enforced', 8)) {
        assert.ok(observed.stages.every(stage => stage.policy.installed));
        assert.equal(
          observed.status,
          observed.stages[0].scope.choice === 'initial' ? 'matches-baseline' : 'needs-review',
        );
        assert.equal(
          observed.stages.some(stage =>
            stage.findings.some(finding => finding.rule === 'security-script-content-changed'),
          ),
          false,
        );
        if (observed.stages[0].scope.choice !== 'initial')
          assert.ok(
            observed.stages[1].policy.events.some(
              event => event.directive === 'connect-src' && event.disposition === 'enforce',
            ),
          );
      }
      assert.equal(
        fs.readFileSync(path.join(root, baselineFile), 'utf8'),
        approvedBytes,
        'Storefront runs must never mutate approval history',
      );
      assert.equal(
        writes.length,
        previousWrites,
        'Enforced CSP must prevent owned consent POSTs from reaching the server',
      );
    }
    assert.ok(writes.length > 0, 'Explicit consent controls must be exercised');
    assert.ok(
      writes.every(url => url === '/consent'),
      'No checkout or payment form may be submitted',
    );
    console.log(
      `Security production entry: ${count} local cases verified, including 24 expected strict drift failures and 16 expected CSP failures.`,
    );
  } finally {
    for (const file of baselines) fs.rmSync(file, { force: true });
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
