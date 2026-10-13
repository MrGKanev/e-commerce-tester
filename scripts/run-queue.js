'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const model = require('./scheduler-model');
let lastSubmission = 0;
function readQueue(directory) {
  const file = path.join(directory, 'runs.json');
  return fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : { active: null, pending: [], history: [] };
}
function submit(directory, command) {
  const commands = path.join(directory, 'commands');
  fs.mkdirSync(commands, { recursive: true });
  const id = randomUUID();
  lastSubmission = Math.max(Date.now(), lastSubmission + 1);
  const temporary = path.join(commands, `${id}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify({ ...command, submittedAt: lastSubmission }));
  fs.renameSync(temporary, path.join(commands, `${id}.json`));
  return id;
}
function manualRun(configuration, input) {
  const site = configuration.sites.find(site => site.slug === input.site);
  if (!site) throw new Error('Choose a saved store');
  // Resolve through the same validator, even when automatic scheduling is paused.
  const scheduler = structuredClone(configuration.data.scheduler);
  scheduler.sites = {
    [site.slug]: {
      enabled: true,
      pacing: scheduler.sites?.[site.slug]?.pacing,
      jobs: [{ id: 'manual', mode: input.mode, projects: input.projects, intervalMinutes: [1, 1] }],
    },
  };
  const job = model.resolveSchedule(scheduler, [site]).jobs[0];
  return {
    id: randomUUID(),
    source: 'manual',
    site: site.slug,
    name: site.name || site.slug,
    mode: job.mode,
    projects: job.projects,
    queuedAt: Date.now(),
    status: 'queued',
    forced: input.immediate === true,
    job,
    sites: configuration.sites.map(({ settings: _settings, ...value }) => value),
  };
}
function tail(file, bytes = 24000) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const buffer = Buffer.alloc(Math.min(bytes, size));
      fs.readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length));
      const value = buffer.toString('utf8');
      return size > bytes ? value.slice(value.indexOf('\n') + 1) : value;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}
function details(directory, id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid run ID');
  const queue = publicQueue(directory);
  const run = [queue.active, ...queue.pending, ...queue.history].find(run => run?.id === id);
  if (!run) throw new Error('Run not found');
  const events = tail(path.join(directory, 'run-logs', `${id}.events`), 64000)
    .split('\n')
    .flatMap(line => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  return { run, events, log: tail(path.join(directory, 'run-logs', `${id}.log`)) };
}
function publicQueue(directory) {
  const queue = readQueue(directory);
  const summary = run => {
    if (!run) return null;
    const value = { ...run };
    delete value.job;
    delete value.sites;
    return value;
  };
  return {
    active: summary(queue.active),
    pending: queue.pending.map(summary),
    history: queue.history.map(summary),
  };
}
module.exports = { readQueue, publicQueue, submit, manualRun, details };
