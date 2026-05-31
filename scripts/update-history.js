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
    if (/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}$/.test(entry.name)) continue;

    const slug     = entry.name;
    const siteDir  = path.join(reportsDir, slug);
    const runs     = collectRunsFromDir(siteDir, `${slug}/`);
    if (runs.length === 0) continue;

    const m = meta[slug] || {};
    sites.push({
      slug,
      name: m.name || formatName(slug),
      url:  m.url  || '',
      runs: runs.sort((a, b) => b.dir.localeCompare(a.dir)),
    });
  }

  return sites.sort((a, b) => a.name.localeCompare(b.name));
}

function collectRunsFromDir(dir, relPrefix) {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter(d => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}$/.test(d))
    .map(d => {
      const resultsPath = path.join(dir, d, 'results.json');
      if (!fs.existsSync(resultsPath)) return null;
      let results;
      try { results = JSON.parse(fs.readFileSync(resultsPath, 'utf8')); }
      catch { return null; }

      const stats    = results.stats || {};
      const passed   = stats.expected   ?? 0;
      const failed   = stats.unexpected ?? 0;
      const skipped  = stats.skipped    ?? 0;
      const flaky    = stats.flaky      ?? 0;
      const total    = passed + failed + skipped + flaky;
      const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

      return {
        dir: d,
        date: formatDate(d),
        passed, failed, skipped, flaky, total,
        durationSec: Math.round((stats.duration ?? 0) / 1000),
        allPassed:   failed === 0,
        passRate,
        reportLink:  `./${relPrefix}${d}/index.html`,
        suites:      collectSuites(results.suites || []),
      };
    })
    .filter(Boolean);
}

// ── Main ─────────────────────────────────────────────────────────────────────

const sites    = collectAllSites();
const generated = new Date().toLocaleString('bg-BG', { timeZone: 'Europe/Sofia' });

const html = buildDashboard(sites, generated);
fs.writeFileSync(path.join(reportsDir, 'dashboard.html'), html, 'utf8');
console.log(`✓ Dashboard updated → reports/dashboard.html (${sites.length} site${sites.length !== 1 ? 's' : ''})`);

// ── HTML builder ─────────────────────────────────────────────────────────────

