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
const sitesFile   = path.join(root, 'sites.json');
const extraArgs   = process.argv.slice(2);

// ── Load sites ───────────────────────────────────────────────────────────────

let sites;

if (fs.existsSync(sitesFile)) {
  try {
    sites = JSON.parse(fs.readFileSync(sitesFile, 'utf8'));
  } catch (err) {
    die(`sites.json is not valid JSON: ${err.message}`);
  }
} else {
  // Backwards-compat: fall back to .env / environment variables
  const url  = process.env.STORE_URL || 'https://zerno.co';
  const slug = slugify(url.replace(/https?:\/\//, '').split('/')[0]);
  sites = [{
    name:          slug,
    slug,
    url,
    productHandle:  process.env.PRODUCT_HANDLE  || 'zerno-z1',
    productHandle2: process.env.PRODUCT_HANDLE_2 || 'zerno-z2',
    searchTerm:     process.env.SEARCH_TERM      || slug,
  }];
  console.log('ℹ  sites.json not found — using STORE_URL env var');
}

if (!Array.isArray(sites) || sites.length === 0) die('sites.json must be a non-empty array');

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
    PRODUCT_HANDLE:   site.productHandle  || '',
    PRODUCT_HANDLE_2: site.productHandle2 || '',
    SEARCH_TERM:      site.searchTerm     || slug,
    SITE_SLUG:        slug,
    TEST_RUN_DATE:    runDate,
  };

  const result = spawnSync('pnpm', ['exec', 'playwright', 'test', ...extraArgs], {
    env,
    stdio: 'inherit',
    cwd: root,
  });

  if ((result.status ?? 1) !== 0) {
    overallExit = 1;
    console.log(`\n  ✗ ${name} — some tests failed`);
  } else {
    console.log(`\n  ✓ ${name} — all tests passed`);
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

// ── Prune old reports (keep last 30 per site) ─────────────────────────────────

if (fs.existsSync(reportsDir)) {
  for (const entry of fs.readdirSync(reportsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const siteDir = path.join(reportsDir, entry.name);
    const runs = fs.readdirSync(siteDir)
      .filter(d => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}$/.test(d))
      .sort()
      .reverse();
    for (const old of runs.slice(30)) {
      fs.rmSync(path.join(siteDir, old), { recursive: true, force: true });
    }
  }
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
  return new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
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
