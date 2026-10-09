'use strict';
let data,
  revision,
  token,
  selected = null,
  dirty = false,
  status;
const $ = selector => document.querySelector(selector);
const escapeHTML = value =>
  String(value ?? '').replace(
    /[&<>"']/g,
    character =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
const projects = [
  'Desktop Chrome',
  'Desktop Firefox',
  'Desktop Safari',
  'Mobile Chrome',
  'Mobile Safari',
];
const modes = {
  smoke: 'Smoke · key journeys',
  pages: 'Pages · shared quality checks',
  content: 'Content · spelling',
  visual: 'Visual · snapshot comparison',
  full: 'Full · all regular checks',
  audit: 'Audit · Lighthouse & throttling',
};
function message(text, error = false) {
  $('#message').textContent = text;
  $('#message').classList.toggle('error', error);
}
function changed() {
  dirty = true;
  $('#save').disabled = false;
  $('#save').textContent = 'Save changes';
}
function readPath(path) {
  return path.split('.').reduce((value, key) => value?.[key], data);
}
function writePath(path, value) {
  const keys = path.split('.');
  let parent = data;
  for (const key of keys.slice(0, -1)) parent = parent[key] ??= {};
  parent[keys.at(-1)] = value;
  changed();
}
function field(label, path, value, type = 'text', scale = 1, extra = '') {
  return `<label>${escapeHTML(label)}<input data-path="${escapeHTML(path)}" data-scale="${scale}" type="${type}" value="${escapeHTML(type === 'number' && value !== '' ? value / scale : value)}" ${type === 'number' ? 'min="0" step="any"' : ''} ${extra}></label>`;
}
function checkbox(label, path, value) {
  return `<label class="check"><input type="checkbox" data-path="${escapeHTML(path)}" ${value ? 'checked' : ''}>${escapeHTML(label)}</label>`;
}
function storeSchedule(site) {
  return (data.scheduler.sites[site.slug] ??= {});
}
function storeJobs(site) {
  return storeSchedule(site).jobs ?? data.scheduler.defaults?.jobs ?? [];
}
function renderList() {
  $('#store-list').innerHTML = data.sites
    .map(
      site =>
        `<button class="store-item ${site.slug === selected ? 'active' : ''}" data-select="${escapeHTML(site.slug)}">${escapeHTML(site.name || site.slug)}<small>${escapeHTML(site.url || 'Enter a store address')} · ${storeSchedule(site).enabled === false ? 'Paused' : 'Enabled'}</small></button>`,
    )
    .join('');
}
function render() {
  renderList();
  const editor = $('#editor');
  if (selected === 'general') {
    renderGeneral();
    return;
  }
  const index = data.sites.findIndex(site => site.slug === selected);
  if (index < 0) {
    editor.replaceChildren($('#welcome').content.cloneNode(true));
    return;
  }
  const site = data.sites[index],
    schedule = storeSchedule(site),
    base = `sites.${index}`,
    jobBase = `scheduler.sites.${site.slug}.jobs`;
  // Editing inherited jobs creates an explicit copy for this store; advanced fields stay intact.
  if (!schedule.jobs) schedule.jobs = structuredClone(storeJobs(site));
  const jobs = schedule.jobs;
  const spelling = site.spelling || {};
  editor.innerHTML = `<div class="section-heading"><h2>${escapeHTML(site.name || 'Store settings')}</h2><span class="badge">${schedule.enabled === false ? 'Paused' : 'Scheduled'}</span></div>
    <div class="grid">${field('Store name', `${base}.name`, site.name)}${field('Store address', `${base}.url`, site.url, 'url')}${field('First product URL or handle', `${base}.productHandle`, site.productHandle)}${field('Second product URL or handle', `${base}.productHandle2`, site.productHandle2)}${field('Search term', `${base}.searchTerm`, site.searchTerm)}${field('Report ID', `${base}.slug`, site.slug, 'text', 1, 'readonly')}${field('Language / locale', `${base}.locale`, site.locale || 'bg-BG')}${field('Timezone', `${base}.timezoneId`, site.timezoneId || 'Europe/Sofia')}</div>
    <p class="help">Paste product addresses or enter the part after /products/. Use two products suitable for cart checks.</p>
    <div class="section"><div class="section-heading"><h2>Check schedule</h2><button class="quiet" data-action="add-job">+ Add check</button></div>${checkbox('Enable scheduled checks for this store', `scheduler.sites.${site.slug}.enabled`, schedule.enabled !== false)}<p class="help">Intervals start after a check finishes. Only one store runs at a time.</p>
    ${jobs.map((job, j) => renderJob(job, `${jobBase}.${j}`, j, site.timezoneId || 'Europe/Sofia')).join('')}
    ${jobs.length ? '' : '<p class="help">Add at least one check before enabling this store.</p>'}</div>
    <details class="section"><summary>Content and request settings</summary><div class="grid section"><label>Spelling behavior<select data-path="${base}.spelling.mode">${['off', 'report', 'strict'].map(mode => `<option value="${mode}" ${(spelling.mode || 'report') === mode ? 'selected' : ''}>${mode}</option>`).join('')}</select></label><label>Accepted brand names and terms<textarea data-path="${base}.spelling.allowWords" data-list>${escapeHTML((spelling.allowWords || []).join('\n'))}</textarea></label></div><p class="help">Enter one accepted term per line. Strict spelling can fail for brand names or unknown words.</p><div class="grid">${renderPacing(schedule.pacing || {}, `scheduler.sites.${site.slug}.pacing`, true)}</div><p class="help">Blank fields inherit the general pauses.</p></details>
    <div class="footer"><p class="help">Existing reports remain when a store is removed.</p><button class="danger" data-action="remove-store">Remove store</button></div>`;
  renderJobStatus();
}
function renderJob(job, base, index, timezone) {
  const checkedProjects = job.projects || ['Desktop Chrome'];
  const window = job.window;
  return `<div class="job"><div class="job-heading"><h3>Check ${index + 1}</h3><button class="quiet" data-remove-job="${index}" aria-label="Remove check ${index + 1}">Remove</button></div><div class="grid"><label class="full">What to check<select data-path="${base}.mode">${Object.entries(
    modes,
  )
    .map(
      ([value, label]) =>
        `<option value="${value}" ${job.mode === value ? 'selected' : ''}>${label}</option>`,
    )
    .join(
      '',
    )}</select></label>${field('At least (hours between checks)', `${base}.intervalMinutes.0`, job.intervalMinutes[0], 'number', 60)}${field('At most (hours between checks)', `${base}.intervalMinutes.1`, job.intervalMinutes[1], 'number', 60)}${field('Maximum run duration (hours)', `${base}.maxRunMinutes`, job.maxRunMinutes || data.scheduler.maxRunMinutes || 120, 'number', 60)}</div><p class="help">The next interval is chosen randomly within this range. Equal values give a fixed interval.</p><div class="checks">${projects.map(project => `<label class="check"><input type="checkbox" data-project="${escapeHTML(project)}" data-job="${index}" ${checkedProjects.includes(project) ? 'checked' : ''}>${escapeHTML(project)}</label>`).join('')}</div><label class="check"><input type="checkbox" data-window="${index}" ${window ? 'checked' : ''}>Only start within a time window</label>${window ? `<div class="grid section">${field('Window timezone', `${base}.window.timezone`, window.timezone || timezone)}${field('Start time', `${base}.window.start`, window.start, 'time')}${field('End time', `${base}.window.end`, window.end, 'time')}</div><div class="checks">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, d) => `<label class="check"><input type="checkbox" data-day="${d + 1}" data-job="${index}" ${(window.weekdays || [1, 2, 3, 4, 5, 6, 7]).includes(d + 1) ? 'checked' : ''}>${day}</label>`).join('')}</div>` : ''}<p class="status-note" data-job-status="${escapeHTML(job.id)}"></p></div>`;
}
function renderPacing(values, base, optional = false) {
  return [
    ['testDelayMs', 'Pause before each test (seconds)', 5000],
    ['testJitterMs', 'Extra random test pause (seconds)', 3000],
    ['requestDelayMs', 'Pause before each request (seconds)', 2000],
    ['requestJitterMs', 'Extra random request pause (seconds)', 2000],
  ]
    .map(([key, label, fallback]) =>
      field(
        label,
        `${base}.${key}`,
        optional && values[key] === undefined ? '' : (values[key] ?? fallback),
        'number',
        optional && values[key] === undefined ? 1 : 1000,
        optional ? 'data-optional data-ms' : '',
      ),
    )
    .join('');
}
function renderGeneral() {
  const scheduler = data.scheduler,
    cooldown = scheduler.cooldown || {};
  $('#editor').innerHTML =
    `<h2>Scheduling & pauses</h2><p class="muted">These settings apply across all stores. Store-specific request pauses take precedence.</p><div class="grid">${field('Spread first checks over (hours)', 'scheduler.startupSpreadMinutes', scheduler.startupSpreadMinutes ?? 60, 'number', 60)}${field('Pause between store runs (minutes)', 'scheduler.minGapMinutes', scheduler.minGapMinutes ?? 5, 'number')}${field('Maximum run duration (hours)', 'scheduler.maxRunMinutes', scheduler.maxRunMinutes ?? 120, 'number', 60)}</div><div class="section"><h2>When a store limits requests</h2><div class="grid">${field('First cooldown (hours)', 'scheduler.cooldown.rateLimitMinutes', cooldown.rateLimitMinutes ?? 360, 'number', 60)}${field('Maximum cooldown (hours)', 'scheduler.cooldown.maxRateLimitMinutes', cooldown.maxRateLimitMinutes ?? 10080, 'number', 60)}${field('Pause after failed checks (minutes)', 'scheduler.cooldown.failureMinutes', cooldown.failureMinutes ?? 30, 'number')}${field('Maximum failure pause (hours)', 'scheduler.cooldown.maxFailureMinutes', cooldown.maxFailureMinutes ?? 1440, 'number', 60)}</div><p class="help">Repeated failures double the pause up to the maximum. A longer Retry-After from the store is always respected.</p></div><div class="section"><h2>Request pacing</h2><div class="grid">${renderPacing(scheduler.pacing || {}, 'scheduler.pacing')}</div><p class="help">These pauses apply to tests and paced navigations/API requests. Static assets load normally.</p></div>`;
}
function addStore() {
  let number = Date.now();
  while (data.sites.some(site => site.slug === `store-${number.toString(36)}`)) number++;
  const slug = `store-${number.toString(36)}`;
  data.sites.push({
    name: 'New store',
    slug,
    url: '',
    productHandle: '',
    productHandle2: '',
    searchTerm: 'product',
    locale: 'en-US',
    timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  });
  data.scheduler.sites[slug] = {
    enabled: false,
    jobs: [
      { id: 'smoke', mode: 'smoke', intervalMinutes: [360, 720], projects: ['Desktop Chrome'] },
    ],
  };
  selected = slug;
  changed();
  render();
  $('#editor input').focus();
}
async function api(url, options) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result;
}
async function load() {
  const result = await api('/api/config');
  revision = result.revision;
  token = result.token;
  data = { sites: result.sites, scheduler: result.scheduler };
  data.scheduler.sites ||= {};
  selected = data.sites.some(site => site.slug === selected)
    ? selected
    : (data.sites[0]?.slug ?? null);
  dirty = false;
  $('#save').disabled = true;
  message('');
  render();
  await refreshStatus();
}
function renderJobStatus() {
  if (!status) return;
  for (const element of document.querySelectorAll('[data-job-status]')) {
    const job = status.jobs.find(
      job => job.site === selected && job.id === element.dataset.jobStatus,
    );
    element.textContent = job
      ? `Next eligible: ${job.nextAt ? new Date(job.nextAt).toLocaleString() : 'Waiting for scheduler'}${job.lastOutcome ? ' · Last: ' + job.lastOutcome : ''}`
      : 'Not saved to the scheduler yet';
  }
}
async function refreshStatus() {
  try {
    status = await api('/api/status');
    $('#worker').textContent = status.healthy
      ? '● Scheduler online'
      : '○ Scheduler starting or offline';
    $('#active').textContent = status.running
      ? `Running: ${status.running.key}`
      : 'No active check';
    renderJobStatus();
  } catch {
    $('#worker').textContent = '○ Status unavailable';
  }
}
$('#save').addEventListener('click', async () => {
  $('#save').disabled = true;
  try {
    const result = await api('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Control-Token': token },
      body: JSON.stringify({ ...data, revision }),
    });
    revision = result.revision;
    dirty = false;
    $('#save').textContent = 'Saved';
    message(
      'Settings saved. The scheduler will apply them after the current run, or within a few seconds while idle.',
    );
    await refreshStatus();
  } catch (error) {
    message(error.message, true);
    $('#save').disabled = false;
  }
});
$('#reload').addEventListener('click', () => {
  if (!dirty || confirm('Discard your unsaved changes and reload settings?'))
    load().catch(error => message(error.message, true));
});
$('#general').addEventListener('click', () => {
  selected = 'general';
  render();
});
$('#add-store').addEventListener('click', addStore);
$('#store-list').addEventListener('click', event => {
  const target = event.target.closest('[data-select]');
  if (target) {
    selected = target.dataset.select;
    render();
  }
});
$('#editor').addEventListener('input', event => {
  const input = event.target,
    path = input.dataset.path;
  if (!path || input.readOnly) return;
  if (input.hasAttribute('data-optional') && input.value === '') {
    const keys = path.split('.');
    delete readPath(keys.slice(0, -1).join('.'))?.[keys.at(-1)];
    changed();
    return;
  }
  let value =
    input.type === 'checkbox'
      ? input.checked
      : input.type === 'number'
        ? Number(input.value) *
          (input.hasAttribute('data-ms') ? 1000 : Number(input.dataset.scale || 1))
        : input.value;
  if (input.hasAttribute('data-list'))
    value = input.value
      .split('\n')
      .map(term => term.trim())
      .filter(Boolean);
  writePath(path, value);
  if (path.endsWith('.name') || path.endsWith('.url')) renderList();
});
$('#editor').addEventListener('change', event => {
  const input = event.target,
    site = data.sites.find(site => site.slug === selected);
  if (!site) return;
  if (
    input.dataset.path?.endsWith('.productHandle') ||
    input.dataset.path?.endsWith('.productHandle2')
  ) {
    const value = input.value.trim();
    if (/^https?:\/\//.test(value)) {
      try {
        const url = new URL(value);
        const match = url.pathname.match(/\/products\/([^/]+)\/?$/);
        if (match) {
          const handle = decodeURIComponent(match[1]);
          input.value = handle;
          writePath(input.dataset.path, handle);
        }
      } catch {
        /* Save validation will explain invalid values. */
      }
    }
  }
  const jobs = storeJobs(site);
  if (input.dataset.window !== undefined) {
    const job = jobs[Number(input.dataset.window)];
    if (input.checked)
      job.window = {
        timezone: site.timezoneId || 'UTC',
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        start: '08:00',
        end: '20:00',
      };
    else delete job.window;
    changed();
    render();
  }
  if (input.dataset.project) {
    const job = jobs[Number(input.dataset.job)];
    job.projects = input.checked
      ? [...new Set([...(job.projects || ['Desktop Chrome']), input.dataset.project])]
      : (job.projects || ['Desktop Chrome']).filter(project => project !== input.dataset.project);
    changed();
  }
  if (input.dataset.day) {
    const window = jobs[Number(input.dataset.job)].window,
      day = Number(input.dataset.day);
    window.weekdays = input.checked
      ? [...new Set([...(window.weekdays || [1, 2, 3, 4, 5, 6, 7]), day])]
      : (window.weekdays || [1, 2, 3, 4, 5, 6, 7]).filter(value => value !== day);
    changed();
  }
  if (input.dataset.path?.endsWith('.enabled')) render();
});
$('#editor').addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.id === 'welcome-add') {
    addStore();
    return;
  }
  const site = data.sites.find(site => site.slug === selected);
  if (!site) return;
  if (button.dataset.action === 'add-job') {
    const jobs = storeJobs(site);
    let id = Date.now();
    while (jobs.some(job => job.id === `check-${id.toString(36)}`)) id++;
    jobs.push({
      id: `check-${id.toString(36)}`,
      mode: 'smoke',
      intervalMinutes: [360, 720],
      projects: ['Desktop Chrome'],
    });
    changed();
    render();
  }
  if (button.dataset.removeJob !== undefined) {
    storeJobs(site).splice(Number(button.dataset.removeJob), 1);
    changed();
    render();
  }
  if (
    button.dataset.action === 'remove-store' &&
    confirm(`Remove ${site.name || site.slug} from scheduled checks? Existing reports will remain.`)
  ) {
    data.sites = data.sites.filter(value => value !== site);
    delete data.scheduler.sites[site.slug];
    selected = data.sites[0]?.slug ?? null;
    changed();
    render();
  }
});
$('#import').addEventListener('click', async () => {
  try {
    const sitesFile = $('#import-sites').files[0],
      schedulerFile = $('#import-scheduler').files[0];
    if (!sitesFile || !schedulerFile) throw new Error('Choose both configuration files');
    const importedSites = JSON.parse(await sitesFile.text()),
      importedScheduler = JSON.parse(await schedulerFile.text());
    if (
      !Array.isArray(importedSites) ||
      !importedScheduler ||
      typeof importedScheduler !== 'object' ||
      Array.isArray(importedScheduler)
    )
      throw new Error('Choose a store list and a scheduler configuration');
    const validated = await api('/api/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Control-Token': token },
      body: JSON.stringify({ sites: importedSites, scheduler: importedScheduler }),
    });
    data = validated;
    data.scheduler.sites ||= {};
    selected = data.sites[0]?.slug ?? null;
    changed();
    render();
    message('Configuration loaded into the editor. Review it, then save to apply.');
  } catch (error) {
    message(error.message, true);
  }
});
window.addEventListener('beforeunload', event => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});
load().catch(error => message(error.message, true));
setInterval(refreshStatus, 10000);

