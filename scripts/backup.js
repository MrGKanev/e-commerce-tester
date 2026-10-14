#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { acquireLock } = require('./scheduler');
const ROOTS = [
  'managed-config',
  'scheduler-state',
  'reports',
  'visual-baselines',
  'sites.json',
  'scheduler.json',
];
function digest(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function files(root, relative = '') {
  const result = [];
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Backup refuses symbolic links: ' + name);
    if (entry.isDirectory()) result.push(...files(root, name));
    else if (entry.isFile()) result.push(name);
    else throw new Error('Backup only accepts regular files');
  }
  return result;
}
function destinationPath(destination) {
  const absolute = path.resolve(destination);
  let parent = path.dirname(absolute);
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  return path.join(fs.realpathSync(parent), path.relative(parent, absolute));
}
function backup(source, destination) {
  source = fs.realpathSync(source);
  destination = destinationPath(destination);
  if (destination === source || destination.startsWith(source + path.sep))
    throw new Error('Choose a backup destination outside the installation');
  if (fs.existsSync(destination)) throw new Error('Backup destination already exists');
  const state = path.join(source, 'scheduler-state');
  fs.mkdirSync(state, { recursive: true });
  const lock = acquireLock(state);
  const staging = destination + '.tmp-' + randomUUID();
  try {
    fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
    const manifest = { version: 1, createdAt: new Date().toISOString(), files: {} };
    for (const name of ROOTS) {
      const from = path.join(source, name);
      if (!fs.existsSync(from)) continue;
      if (fs.lstatSync(from).isSymbolicLink()) throw new Error('Backup refuses symbolic links');
      const entries = fs.statSync(from).isDirectory() ? files(source, name) : [name];
      for (const relative of entries) {
        if (
          relative === 'scheduler-state/scheduler.lock' ||
          relative === 'scheduler-state/heartbeat.json' ||
          relative.includes('/.trash/') ||
          /\.tmp$/.test(relative)
        )
          continue;
        const target = path.join(staging, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        fs.copyFileSync(path.join(source, relative), target, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(target, 0o600);
        manifest.files[relative] = digest(target);
      }
    }
    for (const [relative, checksum] of Object.entries(manifest.files))
      if (digest(path.join(source, relative)) !== checksum)
        throw new Error('Files changed during backup; stop the control service and retry');
    fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2), {
      mode: 0o600,
    });
    fs.renameSync(staging, destination);
    return { files: Object.keys(manifest.files).length, destination };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    lock.release();
  }
}
function restore(source, destination) {
  source = fs.realpathSync(source);
  destination = destinationPath(destination);
  if (fs.existsSync(destination))
    throw new Error(
      'Restore requires a new, nonexistent destination; existing installations are never overwritten',
    );
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
  if (
    manifest.version !== 1 ||
    !manifest.files ||
    typeof manifest.files !== 'object' ||
    Array.isArray(manifest.files)
  )
    throw new Error('Invalid backup manifest');
  const stored = new Set(files(source));
  for (const [relative, checksum] of Object.entries(manifest.files)) {
    if (
      relative.includes('\\') ||
      relative.split('/').some(p => !p || p === '.' || p === '..') ||
      !ROOTS.includes(relative.split('/')[0]) ||
      !stored.has(relative) ||
      !/^[a-f0-9]{64}$/.test(checksum) ||
      digest(path.join(source, relative)) !== checksum
    )
      throw new Error('Backup path or checksum validation failed');
  }
  if (stored.size !== Object.keys(manifest.files).length + 1)
    throw new Error('Backup contains files outside its manifest');
  const staging = destination + '.tmp-' + randomUUID();
  try {
    fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
    for (const relative of Object.keys(manifest.files)) {
      const target = path.join(staging, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.copyFileSync(path.join(source, relative), target, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(target, 0o600);
    }
    fs.renameSync(staging, destination);
    return { files: Object.keys(manifest.files).length, destination };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
if (require.main === module) {
  try {
    const [command, source, destination] = process.argv.slice(2);
    if (!['create', 'restore'].includes(command) || !source || !destination)
      throw new Error('Usage: node scripts/backup.js create|restore SOURCE DESTINATION');
    console.log(JSON.stringify((command === 'create' ? backup : restore)(source, destination)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { backup, restore };
