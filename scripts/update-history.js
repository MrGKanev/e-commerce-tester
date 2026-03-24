#!/usr/bin/env node
'use strict';

/**
 * update-history.js
 * Scans all dated run folders in ./reports/, reads results.json from each,
 * and regenerates reports/history.html with a cumulative summary table.
 */

const fs = require('fs');
const path = require('path');

const reportsDir = path.join(__dirname, '..', 'reports');

// ---------------------------------------------------------------------------
// Collect run data
// ---------------------------------------------------------------------------

const runDirs = fs
  .readdirSync(reportsDir)
  .filter((d) => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}$/.test(d))
  .sort()
  .reverse();

const runs = runDirs
  .map((dir) => {
    const resultsPath = path.join(reportsDir, dir, 'results.json');
    if (!fs.existsSync(resultsPath)) return null;

    let results;
    try {
      results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
    } catch {
      return null;
    }

    const stats = results.stats || {};
    const passed = stats.expected ?? 0;
    const failed = stats.unexpected ?? 0;
    const skipped = stats.skipped ?? 0;
    const flaky = stats.flaky ?? 0;
    const total = passed + failed + skipped + flaky;
    const durationSec = Math.round((stats.duration ?? 0) / 1000);
    const allPassed = failed === 0;

    // Build per-suite breakdown
    const suites = collectSuites(results.suites || []);

    return {
      dir,
      date: formatDate(dir),
      passed,
      failed,
      skipped,
      flaky,
      total,
      durationSec,
      allPassed,
      reportLink: `./${dir}/index.html`,
      suites,
    };
  })
  .filter(Boolean);

// ---------------------------------------------------------------------------
// Build overall stats
// ---------------------------------------------------------------------------

const totalRuns = runs.length;
const passedRuns = runs.filter((r) => r.allPassed).length;
const failedRuns = totalRuns - passedRuns;

