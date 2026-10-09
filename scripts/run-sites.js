#!/usr/bin/env node
'use strict';

/**
 * run-sites.js
 * Orchestrates test runs for every site defined in sites.json.
 * Falls back to STORE_URL / PRODUCT_HANDLE env vars if sites.json is absent.
 *
 * Usage (via run.sh / package.json):
 *   node scripts/run-sites.js              # headless
 *   node scripts/run-sites.js --headed     # show browser
 *   node scripts/run-sites.js --debug      # step-through debugger
 */

const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root        = path.join(__dirname, '..');
const reportsDir  = path.join(root, 'reports');
let sitesFile = path.join(root, 'sites.json');
const extraArgs = process.argv.slice(2);
const { loadSites } = require('./site-config');
function takeOption(name) {
  const index = extraArgs.findIndex(arg => arg === name || arg.startsWith(name + '='));
  if (index < 0) return undefined;
  const inline = extraArgs[index].includes('=');
  const value = inline ? extraArgs[index].slice(name.length + 1) : extraArgs[index + 1];
  if (!value || value.startsWith('--')) die(`${name} requires a value`);
  extraArgs.splice(index, inline ? 1 : 2);
  return value;
}
const selectedSite = takeOption('--site');
const configuredFile = takeOption('--sites-file');
if (configuredFile) sitesFile = path.resolve(configuredFile);
const modeIndex = extraArgs.findIndex(arg => arg === '--mode' || arg.startsWith('--mode='));
const mode = modeIndex < 0 ? 'full' : extraArgs[modeIndex].includes('=') ? extraArgs[modeIndex].split('=')[1] : extraArgs[modeIndex + 1];
if (!['smoke', 'full', 'visual', 'content', 'audit', 'pages'].includes(mode)) die('Mode must be smoke, full, visual, content, audit or pages');
if (modeIndex >= 0) extraArgs.splice(modeIndex, extraArgs[modeIndex].includes('=') ? 1 : 2);
if (!extraArgs.some(arg => arg === '--grep' || arg.startsWith('--grep='))) extraArgs.push('--grep', '@' + mode);
if (!extraArgs.some(arg => arg === '--project' || arg.startsWith('--project='))) extraArgs.push('--project=Desktop Chrome');

// Native Node loader preserves explicitly provided environment variables.
if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));

// ── Load sites ───────────────────────────────────────────────────────────────

let sites;
try { sites = loadSites(sitesFile); } catch (error) { die(error.message); }
if (selectedSite) {
  sites = sites.filter(site => site.slug === selectedSite);
  if (!sites.length) die(`Unknown site slug: ${selectedSite}`);
}

// ── Run each site ────────────────────────────────────────────────────────────

let overallExit = 0;

banner(`Store Health Check  ·  ${sites.length} site${sites.length !== 1 ? 's' : ''}`);

for (const site of sites) {
  const slug    = site.slug || slugify(site.url.replace(/https?:\/\//, '').split('/')[0]);
  const name    = site.name || slug;
  const runDate = timestamp();

  console.log('');
  divider();
  console.log(`  Site    : ${name}`);
  console.log(`  URL     : ${site.url}`);
  console.log(`  Run     : ${runDate}`);
  divider();
  console.log('');

  const env = {
    ...process.env,
    STORE_URL:        site.url,
    SITE_SETTINGS_JSON: JSON.stringify(site.settings),
    RUN_MODE: mode,
    PAGE_INVENTORY_FILE: path.join(reportsDir, slug, runDate, 'page-inventory.json'),
    PRODUCT_HANDLE:   site.productHandle  || process.env.PRODUCT_HANDLE || 'zerno-z1',
    PRODUCT_HANDLE_2: site.productHandle2 || process.env.PRODUCT_HANDLE_2 || 'zerno-z2',
    SEARCH_TERM:      site.searchTerm     || slug,
    DISCOUNT_CODE:    site.discountCode ?? process.env.DISCOUNT_CODE ?? '',
    SITE_SLUG:        slug,
    TEST_RUN_DATE:    runDate,
  };

  const runDir = path.join(reportsDir, slug, runDate);
  fs.mkdirSync(runDir, { recursive: true });
  const metadataFile = path.join(runDir, 'run-metadata.json');
  // Write before spawning so setup failures and killed runs stay visible.
  writeMetadata(metadataFile, {
    schemaVersion: 1, phase: 'starting', startedAt: new Date().toISOString(),
    site: { name, slug, url: site.url },
    versions: { node: process.version },
    selection: { args: extraArgs },
    pacing: Object.fromEntries(Object.entries({ TEST_DELAY_MS: 5000, TEST_JITTER_MS: 3000, REQUEST_DELAY_MS: 2000, REQUEST_JITTER_MS: 2000 }).map(([key, fallback]) => [key, env[key] ?? fallback])),
  });

  const result = spawnSync('pnpm', ['exec', 'playwright', 'test', ...extraArgs], {
    env,
    stdio: 'inherit',
    cwd: root,
  });

  const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
  writeMetadata(metadataFile, {
    ...metadata, phase: 'finished', endedAt: metadata.endedAt || new Date().toISOString(),
    status: result.signal || [130, 143].includes(result.status) ? 'interrupted' : metadata.status || (result.status === 0 ? 'passed' : 'failed'),
    exitCode: result.status, signal: result.signal,
    errors: [...(metadata.errors || []), ...(result.error ? [result.error.message] : [])],
  });

  if (result.error) console.error(`Could not start Playwright: ${result.error.message}`);
  if ((result.status ?? 1) !== 0) {
    overallExit = 1;
    console.log(`\n  ✗ ${name} — some tests failed`);
  } else {
    console.log(`\n  ✓ ${name} — all tests passed`);
  }
}

// ── Prune old reports (keep last 30 per site) ─────────────────────────────────

if (fs.existsSync(reportsDir)) {
  for (const entry of fs.readdirSync(reportsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const siteDir = path.join(reportsDir, entry.name);
    const runs = fs.readdirSync(siteDir)
      .filter(d => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}(?:-\d{2}-\d{3})?$/.test(d))
      .sort()
      .reverse();
    for (const old of runs.slice(30)) {
      fs.rmSync(path.join(siteDir, old), { recursive: true, force: true });
    }
  }
}

// ── Update dashboard ─────────────────────────────────────────────────────────

console.log('');
divider();
console.log('  Updating dashboard...');
try {
  execSync('node scripts/update-history.js', { cwd: root, stdio: 'inherit' });
} catch {
  console.log('  ⚠  Could not update dashboard (non-fatal)');
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('');
banner(
  overallExit === 0
    ? `✓ All ${sites.length} site${sites.length !== 1 ? 's' : ''} passed!`
    : '✗ Some tests failed — check the dashboard',
);
console.log('  Dashboard : reports/dashboard.html');
console.log('══════════════════════════════════════════');
console.log('');

process.exit(overallExit);

// ── Helpers ──────────────────────────────────────────────────────────────────

function slugify(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function timestamp() {
  return new Date().toISOString().replace('T', '_').replace(/[:.]/g, '-').replace('Z', '');
}

function banner(msg) {
  console.log('══════════════════════════════════════════');
  console.log(`  ${msg}`);
  console.log('══════════════════════════════════════════');
}

function divider() {
  console.log('──────────────────────────────────────────');
}

function die(msg) {
  console.error(`\nError: ${msg}\n`);
  process.exit(1);
}


function writeMetadata(file, metadata) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(metadata, null, 2));
  fs.renameSync(file + '.tmp', file);
}
