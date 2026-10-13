#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { loadSites } = require('./site-config');
const model = require('./scheduler-model');
const queueStore = require('./run-queue');
const { readConfiguration } = require('./managed-config');
const root = path.join(__dirname, '..');
function atomicWrite(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}
function processIdentity(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[19];
  } catch {
    return '';
  }
}
function acquireLock(directory, now = Date.now()) {
  const file = path.join(directory, 'scheduler.lock');
  const owner = {
    pid: process.pid,
    host: os.hostname(),
    identity: processIdentity(process.pid),
    token: randomUUID(),
    updatedAt: now,
  };
  try {
    fs.writeFileSync(file, JSON.stringify(owner), { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let previous;
    try {
      previous = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      throw new Error('Unreadable scheduler lock; inspect the state directory before removing it');
    }
    let alive = true;
    if (previous.host === owner.host) {
      try {
        process.kill(previous.pid, 0);
      } catch (error) {
        if (error.code === 'ESRCH') alive = false;
      }
      if (previous.identity && processIdentity(previous.pid) !== previous.identity) alive = false;
    } else alive = Number.isFinite(previous.updatedAt) && now - previous.updatedAt < 90000;
    if (alive) throw new Error('Another scheduler owns this state directory', { cause: error });
    fs.unlinkSync(file);
    fs.writeFileSync(file, JSON.stringify(owner), { flag: 'wx' });
  }
  function assertOwner() {
    if (JSON.parse(fs.readFileSync(file, 'utf8')).token !== owner.token)
      throw new Error('Scheduler lock ownership lost');
  }
  return {
    heartbeat() {
      assertOwner();
      owner.updatedAt = Date.now();
      fs.writeFileSync(file, JSON.stringify(owner));
    },
    release() {
      assertOwner();
      fs.unlinkSync(file);
    },
  };
}
function options(args) {
  const result = {
    config: path.join(root, 'scheduler.json'),
    sitesFile: path.join(root, 'sites.json'),
    stateDir: process.env.SCHEDULER_STATE_DIR || path.join(root, 'scheduler-state'),
    check: false,
    status: false,
  };
  const names = {
    '--config': 'config',
    '--sites-file': 'sitesFile',
    '--state-dir': 'stateDir',
    '--managed-config': 'managedConfig',
  };
  for (let i = 0; i < args.length; i++) {
    const [name, ...parts] = args[i].split('=');
    if (name === '--check' || name === '--status') {
      result[name.slice(2)] = true;
      continue;
    }
    if (!names[name]) throw new Error(`Unknown scheduler argument: ${name}`);
    const value = parts.length ? parts.join('=') : args[++i];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a path`);
    result[names[name]] = path.resolve(value);
  }
  return result;
}
function loadState(file) {
  return fs.existsSync(file)
    ? model.validateState(JSON.parse(fs.readFileSync(file, 'utf8')))
    : model.blankState();
}
function signalGroup(child, signal) {
  if (!child?.pid) return;
  try {
    process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
async function runChild(job, settings, control) {
  return new Promise(resolve => {
    const args = [
      settings.runnerFile || path.join(root, 'scripts/run-sites.js'),
      '--sites-file',
      settings.sitesFile,
      '--site',
      job.site,
      '--mode',
      job.mode,
      ...job.projects.map(project => `--project=${project}`),
    ];
    const child = spawn(process.execPath, args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        ...job.pacing,
        RATE_LIMIT_DIR: settings.limitDir,
        CONTROL_EVENTS_FILE: settings.eventsFile,
      },
    });
    for (const [stream, output] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr],
    ]) {
      stream.on('data', chunk => {
        output.write(chunk);
        if (settings.logFile) fs.appendFileSync(settings.logFile, chunk);
      });
    }
    let outcome = '';
    let killTimer;
    let settled = false;
    control.stopChild = reason => {
      if (outcome) return;
      outcome = reason;
      signalGroup(child, 'SIGTERM');
      killTimer = setTimeout(() => signalGroup(child, 'SIGKILL'), 15000);
    };
    const timer = setTimeout(() => control.stopChild('timeout'), job.maxRunMinutes * model.MINUTE);
    function settle(code, error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // A runner can exit before its browser descendants. Always clean its process group.
      signalGroup(child, 'SIGKILL');
      clearTimeout(killTimer);
      control.stopChild = null;
      if (error) console.error(`[scheduler] Cannot launch runner: ${error.message}`);
      resolve(outcome || (code === 0 ? 'passed' : 'failed'));
    }
    child.once('error', error => settle(null, error));
    child.once('exit', code => settle(code));
  });
}
async function main(args = process.argv.slice(2), { runnerFile } = {}) {
  if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
  const settings = options(args);
  settings.runnerFile = runnerFile;
  let managed = settings.managedConfig ? readConfiguration(settings.managedConfig) : null;
  let sites = managed
    ? managed.sites
    : loadSites(settings.sitesFile, process.env, { requireFile: true, requireHandles: true });
  let config = managed
    ? managed.config
    : model.resolveSchedule(JSON.parse(fs.readFileSync(settings.config, 'utf8')), sites);
  const stateFile = path.join(settings.stateDir, 'schedule.json');
  let state = loadState(stateFile);
  if (settings.check) {
    console.log(
      `Scheduler configuration valid: ${sites.length} stores, ${config.jobs.length} jobs. No store requests made.`,
    );
    return;
  }
  if (settings.status) {
    console.log(
      JSON.stringify(
        {
          running: state.running,
          jobs: config.jobs.map(job => ({
            site: job.site,
            id: job.id,
            mode: job.mode,
            projects: job.projects,
            nextAt: state.jobs[job.key]
              ? new Date(model.readyAt(state, job, Date.now())).toISOString()
              : null,
            lastOutcome: state.jobs[job.key]?.lastOutcome ?? null,
          })),
          origins: state.origins,
        },
        null,
        2,
      ),
    );
    return;
  }
  fs.mkdirSync(settings.stateDir, { recursive: true });
  const lock = acquireLock(settings.stateDir);
  settings.limitDir = path.join(settings.stateDir, 'rate-limits');
  fs.mkdirSync(settings.limitDir, { recursive: true });
  const control = { stopping: false, stopChild: null, wake: null };
  const stop = () => {
    control.stopping = true;
    control.wake?.();
    control.stopChild?.('interrupted');
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  function save() {
    atomicWrite(stateFile, state);
  }
  function ingestLimits() {
    let changed = false;
    for (const site of sites) {
      const file = path.join(settings.limitDir, `.rate-limit.${site.slug}.json`);
      if (
        fs.existsSync(file) &&
        model.applyRateLimit(
          state,
          site.url,
          fs.readFileSync(file, 'utf8'),
          config,
          Date.now(),
          site.slug,
        )
      ) {
        console.warn(
          `[scheduler] ${site.slug}: rate limited; cooling down until ${new Date(state.origins[site.url].blockedUntil).toISOString()}`,
        );
        changed = true;
      }
    }
    if (changed) save();
    return changed;
  }
  function heartbeat() {
    lock.heartbeat();
    atomicWrite(path.join(settings.stateDir, 'heartbeat.json'), {
      updatedAt: Date.now(),
      pid: process.pid,
      running: state.running,
      stopping: control.stopping,
    });
  }
  let heartbeatTimer;
  let commandTimer;
  const queueFile = path.join(settings.stateDir, 'runs.json');
  const runs = queueStore.readQueue(settings.stateDir);
  const logDirectory = path.join(settings.stateDir, 'run-logs');
  fs.mkdirSync(logDirectory, { recursive: true });
  function saveRuns() {
    atomicWrite(queueFile, runs);
  }
  function completeRun(status) {
    delete runs.active.job;
    delete runs.active.sites;
    runs.active.status = status;
    runs.active.finishedAt = Date.now();
    runs.history.unshift(runs.active);
    runs.history = runs.history.slice(0, 50);
    runs.active = null;
    saveRuns();
  }
  if (runs.active) completeRun('interrupted');
  // Forced runs go first (in submission order) and skip store cooldown and run gaps; a run that is already active is never interrupted.
  function moveForced(id) {
    const [run] = runs.pending.splice(
      runs.pending.findIndex(run => run.id === id),
      1,
    );
    const index = runs.pending.findIndex(run => !run.forced);
    runs.pending.splice(index < 0 ? runs.pending.length : index, 0, run);
  }
  function commands() {
    const directory = path.join(settings.stateDir, 'commands');
    if (!fs.existsSync(directory)) return;
    const files = fs.readdirSync(directory).filter(file => file.endsWith('.json'));
    const inputs = files
      .map(file => ({
        file,
        command: JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')),
      }))
      .sort(
        (a, b) => a.command.submittedAt - b.command.submittedAt || a.file.localeCompare(b.file),
      );
    for (const { file, command } of inputs) {
      if (
        command.action === 'enqueue' &&
        ![runs.active, ...runs.pending, ...runs.history].some(run => run?.id === command.run.id)
      ) {
        runs.pending.push(command.run);
        if (command.run.forced) moveForced(command.run.id);
      } else if (command.action === 'force') {
        const run = runs.pending.find(run => run.id === command.id);
        if (run) {
          run.forced = true;
          moveForced(run.id);
        }
      } else if (command.action === 'cancel') {
        if (runs.active?.id === command.id) {
          runs.active.status = 'stopping';
          control.stopChild?.('cancelled');
        } else {
          const index = runs.pending.findIndex(run => run.id === command.id);
          if (index >= 0) {
            const [run] = runs.pending.splice(index, 1);
            delete run.job;
            delete run.sites;
            runs.history.unshift({ ...run, status: 'cancelled', finishedAt: Date.now() });
            runs.history = runs.history.slice(0, 50);
          }
        }
      }
      saveRuns();
      fs.unlinkSync(path.join(directory, file));
    }
    if (inputs.length) control.wake?.();
  }
  function pollCommands() {
    try {
      commands();
    } catch (error) {
      console.error(`[scheduler] Queue: ${error.message}`);
      stop();
    }
  }
  try {
    // Read again after taking the lock, in case another scheduler just finished.
    state = loadState(stateFile);
    model.initialize(state, config, Date.now());
    save();
    ingestLimits();
    heartbeat();
    saveRuns();
    commandTimer = setInterval(pollCommands, 500);
    heartbeatTimer = setInterval(() => {
      try {
        heartbeat();
      } catch (error) {
        console.error(`[scheduler] ${error.message}`);
        stop();
        process.exitCode = 1;
      }
    }, 30000);
    console.log(
      `[scheduler] Started ${config.jobs.length} jobs across ${sites.length} stores; one run at a time. State: ${settings.stateDir}`,
    );
    while (!control.stopping) {
      if (settings.managedConfig) {
        try {
          const next = readConfiguration(settings.managedConfig);
          if (next.revision !== managed.revision) {
            managed = next;
            sites = next.sites;
            config = next.config;
            model.initialize(state, config, Date.now());
            save();
            console.log(
              `[scheduler] Applied configuration ${managed.revision.slice(0, 12)}: ${config.jobs.length} jobs`,
            );
          }
        } catch (error) {
          // Refuse new jobs while an externally edited configuration is invalid.
          console.error(`[scheduler] Configuration unavailable: ${error.message}`);
          await new Promise(resolve => {
            const timer = setTimeout(done, 5000);
            function done() {
              clearTimeout(timer);
              control.wake = null;
              resolve();
            }
            control.wake = done;
          });
          continue;
        }
      }
      commands();
      if (!config.jobs.length && !runs.pending.length) {
        await new Promise(resolve => {
          const timer = setTimeout(done, 5000);
          function done() {
            clearTimeout(timer);
            control.wake = null;
            resolve();
          }
          control.wake = done;
        });
        continue;
      }
      ingestLimits();
      const manual = runs.pending[0];
      const job = manual ? manual.job : model.nextJob(state, config, Date.now());
      if (manual && !state.origins[job.origin])
        state.origins[job.origin] = {
          blockedUntil: 0,
          rateLimitStreak: 0,
          failureStreak: 0,
          marker: '',
        };
      const due = manual
        ? manual.forced
          ? 0
          : Math.max(state.origins[job.origin].blockedUntil, state.nextDispatchAt)
        : model.readyAt(state, job, Date.now());
      if (manual && manual.eligibleAt !== due) {
        manual.eligibleAt = due;
        manual.waitReason =
          state.origins[job.origin].blockedUntil > Date.now()
            ? 'Store cooldown'
            : state.nextDispatchAt > Date.now()
              ? 'Pause between runs'
              : '';
        saveRuns();
      }
      if (due > Date.now()) {
        await new Promise(resolve => {
          const timer = setTimeout(
            done,
            Math.min(due - Date.now(), settings.managedConfig ? 5000 : 30000),
          );
          function done() {
            clearTimeout(timer);
            control.wake = null;
            resolve();
          }
          control.wake = done;
        });
        continue;
      }
      runs.active = manual
        ? runs.pending.shift()
        : {
            id: randomUUID(),
            source: 'scheduled',
            site: job.site,
            name: job.site,
            mode: job.mode,
            projects: job.projects,
            queuedAt: Date.now(),
          };
      runs.active.status = 'running';
      runs.active.startedAt = Date.now();
      saveRuns();
      state.running = { key: job.key, origin: job.origin, startedAt: Date.now() };
      save();
      console.log(`[scheduler] ${job.key}: starting ${job.mode}`);
      const before = state.origins[job.origin].marker;
      let runSettings = {
        ...settings,
        logFile: path.join(logDirectory, `${runs.active.id}.log`),
        eventsFile: path.join(logDirectory, `${runs.active.id}.events`),
      };
      if (settings.managedConfig) {
        const snapshot = path.join(settings.stateDir, 'run-sites.json');
        atomicWrite(
          snapshot,
          manual ? manual.sites : sites.map(({ settings: ignored, ...site }) => site),
        );
        runSettings = { ...runSettings, sitesFile: snapshot };
      }
      const outcome = await runChild(job, runSettings, control);
      ingestLimits();
      const rateLimited = before !== state.origins[job.origin].marker;
      if (manual) {
        const previous = state.jobs[job.key];
        model.finish(state, job, config, Date.now(), outcome, rateLimited);
        if (previous) state.jobs[job.key] = previous;
        else delete state.jobs[job.key];
      } else model.finish(state, job, config, Date.now(), outcome, rateLimited);
      completeRun(rateLimited ? 'rate-limit' : outcome);
      save();
      console.log(
        `[scheduler] ${job.key}: ${outcome}${manual ? '' : '; next eligible ' + new Date(model.readyAt(state, job, Date.now())).toISOString()}`,
      );
    }
  } finally {
    clearInterval(heartbeatTimer);
    clearInterval(commandTimer);
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
    lock.release();
    console.log('[scheduler] Stopped');
  }
}
if (require.main === module)
  main().catch(error => {
    console.error(`[scheduler] ${error.message}`);
    process.exitCode = 1;
  });
module.exports = { main, options, acquireLock, atomicWrite, loadState };
