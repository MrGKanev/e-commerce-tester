'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const model = require('./scheduler-model');
const { loadSites } = require('./site-config');
const { acquireLock } = require('./scheduler');
const sites = [
  { slug: 'a', url: 'https://a.test' },
  { slug: 'b', url: 'https://b.test' },
];
function config(overrides = {}) {
  return model.resolveSchedule(
    {
      startupSpreadMinutes: 60,
      minGapMinutes: 5,
      defaults: { jobs: [{ id: 'smoke', mode: 'smoke', intervalMinutes: [120, 240] }] },
      ...overrides,
    },
    sites,
  );
}
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scheduler-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test('requires explicit schedules and rejects unknown stores, jobs, projects and bounds', () => {
  assert.throws(() => model.resolveSchedule({}, sites));
  for (const input of [
    { defaults: { jobs: [] } },
    { mystery: true },
    { sites: { missing: { enabled: false } } },
    { minGapMinutes: -1 },
    { cooldown: { mystery: 1 } },
    { defaults: { jobs: [{ id: 'a', mode: 'wrong', intervalMinutes: [1, 2] }] } },
    { defaults: { jobs: [{ id: 'a', mode: 'smoke', intervalMinutes: [3, 2] }] } },
    { defaults: { jobs: [{ id: 'a', mode: 'smoke', intervalMinutes: [0, 2] }] } },
    {
      defaults: {
        jobs: [{ id: 'a', mode: 'smoke', intervalMinutes: [1, 2], projects: ['missing'] }],
      },
    },
  ])
    assert.throws(() => config(input));
  const resolved = config({
    sites: { b: { enabled: false }, a: { pacing: { requestDelayMs: 9000 } } },
  });
  assert.equal(resolved.jobs.length, 1);
  assert.equal(resolved.jobs[0].pacing.REQUEST_DELAY_MS, '9000');
});
test('spreads new and overdue jobs, retains future schedules and avoids catch-up bursts', () => {
  const cfg = config();
  const state = model.initialize(model.blankState(), cfg, 1000000, () => 0.5);
  assert.equal(state.jobs['a/smoke'].nextAt, 1000000 + 30 * model.MINUTE);
  state.jobs['b/smoke'].nextAt = 1;
  model.initialize(state, cfg, 1000001, () => 0.75);
  assert.equal(state.jobs['a/smoke'].nextAt, 1000000 + 30 * model.MINUTE);
  assert.equal(state.jobs['b/smoke'].nextAt, 1000001 + 45 * model.MINUTE);
  const job = cfg.jobs[0];
  model.finish(state, job, cfg, 2000000, 'passed', false, () => 0.5);
  assert.equal(state.jobs[job.key].nextAt, 2000000 + 180 * model.MINUTE);
  assert.equal(state.nextDispatchAt, 2000000 + 5 * model.MINUTE);
});
test('rate limit honors both Retry-After formats, exponential backoff and shared origins', () => {
  const cfg = config();
  const state = model.initialize(model.blankState(), cfg, 0, () => 0);
  const raw = JSON.stringify({ time: new Date(0).toISOString(), retryAfter: '40000' });
  assert.equal(model.applyRateLimit(state, sites[0].url, raw, cfg, 1000, 'a'), true);
  assert.equal(state.origins[sites[0].url].blockedUntil, 40000000);
  assert.equal(model.applyRateLimit(state, sites[0].url, raw, cfg, 2000, 'a'), false);
  const future = new Date(100000000).toUTCString();
  model.applyRateLimit(
    state,
    sites[0].url,
    JSON.stringify({ retryAfter: future }),
    cfg,
    2000,
    'alias',
  );
  assert.equal(state.origins[sites[0].url].blockedUntil, 100000000);
  assert.equal(model.applyRateLimit(state, sites[0].url, raw, cfg, 3000, 'a'), false);
  const next = model.nextJob(state, cfg);
  assert.equal(next.site, 'b');
  for (let i = 0; i < 12; i++)
    model.applyRateLimit(state, sites[1].url, JSON.stringify({ time: String(i) }), cfg, 0);
  assert.equal(
    state.origins[sites[1].url].blockedUntil,
    cfg.cooldown.maxRateLimitMinutes * model.MINUTE,
  );
});
test('restart recovers an interrupted run and failure backoff resets after success', () => {
  const cfg = config();
  const state = model.initialize(model.blankState(), cfg, 0, () => 0);
  const job = cfg.jobs[0];
  state.running = { key: job.key, origin: job.origin, startedAt: 0 };
  model.initialize(state, cfg, 1000, () => 0);
  assert.equal(state.running, null);
  assert.equal(state.jobs[job.key].lastOutcome, 'interrupted');
  assert.equal(state.origins[job.origin].blockedUntil, 1000 + 30 * model.MINUTE);
  model.finish(state, job, cfg, 2000, 'failed', false, () => 0);
  assert.equal(state.origins[job.origin].blockedUntil, 2000 + 60 * model.MINUTE);
  model.finish(state, job, cfg, 4000000, 'passed', false, () => 0);
  assert.equal(state.origins[job.origin].failureStreak, 0);
});
test('scheduled mode rejects absent store files and implicit legacy product handles', t => {
  const root = temporary(t);
  const file = path.join(root, 'sites.json');
  assert.throws(() => loadSites(file, {}, { requireFile: true }));
  fs.writeFileSync(file, JSON.stringify(sites));
  assert.throws(() => loadSites(file, {}, { requireFile: true, requireHandles: true }));
});
test('exclusive lock prevents overlapping schedulers and can recover a dead owner', t => {
  const root = temporary(t);
  const lock = acquireLock(root);
  assert.throws(() => acquireLock(root), /Another scheduler/);
  lock.heartbeat();
  lock.release();
  fs.writeFileSync(
    path.join(root, 'scheduler.lock'),
    JSON.stringify({ pid: 2147483647, host: os.hostname() }),
  );
  acquireLock(root).release();
});
function runtimeFixture(t, behavior = 'success') {
  const root = temporary(t);
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'config'));
  for (const file of ['scheduler.js', 'scheduler-model.js', 'site-config.js', 'managed-config.js'])
    fs.copyFileSync(path.join(__dirname, file), path.join(root, 'scripts', file));
  fs.copyFileSync(
    path.join(__dirname, '../config/site-settings.js'),
    path.join(root, 'config/site-settings.js'),
  );
  fs.writeFileSync(
    path.join(root, 'sites.json'),
    JSON.stringify(sites.map(site => ({ ...site, productHandle: 'one', productHandle2: 'two' }))),
  );
  fs.writeFileSync(
    path.join(root, 'scheduler.json'),
    JSON.stringify({
      startupSpreadMinutes: 0,
      minGapMinutes: 0,
      defaults: { jobs: [{ id: 'smoke', mode: 'smoke', intervalMinutes: [1, 1] }] },
    }),
  );
  fs.writeFileSync(
    path.join(root, 'scripts/run-sites.js'),
    `
    const fs = require('node:fs'); const path = require('node:path');
    const slug = process.argv[process.argv.indexOf('--site') + 1];
    fs.appendFileSync('calls.jsonl', JSON.stringify({slug, args: process.argv.slice(2), time: Date.now()}) + '\\n');
    ${behavior === 'limit' ? `fs.writeFileSync(path.join(process.env.RATE_LIMIT_DIR, '.rate-limit.' + slug + '.json'), JSON.stringify({ time: new Date().toISOString(), retryAfter: '86400' }));` : ''}
    ${behavior === 'hang' ? `setInterval(() => {}, 1000);` : ''}
  `,
  );
  return root;
}
async function waitUntil(predicate, maxMs = 8000) {
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    if (predicate()) return;
    await delay(25);
  }
  throw new Error('Timed out waiting for fixture');
}
async function startRuntime(t, root, extraEnv = {}, args = []) {
  const child = spawn(process.execPath, ['scripts/scheduler.js', ...args], {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', data => {
    output += data;
  });
  child.stderr.on('data', data => {
    output += data;
  });
  const exit = new Promise(resolve =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  );
  t.after(async () => {
    if (child.exitCode === null) child.kill('SIGKILL');
    await exit;
  });
  return { child, exit, output: () => output };
}
test('daemon executes stores sequentially, persists schedules and status makes no requests', async t => {
  const root = runtimeFixture(t);
  const runtime = await startRuntime(t, root);
  const file = path.join(root, 'scheduler-state/schedule.json');
  await waitUntil(
    () =>
      fs.existsSync(file) &&
      Object.values(JSON.parse(fs.readFileSync(file)).jobs).filter(
        job => job.lastOutcome === 'passed',
      ).length === 2,
  );
  runtime.child.kill('SIGTERM');
  assert.equal((await runtime.exit).code, 0, runtime.output());
  const calls = fs
    .readFileSync(path.join(root, 'calls.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse);
  assert.deepEqual(
    calls.map(call => call.slug),
    ['a', 'b'],
  );
  const saved = fs.readFileSync(file, 'utf8');
  for (const flag of ['--check', '--status']) {
    const result = spawnSync(process.execPath, ['scripts/scheduler.js', flag], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(fs.readFileSync(file, 'utf8'), saved);
  const restarted = await startRuntime(t, root);
  await waitUntil(() => restarted.output().includes('Started'));
  await delay(100);
  restarted.child.kill('SIGTERM');
  assert.equal((await restarted.exit).code, 0, restarted.output());
  assert.equal(
    fs.readFileSync(path.join(root, 'calls.jsonl'), 'utf8').trim().split('\n').length,
    2,
  );
});
test('daemon persists 429 cooldown before another job for that origin can run', async t => {
  const root = runtimeFixture(t, 'limit');
  const runtime = await startRuntime(t, root);
  const file = path.join(root, 'scheduler-state/schedule.json');
  await waitUntil(
    () =>
      fs.existsSync(file) &&
      Object.values(JSON.parse(fs.readFileSync(file)).jobs).filter(
        job => job.lastOutcome === 'rate-limit',
      ).length === 2,
  );
  runtime.child.kill('SIGTERM');
  assert.equal((await runtime.exit).code, 0, runtime.output());
  const state = JSON.parse(fs.readFileSync(file));
  assert.ok(state.origins['https://a.test'].blockedUntil > Date.now() + 23 * 60 * model.MINUTE);
});
test('SIGTERM interrupts an active run, saves its next schedule and releases the lock', async t => {
  const root = runtimeFixture(t, 'hang');
  const runtime = await startRuntime(t, root);
  await waitUntil(() => fs.existsSync(path.join(root, 'calls.jsonl')));
  runtime.child.kill('SIGTERM');
  assert.equal((await runtime.exit).code, 0, runtime.output());
  const state = JSON.parse(fs.readFileSync(path.join(root, 'scheduler-state/schedule.json')));
  assert.equal(state.running, null);
  assert.equal(state.jobs['a/smoke'].lastOutcome, 'interrupted');
  assert.equal(fs.existsSync(path.join(root, 'scheduler-state/scheduler.lock')), false);
});

test('start windows respect local weekdays, minute boundaries and daylight saving changes', () => {
  const window = model.resolveWindow({
    timezone: 'Europe/Sofia',
    weekdays: [1, 2, 3, 4, 5],
    start: '08:00',
    end: '20:00',
  });
  const fridayNight = Date.parse('2026-10-09T19:00:00Z');
  assert.equal(
    new Date(model.nextWindowTime(fridayNight, window)).toISOString(),
    '2026-10-12T05:00:00.000Z',
  );
  const sundayWinter = Date.parse('2026-10-25T01:30:00Z');
  assert.equal(
    new Date(model.nextWindowTime(sundayWinter, window)).toISOString(),
    '2026-10-26T06:00:00.000Z',
  );
  const inside = Date.parse('2026-10-12T06:00:35Z');
  assert.equal(model.nextWindowTime(inside, window), inside);
  assert.throws(() => model.resolveWindow({ timezone: 'UTC', start: '20:00', end: '08:00' }));
  assert.throws(() => model.resolveWindow({ timezone: 'wrong', start: '08:00', end: '20:00' }));
});

test('long global gaps keep the oldest due store first rather than starving later slugs', () => {
  const cfg = config();
  const state = model.initialize(model.blankState(), cfg, 0, () => 0);
  state.jobs['a/smoke'].nextAt = 2000;
  state.jobs['b/smoke'].nextAt = 1000;
  state.nextDispatchAt = 10000;
  assert.equal(model.nextJob(state, cfg, 10000).site, 'b');
});
test('an overdue job cannot start outside its current local window', () => {
  const cfg = config({
    defaults: {
      jobs: [
        {
          id: 'smoke',
          mode: 'smoke',
          intervalMinutes: [120, 240],
          window: { timezone: 'UTC', start: '08:00', end: '20:00' },
        },
      ],
    },
  });
  const state = model.initialize(
    model.blankState(),
    cfg,
    Date.parse('2026-10-09T08:00:00Z'),
    () => 0,
  );
  assert.equal(
    new Date(model.readyAt(state, cfg.jobs[0], Date.parse('2026-10-09T21:00:00Z'))).toISOString(),
    '2026-10-10T08:00:00.000Z',
  );
});

test('watchdog terminates a hung runner and records a timeout with a future schedule', async t => {
  const root = runtimeFixture(t, 'hang');
  const file = path.join(root, 'scheduler.json');
  const input = JSON.parse(fs.readFileSync(file));
  input.maxRunMinutes = 1;
  fs.writeFileSync(file, JSON.stringify(input));
  const preload = path.join(root, 'clock-fixture.cjs');
  fs.writeFileSync(
    preload,
    'const original = global.setTimeout; global.setTimeout = (fn, ms, ...args) => original(fn, ms === 60000 ? 100 : ms, ...args);\n',
  );
  const runtime = await startRuntime(t, root, { NODE_OPTIONS: '--require=' + preload });
  const stateFile = path.join(root, 'scheduler-state/schedule.json');
  await waitUntil(
    () =>
      fs.existsSync(stateFile) &&
      JSON.parse(fs.readFileSync(stateFile)).jobs['a/smoke']?.lastOutcome === 'timeout',
  );
  runtime.child.kill('SIGTERM');
  assert.equal((await runtime.exit).code, 0, runtime.output());
  const state = JSON.parse(fs.readFileSync(stateFile));
  assert.ok(state.jobs['a/smoke'].nextAt > Date.now());
  assert.equal(state.origins['https://a.test'].reason, 'timeout');
});

test('managed scheduler starts empty, reloads saved stores, and applies pause without restart', async t => {
  const root = runtimeFixture(t);
  const file = path.join(root, 'managed.json');
  const { emptyConfiguration } = require('./managed-config');
  const initial = emptyConfiguration();
  initial.scheduler.startupSpreadMinutes = 0;
  initial.scheduler.minGapMinutes = 0;
  fs.writeFileSync(file, JSON.stringify(initial));
  const runtime = await startRuntime(t, root, {}, ['--managed-config', file]);
  await waitUntil(() => runtime.output().includes('Started 0 jobs'));
  assert.equal(fs.existsSync(path.join(root, 'calls.jsonl')), false);
  const store = { slug: 'a', url: 'https://a.test', productHandle: 'one', productHandle2: 'two' };
  initial.sites.push(store);
  initial.scheduler.sites.a = {
    enabled: true,
    jobs: [{ id: 'smoke', mode: 'smoke', intervalMinutes: [60, 120] }],
  };
  const { atomicWrite } = require('./scheduler');
  atomicWrite(file, initial);
  await waitUntil(() => fs.existsSync(path.join(root, 'calls.jsonl')), 12000);
  initial.scheduler.sites.a.enabled = false;
  atomicWrite(file, initial);
  await waitUntil(() => /Applied configuration .*: 0 jobs/.test(runtime.output()), 12000);
  runtime.child.kill('SIGTERM');
  assert.equal((await runtime.exit).code, 0, runtime.output());
  assert.equal(
    fs.readFileSync(path.join(root, 'calls.jsonl'), 'utf8').trim().split('\n').length,
    1,
  );
});
