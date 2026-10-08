#!/usr/bin/env node
'use strict';

/**
 * update-history.js
 * Scans reports/{site-slug}/{date}/ directories, reads results.json from each,
 * and regenerates reports/dashboard.html with a tabbed multi-site summary.
 *
 * Report structure:
 *   reports/
 *   ├── dashboard.html
 *   ├── {slug}/
 *   │   └── {date}/
 *   │       ├── index.html
 *   │       └── results.json
 *   └── ...
 */

const fs   = require('fs');
const path = require('path');
const { summarizeRun, percent, compareRuns } = require('./report-model');

const reportsDir = path.join(__dirname, '..', 'reports');

// ── Load site metadata from sites.json (for name / URL display) ──────────────

function loadSiteMeta() {
  const sitesFile = path.join(__dirname, '..', 'sites.json');
  if (!fs.existsSync(sitesFile)) return {};
  try {
    const arr = JSON.parse(fs.readFileSync(sitesFile, 'utf8'));
    const map = {};
    for (const s of arr) {
      if (s.slug) map[s.slug] = { name: s.name || s.slug, url: s.url || '' };
    }
    return map;
  } catch { return {}; }
}

// ── Collect all sites ────────────────────────────────────────────────────────

function collectAllSites() {
  const meta  = loadSiteMeta();
  const sites = [];

  if (!fs.existsSync(reportsDir)) return sites;

  for (const entry of fs.readdirSync(reportsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    // Skip dated dirs at the root (legacy single-site runs)
    if (/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}(?:-\d{2}-\d{3})?$/.test(entry.name)) continue;

    const slug     = entry.name;
    const siteDir  = path.join(reportsDir, slug);
    const runs     = collectRunsFromDir(siteDir, `${slug}/`);
    if (runs.length === 0) continue;

    runs.sort((a, b) => b.dir.localeCompare(a.dir));
    runs.forEach((run, index) => { run.changes = compareRuns(run, runs[index + 1]); });
    const latestMetadata = runs.reduce((latest, run) => !latest || run.dir > latest.dir ? run : latest, null)?.metadata.site || {};
    const m = meta[slug] || latestMetadata;
    sites.push({
      slug,
      name: m.name || formatName(slug),
      url:  m.url  || '',
      runs: runs.sort((a, b) => b.dir.localeCompare(a.dir)),
    });
  }

  const direct = collectRunsFromDir(reportsDir, '');
  direct.sort((a, b) => b.dir.localeCompare(a.dir));
  direct.forEach((run, index) => { run.changes = compareRuns(run, direct[index + 1]); });
  if (direct.length) sites.push({ slug: 'direct-runs', name: 'Direct runs (legacy)', url: '', runs: direct.sort((a, b) => b.dir.localeCompare(a.dir)) });
  return sites.sort((a, b) => a.name.localeCompare(b.name));
}

function readSpelling(file) {
  if (!fs.existsSync(file)) return null;
  try {
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!report || !Array.isArray(report.findings)) throw new Error('Invalid spelling report');
    return report;
  } catch (error) { return { findings: [], unsupportedLanguages: [], error: error.message }; }
}

