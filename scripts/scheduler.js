#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { loadSites } = require('./site-config');
const model = require('./scheduler-model');
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
    if (alive) throw new Error('Another scheduler owns this state directory');
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
      path.join(root, 'scripts/run-sites.js'),
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
      stdio: 'inherit',
      detached: process.platform !== 'win32',
      env: { ...process.env, ...job.pacing, RATE_LIMIT_DIR: settings.limitDir },
    });
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
async function main(args = process.argv.slice(2)) {
  if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
  const settings = options(args);
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
  try {
    // Read again after taking the lock, in case another scheduler just finished.
    state = loadState(stateFile);
    model.initialize(state, config, Date.now());
    save();
    ingestLimits();
    heartbeat();
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
      if (!config.jobs.length) {
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
      const job = model.nextJob(state, config, Date.now());
      const due = model.readyAt(state, job, Date.now());
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
      state.running = { key: job.key, origin: job.origin, startedAt: Date.now() };
      save();
      console.log(`[scheduler] ${job.key}: starting ${job.mode}`);
      const before = state.origins[job.origin].marker;
      let runSettings = settings;
      if (settings.managedConfig) {
        const snapshot = path.join(settings.stateDir, 'run-sites.json');
        atomicWrite(
          snapshot,
          sites.map(({ settings: ignored, ...site }) => site),
        );
        runSettings = { ...settings, sitesFile: snapshot };
      }
      const outcome = await runChild(job, runSettings, control);
      ingestLimits();
      const rateLimited = before !== state.origins[job.origin].marker;
      model.finish(state, job, config, Date.now(), outcome, rateLimited);
      save();
      console.log(
        `[scheduler] ${job.key}: ${state.jobs[job.key].lastOutcome}; next eligible ${new Date(model.readyAt(state, job, Date.now())).toISOString()}`,
      );
    }
  } finally {
    clearInterval(heartbeatTimer);
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
