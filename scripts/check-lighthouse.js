'use strict';

// Runs the real suite against loopback only, never against a live store.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('node:http');
const { spawn } = require('node:child_process');

(async () => {
  let degraded = false;
  const server = createServer((req, res) => {
    if (req.url === '/robots.txt') { res.end('User-agent: *\nAllow: /'); return; }
    res.setHeader('Content-Type', 'text/html');
    if (degraded) { res.end('<!doctype html><html><body>Intentionally poor SEO fixture</body></html>'); return; }
    res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local store audit fixture</title><meta name="description" content="A local test page for isolated Lighthouse report verification."></head><body><main><h1>Local audit fixture</h1><p>This page is served locally for automated checks.</p></main></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const run = new Date().toISOString().replace(/[:.]/g, '-');
  const savedReports = new Map();
  try {
    for (const slug of ['lighthouse-local-a', 'lighthouse-local-b']) {
      degraded = slug === 'lighthouse-local-b';
      await new Promise((resolve, reject) => {
        const child = spawn('pnpm', ['exec', 'playwright', 'test', '--config=checks/lighthouse.config.ts'], {
          stdio: 'inherit',
          env: { ...process.env, STORE_URL: origin, SITE_SLUG: slug, TEST_RUN_DATE: run,
            TEST_DELAY_MS: '0', TEST_JITTER_MS: '0', REQUEST_DELAY_MS: '0', REQUEST_JITTER_MS: '0' },
        });
        child.on('error', reject);
        child.on('exit', code => code === null ? reject(new Error('Local audit process interrupted')) : resolve());
      });
      const dir = path.resolve('reports', slug, run);
      const result = JSON.parse(fs.readFileSync(path.join(dir, 'results.json')));
      assert.equal(result.errors.length, 0, 'Suite setup must succeed');
      const tests = [];
      const visit = suite => {
        for (const spec of suite.specs || []) tests.push(...spec.tests);
        for (const child of suite.suites || []) visit(child);
      };
      result.suites.forEach(visit);
      const executed = tests.filter(t => t.status !== 'skipped');
      assert.equal(executed.length, 4, 'Each URL must be audited exactly once across browser projects');
      assert.equal(tests.filter(t => t.status === 'skipped').length, 8);
      for (const test of executed) {
        assert.equal(test.projectName, 'Desktop Chrome');
        if (degraded) assert.match(test.results[0].error?.message || '', /threshold/i, 'The poor local page must fail a score threshold');
        assert.equal(test.results.length, 1, 'No audit retries');
        const attachments = test.results[0].attachments;
        for (const type of ['text/html', 'application/json']) {
          const attachment = attachments.find(a => a.contentType === type);
          assert.ok(attachment, `Missing ${type} attachment`);
          const file = path.resolve(attachment.path);
          assert.ok(file.startsWith(dir + path.sep), 'Report must belong to this site/run');
          savedReports.set(file, fs.readFileSync(file));
        }
      }
      // The second site's run must leave all reports from the first intact.
      for (const [file, body] of savedReports) assert.deepEqual(fs.readFileSync(file), body);
    }
    console.log('Local acceptance checks passed: once per URL, isolated reports, HTML/JSON attachments even on threshold failures, no overwrite.');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