let reportGroups = [],
  reportStore = 'overview',
  reportRun = null;
function showSection(section) {
  const reports = section === 'reports';
  $('#settings-view').hidden = reports;
  $('#reports-view').hidden = !reports;
  $('#reports-submenu').hidden = !reports;
  $('#settings-tab').classList.toggle('active', !reports);
  $('#reports-tab').classList.toggle('active', reports);
  $('#settings-tab').setAttribute('aria-pressed', String(!reports));
  $('#reports-tab').setAttribute('aria-pressed', String(reports));
  $('#reload').hidden = reports;
  if (reports) refreshReports();
}
function displayReport(url, title) {
  const frame = $('#report-frame');
  $('#report-empty').hidden = Boolean(url);
  frame.hidden = !url;
  frame.title = title || 'Report preview';
  if (url) {
    const target = new URL(url, location.origin);
    target.searchParams.set('embedded', '1');
    if (frame.getAttribute('src') !== target.pathname + target.search)
      frame.src = target.pathname + target.search;
  } else {
    frame.removeAttribute('src');
    $('#report-empty').textContent =
      'This run has no HTML report. It may have stopped before reporting completed.';
  }
}
function renderReports() {
  $('#reports-submenu').innerHTML =
    `<button data-report-store="overview" class="${reportStore === 'overview' ? 'active' : ''}" aria-pressed="${reportStore === 'overview'}">Overview</button>` +
    reportGroups
      .map(
        group =>
          `<button data-report-store="${escapeHTML(group.id)}" class="${reportStore === group.id ? 'active' : ''}" aria-pressed="${reportStore === group.id}">${escapeHTML(group.name)} <span class="badge">${group.runs.length}</span></button>`,
      )
      .join('');
  const group = reportGroups.find(group => group.id === reportStore);
  $('#reports-title').textContent = group ? group.name + ' reports' : 'All stores · run history';
  if (!group) {
    $('#report-list').innerHTML =
      '<h2>Summary</h2><p class="help">Select a store in the submenu to browse its individual runs.</p>';
    $('#reports-message').textContent = reportGroups.length
      ? `${reportGroups.length} stores with saved reports.`
      : 'No reports yet. They will appear here after the first check.';
    displayReport('/reports/dashboard.html', 'Report overview');
    return;
  }
  if (!group.runs.some(run => run.id === reportRun)) reportRun = group.runs[0]?.id ?? null;
  $('#reports-message').textContent = `${group.runs.length} saved runs · newest first`;
  $('#report-list').innerHTML = group.runs
    .map(
      run =>
        `<button class="report-choice ${reportRun === run.id ? 'active' : ''}" data-report-run="${escapeHTML(run.id)}" aria-pressed="${reportRun === run.id}">${escapeHTML(run.id.replace('_', ' · ').replace(/-(\d{2})-(\d{2})-(\d{3})$/, ':$1:$2.$3'))}<small>${escapeHTML(run.status.replaceAll('-', ' '))}${run.mode ? ' · ' + escapeHTML(run.mode) : ''}<br>${run.passed} passed · ${run.failed} failed${run.reportUrl ? '' : ' · No HTML report'}</small></button>`,
    )
    .join('');
  const run = group.runs.find(run => run.id === reportRun);
  displayReport(run?.reportUrl, group.name + ' · ' + (run?.id || 'report'));
}
async function refreshReports() {
  try {
    const result = await api('/api/reports');
    reportGroups = result.groups;
    if (reportStore !== 'overview' && !reportGroups.some(group => group.id === reportStore))
      reportStore = 'overview';
    renderReports();
  } catch (error) {
    $('#reports-message').textContent = error.message;
  }
}
$('#reports-tab').addEventListener('click', () => showSection('reports'));
$('#settings-tab').addEventListener('click', () => showSection('settings'));
$('#refresh-reports').addEventListener('click', refreshReports);
$('#reports-submenu').addEventListener('click', event => {
  const button = event.target.closest('[data-report-store]');
  if (button) {
    reportStore = button.dataset.reportStore;
    reportRun = null;
    renderReports();
  }
});
$('#report-list').addEventListener('click', event => {
  const button = event.target.closest('[data-report-run]');
  if (button) {
    reportRun = button.dataset.reportRun;
    renderReports();
  }
});