// ---------------------------------------------------------------------------
// Generate HTML
// ---------------------------------------------------------------------------

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Zerno.co — Test History</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #f4f6f9;
      color: #1a1a2e;
      margin: 0;
      padding: 24px;
    }
    h1 { font-size: 1.6rem; margin-bottom: 4px; }
    .subtitle { color: #666; font-size: 0.9rem; margin-bottom: 32px; }

    /* Summary cards */
    .cards {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 32px;
    }
    .card {
      background: #fff;
      border-radius: 10px;
      padding: 20px 28px;
      min-width: 130px;
      box-shadow: 0 1px 4px rgba(0,0,0,.08);
      text-align: center;
    }
    .card .value { font-size: 2.4rem; font-weight: 700; line-height: 1; }
    .card .label { font-size: 0.78rem; color: #666; margin-top: 4px; text-transform: uppercase; letter-spacing: .05em; }
    .card.green .value { color: #22c55e; }
    .card.red .value { color: #ef4444; }
    .card.blue .value { color: #3b82f6; }
    .card.gray .value { color: #6b7280; }

    /* Runs table */
    .table-wrap {
      background: #fff;
      border-radius: 10px;
      box-shadow: 0 1px 4px rgba(0,0,0,.08);
      overflow: hidden;
      margin-bottom: 32px;
    }
    table { width: 100%; border-collapse: collapse; }
    th {
      background: #f8fafc;
      text-align: left;
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: .05em;
      color: #555;
      padding: 12px 16px;
      border-bottom: 1px solid #e5e7eb;
    }
    td {
      padding: 13px 16px;
      border-bottom: 1px solid #f1f3f5;
      font-size: 0.9rem;
      vertical-align: top;
    }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #fafbfc; }

    .badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 600;
    }
    .badge.pass { background: #dcfce7; color: #15803d; }
    .badge.fail { background: #fee2e2; color: #b91c1c; }

    .num-pass { color: #15803d; font-weight: 600; }
    .num-fail { color: #b91c1c; font-weight: 600; }
    .num-skip { color: #92400e; }

    a { color: #3b82f6; text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* Suite breakdown (collapsible) */
    details { margin-top: 6px; }
    summary {
      font-size: 0.8rem;
      color: #6b7280;
      cursor: pointer;
      user-select: none;
    }
    .suite-list { margin-top: 4px; padding-left: 12px; }
    .suite-row { font-size: 0.78rem; display: flex; gap: 6px; align-items: baseline; }
    .s-dot { font-size: 0.7rem; }
    .s-dot.ok { color: #22c55e; }
    .s-dot.ko { color: #ef4444; }
    .s-dot.sk { color: #f59e0b; }
    .s-name { color: #374151; }

    footer { color: #9ca3af; font-size: 0.78rem; margin-top: 16px; }
  </style>
</head>
<body>

  <h1>🛒 Zerno.co — Automated Test History</h1>
  <p class="subtitle">Weekly health-check report for <strong>zerno.co</strong> · Generated: ${new Date().toLocaleString('bg-BG', { timeZone: 'Europe/Sofia' })}</p>

  <div class="cards">
    <div class="card blue">
      <div class="value">${totalRuns}</div>
      <div class="label">Total Runs</div>
    </div>
    <div class="card green">
      <div class="value">${passedRuns}</div>
      <div class="label">Passed</div>
    </div>
    <div class="card red">
      <div class="value">${failedRuns}</div>
      <div class="label">With Failures</div>
    </div>
    ${runs[0] ? `
    <div class="card ${runs[0].allPassed ? 'green' : 'red'}">
      <div class="value">${runs[0].allPassed ? '✓' : '✗'}</div>
      <div class="label">Last Run</div>
    </div>` : ''}
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Date &amp; Time</th>
          <th>Status</th>
          <th>Tests</th>
          <th>Duration</th>
          <th>Suites</th>
          <th>Report</th>
        </tr>
      </thead>
      <tbody>
        ${runs.length === 0 ? `<tr><td colspan="6" style="text-align:center;color:#9ca3af;padding:32px">No runs yet. Run <code>npm test</code> to get started.</td></tr>` : ''}
        ${runs.map((r) => `
        <tr>
          <td><strong>${r.date}</strong></td>
          <td><span class="badge ${r.allPassed ? 'pass' : 'fail'}">${r.allPassed ? 'PASSED' : 'FAILED'}</span></td>
          <td>
            <span class="num-pass">✓ ${r.passed}</span>
            ${r.failed > 0 ? `<span class="num-fail"> ✗ ${r.failed}</span>` : ''}
            ${r.skipped > 0 ? `<span class="num-skip"> ⊘ ${r.skipped}</span>` : ''}
            <span style="color:#9ca3af;font-size:.8rem"> / ${r.total}</span>
          </td>
          <td>${formatDuration(r.durationSec)}</td>
          <td>
            ${r.suites.length > 0 ? `
            <details>
              <summary>${r.suites.length} suites</summary>
              <div class="suite-list">
                ${r.suites.map((s) => `
                <div class="suite-row">
                  <span class="s-dot ${s.failed > 0 ? 'ko' : s.skipped === s.total ? 'sk' : 'ok'}">●</span>
                  <span class="s-name">${escHtml(s.title)}</span>
                  <span style="color:#9ca3af">${s.passed}/${s.total}</span>
                </div>`).join('')}
              </div>
            </details>` : '—'}
          </td>
          <td><a href="${r.reportLink}" target="_blank">Open →</a></td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>

  <footer>Generated by <code>scripts/update-history.js</code> · <a href="https://playwright.dev" target="_blank">Playwright</a></footer>

</body>
</html>`;

fs.writeFileSync(path.join(reportsDir, 'history.html'), html, 'utf8');
console.log('✓ History updated → reports/history.html');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dir) {
  // dir = "2024-01-15_10-30"
  const [datePart, timePart] = dir.split('_');
  if (!datePart || !timePart) return dir;
  const [y, m, d] = datePart.split('-');
  const [hh, mm] = timePart.split('-');
  return `${d}.${m}.${y} ${hh}:${mm}`;
}

function formatDuration(sec) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function collectSuites(suites, depth = 0) {
  const result = [];
  for (const suite of suites) {
    if (!suite) continue;
    // Top-level suite = file; second-level = describe block
    if (depth === 1 && suite.title) {
      let passed = 0, failed = 0, skipped = 0;
      const countSpecs = (s) => {
        for (const spec of s.specs || []) {
          for (const test of spec.tests || []) {
            const status = test.status || test.results?.[0]?.status;
            if (status === 'passed' || status === 'expected') passed++;
            else if (status === 'failed' || status === 'unexpected') failed++;
            else skipped++;
          }
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