function buildDashboard(sites, generated) {
  const lastStatus = sites.length > 0
    ? sites.every(s => s.runs[0]?.allPassed) ? '#4ade80' : '#f87171'
    : '#94a3b8';

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
    .trend-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 22px; margin-bottom: 28px; }
    .trend-label { font-size: 0.78rem; color: var(--muted); margin-bottom: 10px; }
    .trend-bars { display: flex; align-items: flex-end; gap: 5px; height: 52px; }
    .trend-bar { width: 24px; flex-shrink: 0; border-radius: 4px 4px 0 0; min-height: 4px; cursor: default; transition: opacity .15s; }
    .trend-bar:hover { opacity: .75; }
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
    .badge-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
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
    const pip  = !last ? 'na' : last.allPassed ? 'ok' : 'ko';
    return `<button class="tab-btn" data-tab="${escHtml(s.slug)}" onclick="showTab('${escHtml(s.slug)}')">
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

function buildOverviewCards(sites) {
  const totalRuns   = sites.reduce((s, x) => s + x.runs.length, 0);
  const allLastPass = sites.filter(s => s.runs[0]?.allPassed).length;
  const overallRate = sites.length > 0
    ? Math.round(sites.reduce((s, x) => {
        const r = x.runs[0]; return s + (r ? r.passRate : 0);
      }, 0) / sites.length)
    : 0;

  const rateColor = overallRate >= 90 ? 'c-green' : overallRate >= 70 ? 'c-amber' : 'c-red';
  const rateBar   = overallRate >= 90 ? 'green'   : overallRate >= 70 ? 'amber'   : 'red';

  return `
    <div class="section-label">Overview</div>
    <div class="cards">
      <div class="card">
        <div class="card-value c-blue">${sites.length}</div>
        <div class="card-label">Sites</div>
        <div class="card-sub">${totalRuns} total run${totalRuns !== 1 ? 's' : ''}</div>
      </div>
      <div class="card">
        <div class="card-value ${allLastPass === sites.length ? 'c-green' : 'c-red'}">${allLastPass} / ${sites.length}</div>
        <div class="card-label">Passing Now</div>
        <div class="card-sub">last run status</div>
      </div>
      <div class="card">
        <div class="card-value ${rateColor}">${overallRate}<span style="font-size:1.1rem;font-weight:500">%</span></div>
        <div class="card-label">Avg Pass Rate</div>
        <div class="rate-bar-wrap"><div class="rate-bar ${rateBar}" style="width:${overallRate}%"></div></div>
      </div>
    </div>`;
}

function buildSiteCard(site) {
  const last    = site.runs[0];
  const status  = !last ? null : last.allPassed;
  const badgeCls = status === null ? '' : status ? 'pass' : 'fail';
  const badgeTxt = status === null ? '—' : status ? 'Passing' : 'Failed';

  return `<div class="site-card" onclick="showTab('${escHtml(site.slug)}')">
      <div class="site-card-header">
        <span class="site-card-name">${escHtml(site.name)}</span>
        ${status !== null ? `<span class="badge ${badgeCls}"><span class="badge-dot"></span>${badgeTxt}</span>` : ''}
      </div>
      ${site.url ? `<div class="site-card-url">${escHtml(site.url)}</div>` : ''}
      <div class="site-card-stats">
        <div class="site-card-stat">
          <span class="site-card-stat-val">${site.runs.length}</span>
          <span class="site-card-stat-lbl">Runs</span>
        </div>
        ${last ? `
        <div class="site-card-stat">
          <span class="site-card-stat-val ${last.passRate >= 90 ? 'c-green' : last.passRate >= 70 ? 'c-amber' : 'c-red'}">${last.passRate}%</span>
          <span class="site-card-stat-lbl">Last pass rate</span>
        </div>
        <div class="site-card-stat">
          <span class="site-card-stat-val" style="color:var(--muted)">${last.date}</span>
          <span class="site-card-stat-lbl">Last run</span>
        </div>` : ''}
      </div>
    </div>`;
}

// ── Per-site panel ────────────────────────────────────────────────────────────

function buildSitePanel(site) {
  const runs        = site.runs;
  const totalRuns   = runs.length;
  const passedRuns  = runs.filter(r => r.allPassed).length;
  const overallRate = totalRuns > 0 ? Math.round((passedRuns / totalRuns) * 100) : 0;
  const avgDuration = totalRuns > 0 ? Math.round(runs.reduce((s, r) => s + r.durationSec, 0) / totalRuns) : 0;
  let streak = 0;
  for (const r of runs) { if (r.allPassed) streak++; else break; }

  const rateColor = overallRate >= 90 ? 'c-green' : overallRate >= 70 ? 'c-amber' : 'c-red';
  const rateBar   = overallRate >= 90 ? 'green'   : overallRate >= 70 ? 'amber'   : 'red';
  const trendRuns = [...runs].reverse().slice(-20);

  return `
    ${site.url ? `<p style="font-size:.8rem;color:var(--muted);margin-bottom:20px">${escHtml(site.url)}</p>` : ''}

    <div class="section-label">Overview</div>
    <div class="cards">
      <div class="card">
        <div class="card-value c-blue">${totalRuns}</div>
        <div class="card-label">Total Runs</div>
        <div class="card-sub">${streak > 0 ? `${streak}-run passing streak` : passedRuns < totalRuns ? `${totalRuns - passedRuns} with failures` : ''}</div>
      </div>
      <div class="card">
        <div class="card-value ${rateColor}">${overallRate}<span style="font-size:1.1rem;font-weight:500">%</span></div>
        <div class="card-label">Pass Rate</div>
        <div class="rate-bar-wrap"><div class="rate-bar ${rateBar}" style="width:${overallRate}%"></div></div>
      </div>
      <div class="card">
        <div class="card-value ${runs[0]?.allPassed ? 'c-green' : 'c-red'}">${runs[0]?.allPassed ? '✓' : runs[0] ? '✗' : '—'}</div>
        <div class="card-label">Last Run</div>
        <div class="card-sub">${runs[0]?.date ?? '—'}</div>
      </div>
      <div class="card">
        <div class="card-value c-muted">${formatDuration(avgDuration)}</div>
        <div class="card-label">Avg Duration</div>
        <div class="card-sub">${totalRuns > 0 ? `across ${totalRuns} run${totalRuns !== 1 ? 's' : ''}` : ''}</div>
      </div>
    </div>

    <div class="section-label">Last ${trendRuns.length} Run${trendRuns.length !== 1 ? 's' : ''}</div>
    <div class="trend-wrap">
      ${trendRuns.length === 0
        ? `<div class="trend-empty">No runs yet.</div>`
        : `<div class="trend-label">Pass rate per run — hover a bar for details</div>
      <div class="trend-bars">
        ${trendRuns.map(r => {
          const h = Math.max(4, Math.round((r.passRate / 100) * 52));
          return `<div class="trend-bar ${r.allPassed ? 'ok' : 'ko'}" style="height:${h}px" title="${r.date} · ${r.passRate}% (${r.passed}/${r.total})"></div>`;
        }).join('')}
      </div>
      <div class="trend-dates">
        ${trendRuns.map(r => `<div class="trend-date">${r.date.slice(0, 5)}</div>`).join('')}
      </div>`}
    </div>

    <div class="section-label">Run History</div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Date &amp; Time</th><th>Status</th><th>Results</th>
          <th>Duration</th><th>Suites</th><th>Report</th>
        </tr></thead>
        <tbody>
          ${runs.length === 0
            ? `<tr><td colspan="6" style="text-align:center;color:#9ca3af;padding:40px;font-size:.9rem">No runs yet.</td></tr>`
            : runs.map(r => `
          <tr>
            <td style="white-space:nowrap"><strong>${r.date}</strong></td>
            <td><span class="badge ${r.allPassed ? 'pass' : 'fail'}"><span class="badge-dot"></span>${r.allPassed ? 'Passed' : 'Failed'}</span></td>
            <td><div class="counts">
              <span class="cnt p">✓ ${r.passed}</span>
              ${r.failed  > 0 ? `<span class="cnt f">✗ ${r.failed}</span>`  : ''}
              ${r.skipped > 0 ? `<span class="cnt s">⊘ ${r.skipped}</span>` : ''}
              <span class="cnt t">/ ${r.total}</span>
            </div></td>
            <td style="white-space:nowrap;color:var(--muted)">${formatDuration(r.durationSec)}</td>
            <td>${r.suites.length > 0 ? `
              <details>
                <summary>${r.suites.length} suite${r.suites.length !== 1 ? 's' : ''}</summary>
                <div class="suite-list">
                  ${r.suites.map(s => `
                  <div class="suite-row">
                    <span class="s-pip ${s.failed > 0 ? 'ko' : s.skipped === s.total ? 'sk' : 'ok'}"></span>
                    <span class="s-name">${escHtml(s.title)}</span>
                    <span class="s-score">${s.passed}/${s.total}</span>
                  </div>`).join('')}
                </div>
              </details>` : '<span style="color:#d1d5db">—</span>'}</td>
            <td><a href="${r.reportLink}" target="_blank">Open →</a></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dir) {
  const [datePart, timePart] = dir.split('_');
  if (!datePart || !timePart) return dir;
  const [y, m, d] = datePart.split('-');
  const [hh, mm]  = timePart.split('-');
  return `${d}.${m}.${y} ${hh}:${mm}`;
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

function collectSuites(suites, depth = 0) {
  const result = [];
  for (const suite of suites) {
    if (!suite) continue;
    const hasDescribeChildren  = (suite.suites || []).some(s => s.title);
    const isDescribeBlock      = depth === 2 && suite.title;
    const isTopLevelNoDescribe = depth === 1 && suite.title && !hasDescribeChildren;
    if (isDescribeBlock || isTopLevelNoDescribe) {
      let passed = 0, failed = 0, skipped = 0;
      const countSpecs = s => {
        for (const spec of s.specs || [])
          for (const test of spec.tests || []) {
            const st = test.status || test.results?.[0]?.status;
            if (st === 'passed' || st === 'expected')       passed++;
            else if (st === 'failed' || st === 'unexpected') failed++;
            else skipped++;
          }
        for (const child of s.suites || []) countSpecs(child);
      };
      countSpecs(suite);
      result.push({ title: suite.title, passed, failed, skipped, total: passed + failed + skipped });
    }
    result.push(...collectSuites(suite.suites || [], depth + 1));
  }
  return result;
}