function collectRunsFromDir(dir, relPrefix) {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter(d => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}(?:-\d{2}-\d{3})?$/.test(d))
    .map(d => {
      const runDir = path.join(dir, d);
      const metadataPath = path.join(runDir, 'run-metadata.json');
      const resultsPath = path.join(runDir, 'results.json');
      let results = {}, metadata = {}, issue = null;
      try {
        if (fs.existsSync(metadataPath)) {
          metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
          if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Expected a metadata object');
        }
      } catch (error) { metadata = {}; issue = `Unreadable metadata: ${error.message}`; }
      try {
        if (fs.existsSync(resultsPath)) {
          results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
          if (!results || typeof results !== 'object' || Array.isArray(results) || (results.suites && !Array.isArray(results.suites))) throw new Error('Expected a results object with a suite array');
        }
        else issue = 'Final results.json is missing; execution has no final report';
      } catch (error) { results = {}; issue = `Unreadable results.json: ${error.message}`; }
      const htmlRelative = fs.existsSync(path.join(runDir, 'html', 'index.html')) ? 'html/index.html' :
        fs.existsSync(path.join(runDir, 'index.html')) ? 'index.html' : null;
      const prefix = './' + [...relPrefix.split('/').filter(Boolean), d].map(encodeURIComponent).join('/') + '/';
      return {
        ...summarizeRun(results, metadata, issue),
        spelling: readSpelling(path.join(runDir, 'spelling.json')),
        artifactLink: file => {
          let target = path.isAbsolute(file) ? file : path.resolve(runDir, file);
          if (!fs.existsSync(target) && results.config?.projects?.[0]?.outputDir) target = path.resolve(runDir, path.relative(path.dirname(results.config.projects[0].outputDir), file));
          const relative = path.relative(reportsDir, target);
          return !relative.startsWith('..') && !path.isAbsolute(relative) && fs.existsSync(target) ? './' + relative.split(path.sep).map(encodeURIComponent).join('/') : null;
        },
        dir: d, date: formatDate(d),
        reportLink: htmlRelative ? prefix + htmlRelative : null,
        metadataLink: fs.existsSync(metadataPath) ? prefix + 'run-metadata.json' : null,
        resultsLink: fs.existsSync(resultsPath) ? prefix + 'results.json' : null,
      };
    })
    .filter(Boolean);
}

// ── Main ─────────────────────────────────────────────────────────────────────

const sites    = collectAllSites();
const generated = new Date().toLocaleString('bg-BG', { timeZone: 'Europe/Sofia' });

const html = buildDashboard(sites, generated);
fs.mkdirSync(reportsDir, { recursive: true });
fs.writeFileSync(path.join(reportsDir, 'dashboard.html'), html, 'utf8');
console.log(`✓ Dashboard updated → reports/dashboard.html (${sites.length} site${sites.length !== 1 ? 's' : ''})`);

// ── HTML builder ─────────────────────────────────────────────────────────────

