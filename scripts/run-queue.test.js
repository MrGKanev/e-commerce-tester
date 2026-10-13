'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { createControlServer } = require('./control-server');
const { emptyConfiguration } = require('./managed-config');
const { readQueue, submit } = require('./run-queue');
async function waitFor(check) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(50);
  }
  throw new Error('Timed out waiting for queue');
}
async function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'run-queue-'));
  const configFile = path.join(directory, 'config.json');
  const stateDir = path.join(directory, 'state');
  fs.mkdirSync(stateDir);
  const config = emptyConfiguration();
  config.scheduler.minGapMinutes = 0;
  config.scheduler.startupSpreadMinutes = 0;
  config.sites = [
    { slug: 'shop', url: 'https://example.test', productHandle: 'one', productHandle2: 'two' },
  ];
  config.scheduler.sites.shop = { enabled: false };
  fs.writeFileSync(configFile, JSON.stringify(config));
  const server = createControlServer({
    configFile,
    stateDir,
    reportsDir: path.join(directory, 'reports'),
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { token } = await (await fetch(origin + '/api/config')).json();
  const post = (endpoint, body, headers = {}) =>
    fetch(origin + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Control-Token': token, ...headers },
      body: JSON.stringify(body),
    });
  let child;
  t.after(async () => {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise(resolve => child.once('exit', resolve));
    }
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const runnerFile = path.join(directory, 'runner.js');
  // A local process fixture exercises group cleanup without contacting a store.
  fs.writeFileSync(
    runnerFile,
    `
    const fs = require('node:fs');
    const { spawn } = require('node:child_process');
    const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    fs.writeFileSync(${JSON.stringify(path.join(directory, 'descendant.pid'))}, String(descendant.pid));
    console.log('fixture runner started');
    fs.appendFileSync(process.env.CONTROL_EVENTS_FILE, JSON.stringify({ type: 'test', title: 'Local fixture', total: 1, completed: 0, time: Date.now() }) + '\\n');
    setInterval(() => {}, 1000);
  `,
  );
  function start() {
    child = spawn(
      process.execPath,
      [
        '-e',
        `require(${JSON.stringify(path.join(__dirname, 'scheduler.js'))}).main(${JSON.stringify(['--managed-config', configFile, '--state-dir', stateDir])}, { runnerFile: ${JSON.stringify(runnerFile)} }).catch(error => { console.error(error); process.exit(1); });`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    child.stdout.on('data', chunk => {
      output += chunk;
    });
    child.stderr.on('data', chunk => {
      output += chunk;
    });
    child.on('exit', code => {
      if (code) console.error(output);
    });
  }
  const enqueue = async () => {
    const response = await post('/api/runs', {
      site: 'shop',
      mode: 'smoke',
      projects: ['Desktop Chrome'],
    });
    assert.equal(response.status, 202);
    return (await response.json()).id;
  };
  return { directory, stateDir, configFile, config, post, origin, start, enqueue };
}
test('manual API validates saved stores, modes, projects and same-origin token', async t => {
  const f = await setup(t);
  const input = { site: 'shop', mode: 'smoke', projects: ['Desktop Chrome'] };
  assert.equal((await f.post('/api/runs', input, { 'X-Control-Token': 'wrong' })).status, 403);
  assert.equal(
    (await f.post('/api/runs', input, { Origin: 'https://elsewhere.test' })).status,
    403,
  );
  for (const value of [
    { site: 'missing' },
    { mode: '--headed' },
    { projects: ['bad'] },
    { projects: [] },
  ])
    assert.equal((await f.post('/api/runs', { ...input, ...value })).status, 400);
  await f.enqueue();
  assert.equal(fs.readdirSync(path.join(f.stateDir, 'commands')).length, 1);
});
test('one worker preserves FIFO, removes waiting tasks and stops active process groups', async t => {
  const f = await setup(t);
  const first = await f.enqueue(),
    second = await f.enqueue(),
    third = await f.enqueue();
  f.start();
  await waitFor(() => readQueue(f.stateDir).active?.id === first);
  await waitFor(() => fs.existsSync(path.join(f.directory, 'descendant.pid')));
  const descendant = Number(fs.readFileSync(path.join(f.directory, 'descendant.pid')));
  assert.deepEqual(
    readQueue(f.stateDir).pending.map(run => run.id),
    [second, third],
  );
  const detail = await waitFor(async () => {
    const value = await (await fetch(f.origin + '/api/runs/details?id=' + first)).json();
    return value.events?.length ? value : null;
  });
  assert.equal(detail.events[0].title, 'Local fixture');
  assert.match(detail.log, /fixture runner started/);
  assert.equal(detail.run.job, undefined);
  assert.equal((await f.post('/api/runs/cancel', { id: second })).status, 202);
  await waitFor(() =>
    readQueue(f.stateDir).history.some(run => run.id === second && run.status === 'cancelled'),
  );
  assert.equal((await f.post('/api/runs/cancel', { id: first })).status, 202);
  await waitFor(() => readQueue(f.stateDir).active?.id === third);
  await waitFor(() => {
    try {
      process.kill(descendant, 0);
      return false;
    } catch (error) {
      return error.code === 'ESRCH';
    }
  });
  assert.equal(readQueue(f.stateDir).history.find(run => run.id === first).status, 'cancelled');
  assert.equal((await f.post('/api/runs/cancel', { id: second })).status, 409);
  assert.equal((await f.post('/api/runs/cancel', { id: third })).status, 202);
  await waitFor(() => !readQueue(f.stateDir).active);
});
test('queued manual runs survive restarts and wait for cooldown', async t => {
  const f = await setup(t);
  const state = {
    schemaVersion: 1,
    jobs: {},
    origins: {
      'https://example.test': {
        blockedUntil: Date.now() + 60000,
        rateLimitStreak: 1,
        failureStreak: 0,
        marker: 'limit',
      },
    },
    nextDispatchAt: 0,
    running: null,
  };
  fs.writeFileSync(path.join(f.stateDir, 'schedule.json'), JSON.stringify(state));
  const id = await f.enqueue();
  f.start();
  await waitFor(() => readQueue(f.stateDir).pending[0]?.waitReason === 'Store cooldown');
  assert.equal(readQueue(f.stateDir).active, null);
  assert.equal(readQueue(f.stateDir).pending[0].id, id);
  submit(f.stateDir, { action: 'cancel', id });
  await waitFor(() => readQueue(f.stateDir).pending.length === 0);
});
