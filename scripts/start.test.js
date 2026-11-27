'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function launch(t, scenario = '', args = ['--no-open']) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-start-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(directory, 'docker'),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$CALLS"
case "$*" in
  info) [[ "$SCENARIO" != unavailable && ( "$SCENARIO" != desktop || -f "$CALLS.ready" ) ]] ;;
  'desktop start') [[ "$SCENARIO" != unavailable ]] && touch "$CALLS.ready" ;;
  *'ps --status running -q scheduler') [[ "$SCENARIO" != scheduler ]] || echo scheduler ;;
  *'ps --status running -q control') [[ "$SCENARIO" != fresh || -f "$CALLS.started" ]] && echo control || true ;;
  *'up -d --build --no-recreate control') touch "$CALLS.started" ;;
  inspect*) if [[ "$SCENARIO" == unhealthy ]]; then echo unhealthy; elif [[ "$SCENARIO" == starting ]]; then echo starting; else echo healthy; fi ;;
  *'port control 8080') echo 0.0.0.0:8091 ;;
esac
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(directory, 'open'),
    `#!/usr/bin/env bash
printf 'open %s\\n' "$*" >> "$CALLS"
`,
    { mode: 0o755 },
  );
  const calls = path.join(directory, 'calls');
  const result = spawnSync('bash', [path.join(__dirname, '../start.sh'), ...args], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      CALLS: calls,
      SCENARIO: scenario,
    },
  });
  return { ...result, calls: fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '' };
}
test('launcher reuses the healthy panel and respects its published port', t => {
  const result = launch(t);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /http:\/\/127.0.0.1:8091/);
  assert.doesNotMatch(result.calls, /up |desktop start|stop|restart/);
});
test('launcher builds an absent panel after starting Docker Desktop', t => {
  for (const scenario of ['fresh', 'desktop']) {
    const result = launch(t, scenario);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Panel ready/);
    assert.match(
      result.calls,
      scenario === 'fresh' ? /up -d --build --no-recreate control/ : /desktop start/,
    );
  }
});
test('launcher reports Docker, conflicting scheduler and health failures without stopping services', t => {
  for (const scenario of ['unavailable', 'scheduler', 'unhealthy']) {
    const result = launch(t, scenario);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /Start Docker|scheduler is running|not healthy/);
    assert.doesNotMatch(result.calls, /up |stop|restart/);
  }
});

test('launcher opens the ready URL by default and rejects unsupported options before Docker calls', t => {
  const result = launch(t, '', []);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.calls, /port control 8080\nopen http:\/\/127\.0\.0\.1:8091\n$/);
  const invalid = launch(t, '', ['--unsupported']);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Usage:/);
  assert.equal(invalid.calls, '');
});

test('launcher probes readiness inside Docker without waiting for the periodic healthcheck', t => {
  const result = launch(t, 'starting');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.calls, /exec control node scripts\/control-healthcheck\.js/);
  assert.match(result.stdout, /Panel ready/);
});