function buildDashboard(sites, generated) {
  const statuses = sites.map(site => site.runs[0]?.status);
  const lastStatus = statuses.some(status => ['failed', 'global-errors'].includes(status)) ? '#f87171' :
    statuses.length && statuses.every(status => status === 'passed') ? '#4ade80' :
    statuses.some(status => ['flaky', 'interrupted', 'incomplete'].includes(status)) ? '#fbbf24' : '#94a3b8';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Store Health Dashboard</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg:       #f0f2f5;
      --surface:  #ffffff;
      --border:   #e4e7ec;
      --text:     #111827;
      --muted:    #6b7280;
      --green:    #16a34a;
      --green-bg: #dcfce7;
      --red:      #dc2626;
      --red-bg:   #fee2e2;
      --amber:    #d97706;
      --blue:     #2563eb;
      --blue-bg:  #dbeafe;
      --navy:     #0f172a;
      --radius:   10px;
    }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }

    /* ── Top bar ── */
    .topbar { background: var(--navy); color: #f8fafc; padding: 0 32px; height: 56px; display: flex; align-items: center; justify-content: space-between; }
    .topbar-title { font-size: 0.95rem; font-weight: 600; letter-spacing: .02em; display: flex; align-items: center; gap: 10px; }
    .topbar-title .dot { width: 8px; height: 8px; border-radius: 50%; background: ${lastStatus}; box-shadow: 0 0 6px ${lastStatus}; flex-shrink: 0; }
    .topbar-meta { font-size: 0.78rem; color: #94a3b8; white-space: nowrap; }

    /* ── Tabs ── */
    .tab-nav { background: var(--surface); border-bottom: 1px solid var(--border); padding: 0 32px; display: flex; gap: 0; overflow-x: auto; }
    .tab-btn { background: none; border: none; border-bottom: 2px solid transparent; padding: 14px 18px; font-size: 0.875rem; font-weight: 500; color: var(--muted); cursor: pointer; white-space: nowrap; transition: color .15s, border-color .15s; display: flex; align-items: center; gap: 7px; }
    .tab-btn:hover { color: var(--text); }
    .tab-btn.active { color: var(--blue); border-bottom-color: var(--blue); }
    .tab-pip { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
    .tab-pip.ok { background: var(--green); }
    .tab-pip.ko { background: var(--red); }
    .tab-pip.warn { background: var(--amber); }
    .tab-pip.na { background: #d1d5db; }

    /* ── Tab panels ── */
    .tab-pane { display: none; }
    .tab-pane.active { display: block; }
    .page { max-width: 1100px; margin: 0 auto; padding: 28px 24px 48px; }

    /* ── Section labels ── */
    .section-label { font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-bottom: 12px; }

    /* ── Stat cards ── */
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; margin-bottom: 28px; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px 22px 18px; }
    .card-value { font-size: 2.2rem; font-weight: 700; line-height: 1; letter-spacing: -.02em; }
    .card-label { font-size: 0.75rem; color: var(--muted); margin-top: 5px; text-transform: uppercase; letter-spacing: .05em; }
    .card-sub { font-size: 0.75rem; color: var(--muted); margin-top: 8px; }
    .c-green { color: var(--green); } .c-red { color: var(--red); } .c-blue { color: var(--blue); } .c-amber { color: var(--amber); } .c-muted { color: var(--muted); }
    .rate-bar-wrap { margin-top: 10px; height: 4px; background: var(--border); border-radius: 9px; overflow: hidden; }
    .rate-bar { height: 100%; border-radius: 9px; }
    .rate-bar.green { background: var(--green); } .rate-bar.amber { background: var(--amber); } .rate-bar.red { background: var(--red); }

    /* ── Site grid (All Sites tab) ── */
    .site-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; margin-bottom: 28px; }
    .site-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px 22px; cursor: pointer; transition: box-shadow .15s, border-color .15s; }
    .site-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,.08); border-color: #c7cdd6; }
    .site-card-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
    .site-card-name { font-weight: 600; font-size: 0.95rem; }
    .site-card-url { font-size: 0.78rem; color: var(--muted); margin-bottom: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .site-card-stats { display: flex; gap: 16px; font-size: 0.8rem; }
    .site-card-stat { display: flex; flex-direction: column; gap: 2px; }
    .site-card-stat-val { font-weight: 600; }
    .site-card-stat-lbl { color: var(--muted); font-size: 0.7rem; text-transform: uppercase; letter-spacing: .04em; }

    /* ── Trend ── */
    .trend-wrap { overflow-x: auto; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 22px; margin-bottom: 28px; }
    .trend-label { font-size: 0.78rem; color: var(--muted); margin-bottom: 10px; }
    .trend-bars { display: flex; align-items: flex-end; gap: 5px; height: 52px; }
    .trend-bar { width: 24px; flex-shrink: 0; border-radius: 4px 4px 0 0; min-height: 4px; cursor: default; transition: opacity .15s; }
    .trend-bar:hover { opacity: .75; }
    .trend-bar.warn { background: var(--amber); } .trend-bar.na { background: #94a3b8; }
    .trend-bar.ok { background: var(--green); } .trend-bar.ko { background: var(--red); }
    .trend-dates { display: flex; gap: 5px; margin-top: 5px; border-top: 1px solid var(--border); padding-top: 5px; }
    .trend-date { width: 24px; flex-shrink: 0; font-size: 0.58rem; color: var(--muted); text-align: center; overflow: hidden; white-space: nowrap; }
    .trend-empty { color: var(--muted); font-size: 0.85rem; }

    /* ── Table ── */
    .table-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
    table { width: 100%; border-collapse: collapse; }
    thead th { background: #f8fafc; text-align: left; font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); padding: 11px 16px; border-bottom: 1px solid var(--border); }
    tbody td { padding: 13px 16px; border-bottom: 1px solid #f3f4f6; font-size: 0.875rem; vertical-align: middle; }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:hover td { background: #fafbfc; }
    .badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; white-space: nowrap; }
    .badge.pass { background: var(--green-bg); color: var(--green); } .badge.fail { background: var(--red-bg); color: var(--red); }
    .badge.warn { background: #fef3c7; color: var(--amber); } .badge.neutral { background: #e5e7eb; color: var(--muted); }
    .badge-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
    .badge.warn .badge-dot { background: var(--amber); } .badge.neutral .badge-dot { background: var(--muted); }
    .badge.pass .badge-dot { background: var(--green); } .badge.fail .badge-dot { background: var(--red); }
    .counts { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .cnt { font-size: 0.82rem; font-weight: 500; }
    .cnt.p { color: var(--green); } .cnt.f { color: var(--red); } .cnt.s { color: var(--amber); } .cnt.t { color: var(--muted); font-weight: 400; }
    details { margin-top: 2px; }
    summary { font-size: 0.78rem; color: #9ca3af; cursor: pointer; user-select: none; list-style: none; display: inline-flex; align-items: center; gap: 4px; }
    summary::-webkit-details-marker { display: none; }
    summary::before { content: '▸'; font-size: 0.7rem; }
    details[open] summary::before { content: '▾'; }
    .suite-list { margin-top: 6px; display: flex; flex-direction: column; gap: 3px; padding-left: 2px; }
    .suite-row { display: flex; align-items: center; gap: 7px; font-size: 0.78rem; }
    .s-pip { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
    .s-pip.ok { background: var(--green); } .s-pip.ko { background: var(--red); } .s-pip.sk { background: var(--amber); }
    .s-name { color: #374151; } .s-score { color: #9ca3af; font-size: 0.72rem; }

    .metric-note { font-size: .8rem; color: var(--muted); margin: 0 0 24px; line-height: 1.6; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 260px; overflow: auto; background: #f8fafc; padding: 10px; margin: 8px 0; font-size: .75rem; }
    details p { margin: 6px 0; font-size: .78rem; }
    .scenario { margin: 8px 0; padding: 8px; border-left: 2px solid var(--border); }
    .table-wrap { overflow-x: auto; } table { min-width: 820px; }
    a { color: var(--blue); text-decoration: none; font-weight: 500; }
    a:hover { text-decoration: underline; }
    .empty-state { text-align: center; padding: 64px 32px; color: var(--muted); }
    .empty-state p { margin-top: 8px; font-size: 0.9rem; }
    .footer { color: #9ca3af; font-size: 0.75rem; margin-top: 24px; text-align: center; }
    .footer code { background: var(--border); padding: 1px 5px; border-radius: 4px; font-size: 0.72rem; }

    @media (max-width: 600px) {
      .topbar { padding: 0 16px; } .topbar-meta { display: none; }
      .tab-nav { padding: 0 16px; }
      .page { padding: 20px 16px 40px; }
    }
  </style>
</head>
<body>

<div class="topbar">
  <div class="topbar-title">
    <span class="dot"></span>
    Store Health Dashboard
  </div>
  <div class="topbar-meta">Generated: ${generated}</div>
</div>

<nav class="tab-nav">
  <button class="tab-btn active" data-tab="all" onclick="showTab('all')">
    All Sites
    <span style="background:var(--blue-bg);color:var(--blue);font-size:.7rem;padding:1px 7px;border-radius:999px;font-weight:600">${sites.length}</span>
  </button>
  ${sites.map(s => {
    const last = s.runs[0];
    const color = statusInfo(last)[1];
    const pip = color === 'pass' ? 'ok' : color === 'fail' ? 'ko' : color === 'warn' ? 'warn' : 'na';
    return `<button class="tab-btn" data-tab="${escHtml(s.slug)}" onclick="showTab(this.dataset.tab)">
    <span class="tab-pip ${pip}"></span>${escHtml(s.name)}
  </button>`;
  }).join('\n  ')}
</nav>

<!-- ══ All Sites tab ═══════════════════════════════════════════════════════ -->
<div class="tab-pane active" id="tab-all">
  <div class="page">
    ${sites.length === 0 ? `
    <div class="empty-state">
      <strong>No runs yet</strong>
      <p>Run <code>pnpm test</code> to get started, then check back here.</p>
    </div>` : `
    ${buildOverviewCards(sites)}
    <div class="section-label">Sites</div>
    <div class="site-grid">
      ${sites.map(s => buildSiteCard(s)).join('\n      ')}
    </div>`}
    <div class="footer">Generated by <code>scripts/update-history.js</code> · <a href="https://playwright.dev" target="_blank">Playwright</a></div>
  </div>
</div>

<!-- ══ Per-site tabs ════════════════════════════════════════════════════════ -->
${sites.map(s => `
<div class="tab-pane" id="tab-${escHtml(s.slug)}">
  <div class="page">
    ${buildSitePanel(s)}
    <div class="footer">Generated by <code>scripts/update-history.js</code> · <a href="https://playwright.dev" target="_blank">Playwright</a></div>
  </div>
</div>`).join('')}

<script>
  function showTab(id) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + id));
  }
</script>

</body>
</html>`;
}

// ── Overview panel (All Sites tab) ───────────────────────────────────────────

function statusInfo(run) {
  return {
    passed: ['Passed', 'pass'], failed: ['Failed', 'fail'], flaky: ['Flaky', 'warn'],
    empty: ['No tests', 'neutral'], interrupted: ['Interrupted', 'warn'],
    'global-errors': ['Global errors', 'fail'], incomplete: ['Incomplete', 'warn'],
    'not-applicable': ['No applicable tests', 'neutral'],
  }[run?.status] || ['Unknown', 'neutral'];
}

function statusBadge(run) {
  const [label, color] = statusInfo(run);
  return `<span class="badge ${color}"><span class="badge-dot"></span>${label}</span>`;
}

function metricValue(value) { return value === null ? '—' : `${value}%`; }

function metricCard(value, label, detail) {
  return `<div class="card"><div class="card-value c-blue">${escHtml(value)}</div><div class="card-label">${label}</div><div class="card-sub">${detail}</div></div>`;
}

function buildOverviewCards(sites) {
  const last = sites.map(s => s.runs[0]).filter(Boolean);
  const executed = last.reduce((sum, run) => sum + run.executed, 0);
  const applicable = last.reduce((sum, run) => sum + run.applicable, 0);
  const successful = last.reduce((sum, run) => sum + run.passed + run.flaky, 0);
  return `<div class="section-label">Latest runs</div><div class="cards">
    ${metricCard(sites.length, 'Sites', `${sites.reduce((sum, site) => sum + site.runs.length, 0)} total runs`)}
    ${metricCard(last.filter(r => r.allPassed).length + ' / ' + sites.length, 'Clean runs', 'No failures, flaky tests, global errors or uncovered applicable tests')}
    ${metricCard(metricValue(percent(successful, executed)), 'Executed pass rate', `${successful} successful final outcomes / ${executed} completed tests`)}
    ${metricCard(metricValue(percent(executed, applicable)), 'Applicable coverage', `${executed} completed / ${applicable} applicable selected tests`)}
  </div>`;
}

function buildSiteCard(site) {
  const last = site.runs[0];
  return `<div class="site-card" data-tab="${escHtml(site.slug)}" onclick="showTab(this.dataset.tab)">
    <div class="site-card-header"><span class="site-card-name">${escHtml(site.name)}</span>${statusBadge(last)}</div>
    ${site.url ? `<div class="site-card-url">${escHtml(site.url)}</div>` : ''}
    ${last.spelling ? `<p class="c-amber">${last.spelling.error ? 'Spelling report unavailable' : 'Spelling review: ' + last.spelling.findings.filter(f => !f.accepted).length + ' · unchecked languages: ' + (last.spelling.unsupportedLanguages || []).length}</p>` : ''}
    <div class="site-card-stats">
      <div class="site-card-stat"><span class="site-card-stat-val">${metricValue(last.passRate)}</span><span class="site-card-stat-lbl">Executed pass rate</span></div>
      <div class="site-card-stat"><span class="site-card-stat-val">${metricValue(last.coverage)}</span><span class="site-card-stat-lbl">Applicable coverage</span></div>
      <div class="site-card-stat"><span class="site-card-stat-val">${site.runs.length}</span><span class="site-card-stat-lbl">Runs</span></div>
    </div>
  </div>`;
}

function renderMetadata(run) {
  const metadata = run.metadata;
  const projects = metadata.projects || [];
  return `<details><summary>Run metadata</summary>
    ${metadata.versions ? `<p>Versions: project ${escHtml(metadata.versions.project ?? 'unknown')} · Playwright ${escHtml(metadata.versions.playwright ?? 'unknown')} · Node ${escHtml(metadata.versions.node ?? 'unknown')}</p>` : '<p>Versions not recorded in this legacy run.</p>'}
    ${projects.map(project => `<p>${escHtml(project.name)}: ${escHtml(project.browser)} ${escHtml(metadata.browserVersions?.[project.name] || '(version not observed)')} · locale ${escHtml(project.locale)} · timezone ${escHtml(project.timezone || 'default')} · retries ${escHtml(project.retries)} · repeat ${escHtml(project.repeatEach)}</p>`).join('')}
    ${metadata.configuration ? `<p>Site configuration:</p><pre>${escHtml(JSON.stringify(metadata.configuration, null, 2))}</pre>` : ''}
    ${metadata.source ? `<p>Source: ${escHtml(metadata.source.commit || 'unknown')} · working tree ${typeof metadata.source.dirty !== 'boolean' ? 'unknown' : metadata.source.dirty ? 'modified' : 'clean'}</p>` : ''}
    ${metadata.selection ? `<p>Selection and tags:</p><pre>${escHtml(JSON.stringify(metadata.selection, null, 2))}</pre>` : '<p>Selection/tags were not recorded.</p>'}
    ${metadata.site ? `<p>Site: ${escHtml(metadata.site.name)} · ${escHtml(metadata.site.url)}</p>` : ''}
    <p>${escHtml(metadata.phase || 'Legacy final JSON')} · status ${escHtml(metadata.status || 'not recorded')} · exit ${escHtml(metadata.exitCode ?? 'not recorded')}${metadata.signal ? ` · signal ${escHtml(metadata.signal)}` : ''}</p>
    ${metadata.pacing ? `<p>Request pacing:</p><pre>${escHtml(JSON.stringify(metadata.pacing, null, 2))}</pre>` : ''}
    ${run.metadataLink ? `<a href="${run.metadataLink}" target="_blank">Metadata JSON →</a>` : ''}
  </details>`;
}

function renderDiagnostics(run) {
  const relevant = run.scenarios.filter(s => s.outcome !== 'passed');
  return `${!run.scopeKnown ? '<p>Scenario inventory was not recorded; selected scope is unknown.</p>' : run.total === 0 ? '<p>No tests selected or discovered.</p>' : ''}
    ${run.reportIssue ? `<p class="c-amber">${escHtml(run.reportIssue)}</p>` : ''}
    ${run.globalErrors.length ? `<details><summary>Global errors (${run.globalErrors.length})</summary>${run.globalErrors.map(error => `<pre>${escHtml(error)}</pre>`).join('')}</details>` : ''}
    <details><summary>Scenarios (${relevant.length} need attention / ${run.total} selected)</summary>
      ${relevant.length ? relevant.map(scenario => `<details class="scenario">
        <summary>${escHtml(scenario.title)} · ${escHtml(scenario.project)} · ${escHtml(scenario.outcome)}${scenario.change ? ' · ' + scenario.change : ''}${scenario.notApplicable ? ' · not applicable' : ''}</summary>
        <p>${escHtml(scenario.file)}${scenario.line ? ':' + scenario.line : ''}${scenario.tags?.length ? ' · ' + escHtml(scenario.tags.join(' ')) : ''}</p>
        ${(scenario.urls || []).map(url => `<p>URL: ${escHtml(url)}</p>`).join('')}
        ${(scenario.artifacts || []).map(artifact => { const href = run.artifactLink(artifact.path); return href ? `<p><a href="${href}" target="_blank">${escHtml(artifact.name === 'trace' ? 'Trace ZIP' : 'Screenshot: ' + artifact.name)} →</a></p>` : ''; }).join('')}
        ${(scenario.reasons || []).map(reason => `<p>${escHtml(reason)}</p>`).join('')}
        ${['not-run', 'interrupted', 'unfinished'].includes(scenario.outcome) ? '<p>Execution did not complete; this test remains in the coverage denominator.</p>' : ''}
        ${scenario.activeRetry !== undefined ? `<p>Was active at last checkpoint: attempt ${scenario.activeRetry + 1}</p>` : ''}
        ${(scenario.attempts || []).map(attempt => `<p>Attempt ${attempt.retry + 1}: ${escHtml(attempt.status)}</p>${attempt.errors.map(error => `<pre>${escHtml(error)}</pre>`).join('')}`).join('')}
      </details>`).join('') : '<p>No per-scenario diagnostics recorded.</p>'}
    </details>${run.spelling ? `<details><summary>Spelling (${run.spelling.findings.length} unique findings)</summary>${run.spelling.error ? `<p class="c-red">Spelling report unreadable: ${escHtml(run.spelling.error)}</p>` : ''}${run.spelling.findings.map(finding => `<p><strong>${escHtml(finding.word)}</strong> · ${escHtml(finding.language)} · ${escHtml(finding.component)} · ${escHtml(finding.source)}${finding.accepted ? ' · accepted' : ''}</p><p>${escHtml(finding.text)}</p><p>${escHtml(finding.urls.join(', '))}</p>${run.scenarios.filter(s => (s.urls || []).some(url => finding.urls.includes(url))).map(s => { const image = (s.artifacts || []).find(a => a.name === 'spelling-context'); const href = image && run.artifactLink(image.path); return href ? `<p><a href="${href}" target="_blank">${escHtml(s.name || s.title)} · spelling screenshot →</a></p>` : ''; }).join('')}<p>Suggestions: ${escHtml(finding.suggestions.join(', '))}</p><pre>${escHtml(JSON.stringify(finding.locations, null, 2))}</pre>`).join('')}<p>Unchecked languages: ${escHtml((run.spelling.unsupportedLanguages || []).join(', ') || 'none')}</p></details>` : ''}${renderMetadata(run)}`;
}

function buildTrend(runs, metric, label) {
  const recent = runs.slice(0, 20).reverse();
  return `<div class="trend-wrap"><div class="trend-label">${label} · latest ${recent.length} runs</div><div class="trend-bars">
    ${recent.map(run => {
      const color = statusInfo(run)[1];
      const css = color === 'pass' ? 'ok' : color === 'fail' ? 'ko' : color === 'warn' ? 'warn' : 'na';
      const height = Math.max(4, Math.round((run[metric] || 0) * 0.52));
      return `<div class="trend-bar ${css}" style="height:${height}px" title="${run.date} · ${metricValue(run[metric])} · ${statusInfo(run)[0]}"></div>`;
    }).join('')}
    </div><div class="trend-dates">${recent.map(run => `<div class="trend-date">${run.date.slice(0, 5)}</div>`).join('')}</div></div>`;
}

function buildSitePanel(site) {
  const runs = site.runs;
  const last = runs[0];
  return `${site.url ? `<p class="site-card-url">${escHtml(site.url)}</p>` : ''}
    <div class="section-label">Latest run</div><div class="cards">
      ${metricCard(statusInfo(last)[0], 'Status', last.date)}
      ${metricCard(metricValue(last.passRate), 'Executed pass rate', `${last.passed + last.flaky} successful final outcomes / ${last.executed} completed`)}
      ${metricCard(metricValue(last.coverage), 'Applicable coverage', `${last.executed} completed / ${last.applicable} applicable selected`)}
      ${metricCard(runs.filter(r => r.allPassed).length + ' / ' + runs.length, 'Clean runs', 'Across this site’s history')}
    </div>
    <p class="metric-note">Pass rate = (passed + flaky) / completed. Coverage = completed / applicable selected tests.
      Only explicit <code>not-applicable</code> annotations are excluded; unclassified skipped tests remain in coverage.
      Interrupted and unstarted tests are not completed. Filters/tags define the selected scope. “—” means no denominator.</p>
    ${buildTrend(runs, 'passRate', 'Executed pass rate')}
    ${buildTrend(runs, 'coverage', 'Applicable coverage')}
    <div class="section-label">Run history</div><div class="table-wrap"><table>
      <thead><tr><th>Date &amp; Time</th><th>Status</th><th>Results &amp; Scope</th><th>Details</th><th>Report</th></tr></thead>
      <tbody>${runs.map(run => `<tr>
        <td>${run.date}<br><span class="c-muted">${formatDuration(run.durationSec)}</span></td>
        <td>${statusBadge(run)}</td>
        <td>
          <p data-metric="pass-rate">Pass rate: <strong>${metricValue(run.passRate)}</strong> (${run.passed + run.flaky}/${run.executed})</p>
          <p data-metric="coverage">Coverage: <strong>${metricValue(run.coverage)}</strong> (${run.executed}/${run.applicable})</p>
          ${run.changes?.available ? `<p>New: ${run.changes.new} · Recurring: ${run.changes.recurring} · Resolved: ${run.changes.resolved} · Unverified: ${run.changes.unverified}</p>` : '<p class="c-muted">Change baseline unavailable</p>'}
          ${run.spelling ? `<p class="c-amber">${run.spelling.error ? 'Spelling report unavailable' : 'Spelling review: ' + run.spelling.findings.filter(f => !f.accepted).length + ' · unchecked languages: ' + (run.spelling.unsupportedLanguages || []).length}</p>` : ''}
          <div class="counts"><span class="cnt p">✓ ${run.passed}</span><span class="cnt f">✗ ${run.failed}</span>
            ${run.errors ? `<span class="cnt f">Errors: ${run.errors}</span>` : ''}
            ${run.flaky ? `<span class="cnt s">Flaky: ${run.flaky}</span>` : ''}
            ${run.skipped ? `<span class="cnt s">Skipped: ${run.skipped}</span>` : ''}
            ${run.notRun ? `<span class="cnt s">Not run: ${run.notRun}</span>` : ''}
            ${run.unfinished ? `<span class="cnt s">Unfinished: ${run.unfinished}</span>` : ''}
            ${run.interrupted ? `<span class="cnt s">Interrupted: ${run.interrupted}</span>` : ''}
          </div>
          <p class="c-muted">${run.scopeKnown ? run.total + ' selected' : 'Selection unknown'} · ${run.notApplicable} not applicable · ${run.unclassifiedSkipped} unclassified skips</p>
        </td>
        <td>${renderDiagnostics(run)}</td>
        <td>${run.reportLink ? `<a href="${run.reportLink}" target="_blank">Open →</a>` : 'No HTML report'}
          ${run.resultsLink ? `<br><a href="${run.resultsLink}" target="_blank">Results JSON →</a>` : ''}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dir) {
  const [datePart, timePart] = dir.split('_');
  if (!datePart || !timePart) return dir;
  const [y, m, d] = datePart.split('-');
  const [hh, mm]  = timePart.split('-');
  return `${d}.${m}.${y} ${hh}:${mm} UTC`;
}

function formatDuration(sec) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatName(slug) {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
