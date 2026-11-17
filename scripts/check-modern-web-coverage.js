'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STATUSES = ['Covered', 'Partial', 'Pending', 'Not applicable'];

/** Validate authored coverage metadata offline. This does not certify the linked assertions. */
function validateModernWebCoverage({ modernWeb, testsReference, repositoryRoot, catalog }) {
  const errors = [];
  const counts = Object.fromEntries(STATUSES.map(status => [status, 0]));
  const rows = [];
  const seen = new Set();
  for (const line of modernWeb.split(/\r?\n/)) {
    if (!/^\|\s*\[`/.test(line)) continue;
    const row =
      /^\|\s*\[`([^`]+)`\]\(([^)]+)\)\s*\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*([^|]+?)\s*\|\s*$/.exec(
        line,
      );
    if (!row) {
      errors.push(`Malformed guide row: ${line.slice(0, 100)}`);
      continue;
    }
    const [, id, source, status, evidence, gap, priority] = row;
    if (seen.has(id)) errors.push(`Duplicate guide ID: ${id}`);
    seen.add(id);
    if (!STATUSES.includes(status)) errors.push(`Unknown status for ${id}: ${status}`);
    else counts[status]++;
    if (!gap.trim()) errors.push(`Missing limitation or exclusion for ${id}`);
    if (!/^(?:P[123]|—)$/.test(priority)) errors.push(`Invalid priority for ${id}: ${priority}`);
    if (
      !source.startsWith(
        'https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/',
      ) ||
      !source.endsWith(`/${id}.md`)
    )
      errors.push(`Unexpected upstream source for ${id}`);
    const links = [...evidence.matchAll(/\]\(([^)]+)\)/g)].map(match => match[1]);
    const localLinks = links.filter(
      link => !/^[a-z][a-z\d+.-]*:/i.test(link) && !link.startsWith('#'),
    );
    if (['Covered', 'Partial'].includes(status) && !localLinks.length)
      errors.push(`Missing executable repository evidence for ${id}`);
    for (const link of localLinks) {
      let decoded;
      try {
        decoded = decodeURIComponent(link.split('#')[0]);
      } catch {
        errors.push(`Invalid evidence link for ${id}: ${link}`);
        continue;
      }
      const target = path.resolve(repositoryRoot, 'docs', decoded);
      const relative = path.relative(repositoryRoot, target);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        errors.push(`Evidence link escapes repository for ${id}: ${link}`);
      else if (!fs.existsSync(target) || !fs.statSync(target).isFile())
        errors.push(`Missing evidence file for ${id}: ${link}`);
    }
    rows.push({ id, status });
  }
  if (!rows.length) errors.push('No catalog guide rows found');
  const summary = new Map();
  for (const match of modernWeb.matchAll(
    /^\|\s*(Covered|Partial|Pending|Not applicable|Total)\s*\|\s*(\d+)\s*\|/gm,
  )) {
    if (summary.has(match[1])) errors.push(`Duplicate summary row: ${match[1]}`);
    summary.set(match[1], Number(match[2]));
  }
  for (const status of STATUSES)
    if (summary.get(status) !== counts[status])
      errors.push(
        `Summary ${status}: expected ${counts[status]}, found ${summary.get(status) ?? 'missing'}`,
      );
  if (summary.get('Total') !== rows.length)
    errors.push(
      `Summary Total: expected ${rows.length}, found ${summary.get('Total') ?? 'missing'}`,
    );
  const declaredTotal = /catalog has\s+\*\*(\d+) guides\*\*/i.exec(modernWeb);
  if (!declaredTotal || Number(declaredTotal[1]) !== rows.length)
    errors.push('Catalog prose total does not match guide rows');
  const remaining =
    /Remaining work spans (\d+) guide topics:\s*(\d+) pending plus (\d+) partial/i.exec(modernWeb);
  if (
    !remaining ||
    Number(remaining[1]) !== counts.Pending + counts.Partial ||
    Number(remaining[2]) !== counts.Pending ||
    Number(remaining[3]) !== counts.Partial
  )
    errors.push('Remaining-work counts do not match guide rows');
  const reference =
    /Current catalog totals:\s*\*\*(\d+) Covered\s*\/\s*(\d+) Partial\s*\/\s*(\d+) Pending\s*\/\s*(\d+) (?:outside scope|Not applicable)\*\*\s*\((\d+) guides\)/i.exec(
      testsReference,
    );
  if (
    !reference ||
    STATUSES.some((status, index) => Number(reference[index + 1]) !== counts[status]) ||
    Number(reference[5]) !== rows.length
  )
    errors.push('TESTS.md catalog summary does not match guide rows');
  if (catalog !== undefined) {
    if (
      !Array.isArray(catalog) ||
      catalog.some(entry => !entry || typeof entry.id !== 'string' || !entry.id)
    )
      errors.push('Catalog must be a CLI list array of objects with nonempty id strings');
    else {
      const ids = catalog.map(entry => entry.id);
      if (new Set(ids).size !== ids.length) errors.push('Catalog contains duplicate IDs');
      const expected = new Set(ids);
      for (const id of seen)
        if (!expected.has(id)) errors.push(`Guide not present in catalog: ${id}`);
      for (const id of expected)
        if (!seen.has(id)) errors.push(`Catalog guide missing from matrix: ${id}`);
    }
  }
  return { valid: errors.length === 0, errors, counts, total: rows.length, ids: [...seen].sort() };
}

function main(argv = process.argv.slice(2)) {
  const repositoryRoot = path.resolve(__dirname, '..');
  let catalog;
  if (argv.length) {
    if (argv.length !== 2 || argv[0] !== '--catalog')
      throw new Error(
        'Usage: node scripts/check-modern-web-coverage.js [--catalog <CLI-list.json>]',
      );
    catalog = JSON.parse(fs.readFileSync(path.resolve(argv[1]), 'utf8'));
  }
  const result = validateModernWebCoverage({
    modernWeb: fs.readFileSync(path.join(repositoryRoot, 'docs/MODERN-WEB.md'), 'utf8'),
    testsReference: fs.readFileSync(path.join(repositoryRoot, 'docs/TESTS.md'), 'utf8'),
    repositoryRoot,
    catalog,
  });
  if (!result.valid) throw new Error(result.errors.join('\n'));
  console.log(
    `Modern Web coverage metadata: ${result.total} unique guides; ${STATUSES.map(status => `${result.counts[status]} ${status}`).join(' / ')}. Evidence links and TESTS.md summary match.${catalog ? ' Offline catalog equality verified.' : ''}`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { validateModernWebCoverage, main };
