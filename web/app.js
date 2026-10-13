'use strict';
let data,
  revision,
  token,
  selected = null,
  dirty = false,
  schedulerStatus;
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
// Shared Tailwind class sets. Every class is written out in full so the Tailwind compiler can detect it.
const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600';
const buttonBase = `inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const buttonKinds = {
  primary: 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700',
  quiet: 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  accent: 'border-blue-200 bg-white text-blue-700 hover:bg-blue-50',
  danger: 'border-red-200 bg-white text-red-700 hover:bg-red-50',
};
const buttonSizes = { md: 'px-4 py-2 text-sm', sm: 'px-3 py-1.5 text-xs' };
const button = (kind = 'quiet', size = 'md') =>
  `${buttonBase} ${buttonKinds[kind]} ${buttonSizes[size]}`;
const labelClass = 'flex flex-col gap-1.5 text-sm font-medium text-slate-700';
const inputClass =
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-500 [&[readonly]]:bg-slate-100 [&[readonly]]:text-slate-600 focus-visible:outline-2 focus-visible:outline-blue-600';
const checkLabelClass = 'inline-flex items-center gap-2 py-1 text-sm font-normal text-slate-700';
const checkboxClass = `size-4 rounded border-slate-300 accent-blue-600 ${focusRing}`;
const helpClass = 'mt-3 text-sm text-slate-600';
const summaryClass = `cursor-pointer rounded text-sm font-semibold text-slate-800 ${focusRing}`;
const noticeClasses = {
  info: 'mt-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 empty:hidden',
  error:
    'mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 empty:hidden',
};
const badgeTones = {
  green: 'bg-green-100 text-green-800',
  amber: 'bg-amber-100 text-amber-900',
  blue: 'bg-blue-100 text-blue-800',
  red: 'bg-red-100 text-red-800',
  slate: 'bg-slate-100 text-slate-700',
};
const badge = (text, tone = 'slate') =>
  `<span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${badgeTones[tone]}">${escapeHTML(text)}</span>`;
const statusTone = status =>
  ({
    running: 'blue',
    stopping: 'amber',
    queued: 'slate',
    passed: 'green',
    completed: 'green',
    failed: 'red',
    cancelled: 'slate',
  })[status] || 'slate';
const grid = body => `<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">${body}</div>`;
const help = text => `<p class="${helpClass}">${text}</p>`;
const sectionBlock = (title, body, actions = '') =>
  `<section class="mt-8 border-t border-slate-200 pt-6"><div class="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 class="text-lg font-semibold text-slate-900">${title}</h2>${actions}</div>${body}</section>`;
const disclosure = (title, body) =>
  `<details class="mt-8 border-t border-slate-200 pt-5"><summary class="${summaryClass}">${title}</summary><div class="mt-4">${body}</div></details>`;
function setNotice(element, text, error = false) {
  element.textContent = text;
  element.className = noticeClasses[error ? 'error' : 'info'];
}
function message(text, error = false) {
  setNotice($('#message'), text, error);
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
  return `<label class="${labelClass}">${escapeHTML(label)}<input class="${inputClass}" data-path="${escapeHTML(path)}" data-scale="${scale}" type="${type}" value="${escapeHTML(type === 'number' && value !== '' ? value / scale : value)}" ${type === 'number' ? 'min="0" step="any"' : ''} ${extra}></label>`;
}
function selectField(label, path, choices, current, extra = '', wide = false) {
  return `<label class="${labelClass} ${wide ? 'sm:col-span-2' : ''}">${escapeHTML(label)}<select class="${inputClass}" aria-label="${escapeHTML(label)}" data-path="${escapeHTML(path)}" ${extra}>${choices
    .map(
      ([value, text]) =>
        `<option value="${escapeHTML(value)}" ${current === value ? 'selected' : ''}>${escapeHTML(text)}</option>`,
    )
    .join('')}</select></label>`;
}
function checkbox(label, path, value) {
  return `<label class="${checkLabelClass}"><input class="${checkboxClass}" type="checkbox" data-path="${escapeHTML(path)}" ${value ? 'checked' : ''}>${escapeHTML(label)}</label>`;
}
function storeSchedule(site) {
  return (data.scheduler.sites[site.slug] ??= {});
}
function storeJobs(site) {
  return storeSchedule(site).jobs ?? data.scheduler.defaults?.jobs ?? [];
}
function renderList() {
  $('#store-list').innerHTML = data.sites
    .map(site => {
      const active = site.slug === selected;
      return `<button class="w-full rounded-lg px-3 py-2.5 text-left text-sm font-semibold break-words ${active ? 'bg-blue-50 text-blue-800' : 'text-slate-700 hover:bg-slate-50'} ${focusRing}" ${active ? 'aria-current="true"' : ''} data-select="${escapeHTML(site.slug)}">${escapeHTML(site.name || site.slug)}<small class="mt-1 block text-xs font-normal break-words text-slate-600">${escapeHTML(site.url || 'Enter a store address')} · ${storeSchedule(site).enabled === false ? 'Paused' : 'Enabled'}</small></button>`;
    })
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
  const woo = site.platform === 'woocommerce';
  const products = woo
    ? `<label class="${labelClass} sm:col-span-2">WooCommerce product URLs<textarea class="${inputClass} min-h-24" aria-label="WooCommerce product URLs" data-path="${base}.commerce.productUrls" data-list>${escapeHTML((site.commerce?.productUrls || []).join('\n'))}</textarea></label>${field('Catalog path', `${base}.commerce.routes.catalog`, site.commerce?.routes?.catalog || 'shop/')}${field('Cart path', `${base}.commerce.routes.cart`, site.commerce?.routes?.cart || 'cart/')}${field('Checkout path', `${base}.commerce.routes.checkout`, site.commerce?.routes?.checkout || 'checkout/')}${selectField(
        'Cart prices include tax',
        `${base}.commerce.taxDisplay`,
        [
          ['auto', 'Detect from frontend'],
          ['including', 'Including tax'],
          ['excluding', 'Excluding tax'],
        ],
        site.commerce?.taxDisplay || 'auto',
      )}`
    : `${field('First product URL or handle', `${base}.productHandle`, site.productHandle)}${field('Second product URL or handle', `${base}.productHandle2`, site.productHandle2)}`;
  const heading = `<div class="flex flex-wrap items-center justify-between gap-3"><h2 class="text-xl font-semibold break-words text-slate-900">${escapeHTML(site.name || 'Store settings')}</h2>${schedule.enabled === false ? badge('Paused', 'amber') : badge('Scheduled', 'green')}</div>`;
  const basics = `<div class="mt-5">${grid(
    `${field('Store name', `${base}.name`, site.name)}${field('Store address', `${base}.url`, site.url, 'url')}${selectField(
      'Platform',
      `${base}.platform`,
      [
        ['shopify', 'Shopify'],
        ['woocommerce', 'WooCommerce'],
      ],
      woo ? 'woocommerce' : 'shopify',
    )}${products}${field('Search term', `${base}.searchTerm`, site.searchTerm)}${field('Report ID', `${base}.slug`, site.slug, 'text', 1, 'readonly')}${field('Language / locale', `${base}.locale`, site.locale || 'bg-BG')}${field('Timezone', `${base}.timezoneId`, site.timezoneId || 'Europe/Sofia')}`,
  )}${help(woo ? 'Enter one public product URL per line. Adjust the store paths to match its WordPress installation. Checks use the public Store API and never submit an order.' : 'Paste product addresses or enter the part after /products/. Use two products suitable for cart checks.')}</div>`;
  const schedulePart = sectionBlock(
    'Check schedule',
    `${checkbox('Enable scheduled checks for this store', `scheduler.sites.${site.slug}.enabled`, schedule.enabled !== false)}<p class="text-sm text-slate-600">Intervals start after a check finishes. Only one store runs at a time.</p>${jobs.map((job, j) => renderJob(job, `${jobBase}.${j}`, j, site.timezoneId || 'Europe/Sofia')).join('')}${jobs.length ? '' : '<p class="mt-3 text-sm text-slate-600">Add at least one check before enabling this store.</p>'}`,
    `<button class="${button('quiet', 'sm')}" data-action="add-job">+ Add check</button>`,
  );
  const content = disclosure(
    'Content and request settings',
    `${grid(
      `${selectField(
        'Spelling behavior',
        `${base}.spelling.mode`,
        ['off', 'report', 'strict'].map(mode => [mode, mode]),
        spelling.mode || 'report',
      )}<label class="${labelClass}">Accepted brand names and terms<textarea class="${inputClass} min-h-24" data-path="${base}.spelling.allowWords" data-list>${escapeHTML((spelling.allowWords || []).join('\n'))}</textarea></label>`,
    )}${help('Enter one accepted term per line. Strict spelling can fail for brand names or unknown words.')}<div class="mt-4">${grid(renderPacing(schedule.pacing || {}, `scheduler.sites.${site.slug}.pacing`, true))}</div>${help('Blank fields inherit the general pauses.')}`,
  );
  const footer = `<div class="mt-8 flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between"><p class="text-sm text-slate-600">Existing reports remain when a store is removed.</p><button class="${button('danger')}" data-action="remove-store">Remove store</button></div>`;
  editor.innerHTML = `${heading}${basics}${schedulePart}${renderCookieConsent(site, base)}${renderCheckoutPolicy(site, base)}${renderMonitoring(site, base)}${content}${footer}`;
  renderJobStatus();
}
function renderMonitoring(site, base) {
  const expected = site.expectations || {};
  return disclosure(
    'Store expectations and monitoring',
    `${grid(
      `${field('Minimum public products (0 disables)', `${base}.expectations.minProducts`, expected.minProducts || 0, 'number', 1, 'max="100"')}${field('Expected currency (ISO code)', `${base}.expectations.currency`, expected.currency || '')}${field('Expected payment control selector', `${base}.expectations.paymentSelector`, expected.paymentSelector || '')}${field('Payment check path', `${base}.expectations.paymentPath`, expected.paymentPath || '/checkout')}`,
    )}${help('Payment checks require one visible, enabled control on this path; they never submit a payment. Product minimum is limited to 100.')}
  ${checkbox('Monitor third-party scripts', `${base}.monitorScripts`, site.monitorScripts || false)}
  ${checkbox('Enable change notifications', `${base}.notifications.enabled`, site.notifications?.enabled || false)}
  ${field('Webhook environment variable', `${base}.notifications.webhookEnv`, site.notifications?.webhookEnv || 'MONITORING_WEBHOOK_URL')}
  ${help('Set the webhook URL in the runner environment. Maintenance windows use notifications.maintenance with UTC start/end timestamps in the configuration. Delivery failures appear in Reports.')}`,
  );
}

function renderCookieConsent(site, base) {
  const consent = site.cookieConsent || {};
  return sectionBlock(
    'Cookie consent',
    `<p class="mb-4 text-sm text-slate-600">Choose how normal tests handle cookie banners. Accepted cookies and local storage are reused across the run. GDPR checks use fresh sessions to test consent separately.</p>${grid(
      `${selectField(
        'Cookie consent behavior',
        `${base}.cookieConsent.mode`,
        [
          ['accept-all', 'Accept all cookies'],
          ['none', 'Leave banner untouched'],
        ],
        consent.mode === 'none' ? 'none' : 'accept-all',
      )}<label class="${labelClass}">Wait for cookie banner (seconds)<input class="${inputClass}" type="number" min="0" max="30" step="0.1" data-scale="1000" data-path="${base}.cookieConsent.waitMs" value="${(consent.waitMs ?? 5000) / 1000}"></label><label class="${labelClass}">Accept all button selector (optional)<input class="${inputClass}" data-optional data-path="${base}.selectors.consentAccept" value="${escapeHTML(site.selectors?.consentAccept || '')}" placeholder="#accept-all-cookies"></label><label class="${labelClass}">Consent iframe selector (optional)<input class="${inputClass}" data-path="${base}.cookieConsent.frameSelector" value="${escapeHTML(consent.frameSelector || '')}" placeholder="iframe#cookie-consent"></label>`,
    )}${help('Leave selectors blank for common banners. For a custom banner, use the CSS selector of its Accept all button. Activity records whether consent was accepted or no button was found.')}`,
  );
}
function renderCheckoutPolicy(site, base) {
  const policy = site.checkout || {};
  const select = (label, key, choices, fallback) =>
    selectField(label, `${base}.checkout.${key}`, choices, policy[key] || fallback);
  const expected = [
    ['required', 'Required'],
    ['not-applicable', 'Not applicable'],
    ['unverified', 'Not verified yet'],
  ];
  return disclosure(
    'Checkout expectations',
    `${grid(
      `${select(
        'Checkout interface',
        'mode',
        [
          ['auto', 'Detect supported interface'],
          ['supported', 'Expect configured interface'],
          ['unsupported', 'Unsupported provider'],
          ['blocked', 'Access blocked'],
        ],
        'auto',
      )}${select('Contact field expectation', 'contact', expected, 'required')}${select('Shipping address expectation', 'shippingAddress', expected, 'required')}${field('Checkout expectation reason', `${base}.checkout.reason`, policy.reason || '')}`,
    )}${help('Required fields must be visible and usable. For digital products, shipping can be marked not applicable. Staged or inaccessible fields can be marked not verified yet. Custom field selectors and address requirements are available in the configuration.')}`,
  );
}

function renderJob(job, base, index, timezone) {
  const checkedProjects = job.projects || ['Desktop Chrome'];
  const window = job.window;
  const weekdays = window?.weekdays || [1, 2, 3, 4, 5, 6, 7];
  const group = body => `<div class="mt-3 flex flex-wrap gap-x-5 gap-y-1">${body}</div>`;
  return `<div class="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4"><div class="mb-4 flex items-center justify-between gap-3"><h3 class="text-sm font-semibold text-slate-900">Check ${index + 1}</h3><button class="${button('quiet', 'sm')}" data-remove-job="${index}" aria-label="Remove check ${index + 1}">Remove</button></div>${grid(
    `${selectField(
      'What to check',
      `${base}.mode`,
      Object.entries(modes),
      job.mode,
      '',
      true,
    )}${field('At least (hours between checks)', `${base}.intervalMinutes.0`, job.intervalMinutes[0], 'number', 60)}${field('At most (hours between checks)', `${base}.intervalMinutes.1`, job.intervalMinutes[1], 'number', 60)}${field('Maximum run duration (hours)', `${base}.maxRunMinutes`, job.maxRunMinutes || data.scheduler.maxRunMinutes || 120, 'number', 60)}`,
  )}${help('The next interval is chosen randomly within this range. Equal values give a fixed interval.')}${group(projects.map(project => `<label class="${checkLabelClass}"><input class="${checkboxClass}" type="checkbox" data-project="${escapeHTML(project)}" data-job="${index}" ${checkedProjects.includes(project) ? 'checked' : ''}>${escapeHTML(project)}</label>`).join(''))}<div class="mt-2"><label class="${checkLabelClass}"><input class="${checkboxClass}" type="checkbox" data-window="${index}" ${window ? 'checked' : ''}>Only start within a time window</label></div>${window ? `<div class="mt-3">${grid(`${field('Window timezone', `${base}.window.timezone`, window.timezone || timezone)}${field('Start time', `${base}.window.start`, window.start, 'time')}${field('End time', `${base}.window.end`, window.end, 'time')}`)}</div>${group(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, d) => `<label class="${checkLabelClass}"><input class="${checkboxClass}" type="checkbox" data-day="${d + 1}" data-job="${index}" ${weekdays.includes(d + 1) ? 'checked' : ''}>${day}</label>`).join(''))}` : ''}<p class="mt-3 text-xs text-slate-600" data-job-status="${escapeHTML(job.id)}"></p></div>`;
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
    `<h2 class="text-xl font-semibold text-slate-900">Scheduling &amp; pauses</h2><p class="mt-1 mb-5 text-sm text-slate-600">These settings apply across all stores. Store-specific request pauses take precedence.</p>${grid(`${field('Spread first checks over (hours)', 'scheduler.startupSpreadMinutes', scheduler.startupSpreadMinutes ?? 60, 'number', 60)}${field('Pause between store runs (minutes)', 'scheduler.minGapMinutes', scheduler.minGapMinutes ?? 5, 'number')}${field('Maximum run duration (hours)', 'scheduler.maxRunMinutes', scheduler.maxRunMinutes ?? 120, 'number', 60)}`)}${sectionBlock('When a store limits requests', `${grid(`${field('First cooldown (hours)', 'scheduler.cooldown.rateLimitMinutes', cooldown.rateLimitMinutes ?? 360, 'number', 60)}${field('Maximum cooldown (hours)', 'scheduler.cooldown.maxRateLimitMinutes', cooldown.maxRateLimitMinutes ?? 10080, 'number', 60)}${field('Pause after failed checks (minutes)', 'scheduler.cooldown.failureMinutes', cooldown.failureMinutes ?? 30, 'number')}${field('Maximum failure pause (hours)', 'scheduler.cooldown.maxFailureMinutes', cooldown.maxFailureMinutes ?? 1440, 'number', 60)}`)}${help('Repeated failures double the pause up to the maximum. A longer Retry-After from the store is always respected.')}`)}${sectionBlock('Request pacing', `${grid(renderPacing(scheduler.pacing || {}, 'scheduler.pacing'))}${help('These pauses apply to tests and paced navigations/API requests. Static assets load normally.')}`)}`;
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
  await refreshRuns();
}
function renderJobStatus() {
  if (!schedulerStatus) return;
  for (const element of document.querySelectorAll('[data-job-status]')) {
    const job = schedulerStatus.jobs.find(
      job => job.site === selected && job.id === element.dataset.jobStatus,
    );
    element.textContent = job
      ? `Next eligible: ${job.nextAt ? new Date(job.nextAt).toLocaleString() : 'Waiting for scheduler'}${job.lastOutcome ? ' · Last: ' + job.lastOutcome : ''}`
      : 'Not saved to the scheduler yet';
  }
}
async function refreshStatus() {
  try {
    schedulerStatus = await api('/api/status');
    $('#worker').textContent = schedulerStatus.healthy
      ? '● Scheduler online'
      : '○ Scheduler starting or offline';
    $('#active').textContent = schedulerStatus.running
      ? `Running: ${schedulerStatus.running.key}`
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
  if (input.dataset.path?.endsWith('.platform')) {
    changed();
    render();
    return;
  }
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
setInterval(refreshStatus, 10000);

const chipClass = `inline-flex shrink-0 cursor-pointer items-center rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap text-slate-700 hover:bg-slate-50 aria-pressed:border-blue-600 aria-pressed:bg-blue-600 aria-pressed:text-white ${focusRing}`;
let reportGroups = [],
  reportStore = 'overview',
  reportRun = null;
function sectionURL(section) {
  const url = new URL(`/${section}`, location.origin);
  if (section === 'reports' && reportStore !== 'overview') {
    url.searchParams.set('store', reportStore);
    if (reportRun) url.searchParams.set('run', reportRun);
  }
  if (section === 'runs' && selectedRun) url.searchParams.set('run', selectedRun);
  return url.pathname + url.search;
}
function updateLocation(section) {
  const url = sectionURL(section);
  if (location.pathname + location.search !== url) history.pushState(null, '', url);
}
function restoreLocation() {
  const url = new URL(location.href);
  const section = url.pathname.split('/')[1] || (data?.sites.length ? 'runs' : 'settings');
  reportStore = url.searchParams.get('store') || 'overview';
  reportRun = url.searchParams.get('run');
  selectedRun = section === 'runs' ? url.searchParams.get('run') : null;
  showSection(section, false);
}
function showSection(section, navigate = true) {
  if (navigate) updateLocation(section);
  for (const name of ['runs', 'reports', 'settings']) {
    const active = section === name;
    $(`#${name}-view`).hidden = !active;
    if (active) $(`#${name}-tab`).setAttribute('aria-current', 'page');
    else $(`#${name}-tab`).removeAttribute('aria-current');
  }
  $('#reload').hidden = section !== 'settings';
  if (section === 'reports') refreshReports();
  if (section === 'runs') loadRunStores();
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
  $('#visual-review').hidden = true;
  $('#monitoring-history').innerHTML = '';
  $('#reports-submenu').innerHTML =
    `<button data-report-store="overview" class="${chipClass}" aria-pressed="${reportStore === 'overview'}">Overview</button>` +
    reportGroups
      .map(
        group =>
          `<button data-report-store="${escapeHTML(group.id)}" class="${chipClass}" aria-pressed="${reportStore === group.id}">${escapeHTML(group.name)} <span class="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">${group.runs.length}</span></button>`,
      )
      .join('');
  const group = reportGroups.find(group => group.id === reportStore);
  $('#delete-report').disabled = !group?.runs.length;
  $('#delete-store-reports').disabled = !group?.runs.length;
  $('#reports-title').textContent = group ? group.name + ' reports' : 'All stores · run history';
  if (!group) {
    $('#report-list').innerHTML =
      '<p class="text-sm text-slate-600">Select a store above to browse its individual runs.</p>';
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
        `<button class="block w-52 shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 aria-pressed:border-blue-300 aria-pressed:bg-blue-50 aria-pressed:text-blue-800 ${focusRing}" data-report-run="${escapeHTML(run.id)}" aria-pressed="${reportRun === run.id}">${escapeHTML(run.id.replace('_', ' · ').replace(/-(\d{2})-(\d{2})-(\d{3})$/, ':$1:$2.$3'))}<small class="mt-1 block text-xs font-normal text-slate-600">${escapeHTML(run.status.replaceAll('-', ' '))}${run.mode ? ' · ' + escapeHTML(run.mode) : ''}<br>${run.passed} passed · ${run.failed} failed${run.reportUrl ? '' : ' · No HTML report'}</small></button>`,
    )
    .join('');
  const run = group.runs.find(run => run.id === reportRun);
  renderMonitoringHistory(group, run);
  displayReport(run?.reportUrl, group.name + ' · ' + (run?.id || 'report'));
  if (group.id.startsWith('site:') && run) refreshVisual(group.id.slice(5), run.id);
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

async function removeReports(all) {
  const group = reportGroups.find(group => group.id === reportStore);
  if (!group) return;
  const ids = all ? group.runs.map(run => run.id) : [reportRun];
  if (!ids[0]) return;
  if (
    !confirm(
      all
        ? `Delete ${ids.length} reports for ${group.name}? They will be moved to the local report trash.`
        : `Delete report ${reportRun} for ${group.name}? It will be moved to the local report trash.`,
    )
  )
    return;
  $('#delete-report').disabled = true;
  $('#delete-store-reports').disabled = true;
  try {
    const result = await api('/api/reports/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Control-Token': token },
      body: JSON.stringify({ group: group.id, runs: ids }),
    });
    visualRequest++;
    visualReview = null;
    reportRun = null;
    $('#report-frame').removeAttribute('src');
    await refreshReports();
    history.replaceState(null, '', sectionURL('reports'));
    $('#reports-message').textContent = `${result.deleted} report(s) moved to local trash.`;
  } catch (error) {
    $('#reports-message').textContent = error.message;
    $('#delete-report').disabled = false;
    $('#delete-store-reports').disabled = false;
  }
}
$('#delete-report').addEventListener('click', () => removeReports(false));
$('#delete-store-reports').addEventListener('click', () => removeReports(true));
$('#refresh-reports').addEventListener('click', refreshReports);
$('#reports-submenu').addEventListener('click', event => {
  const button = event.target.closest('[data-report-store]');
  if (button) {
    reportStore = button.dataset.reportStore;
    reportRun = null;
    updateLocation('reports');
    renderReports();
  }
});
$('#report-list').addEventListener('click', event => {
  const button = event.target.closest('[data-report-run]');
  if (button) {
    reportRun = button.dataset.reportRun;
    updateLocation('reports');
    renderReports();
  }
});

let visualReview = null;
let visualRequest = 0;
async function refreshVisual(site, run) {
  const request = ++visualRequest;
  visualReview = null;
  $('#visual-message').textContent = '';
  try {
    const result = await api(
      `/api/visual?site=${encodeURIComponent(site)}&run=${encodeURIComponent(run)}`,
    );
    if (request !== visualRequest || reportStore !== 'site:' + site || reportRun !== run) return;
    visualReview = result;
    $('#visual-review').hidden = !result.entries.length;
    $('#visual-summary').textContent = result.revision
      ? `Approved version: ${result.revision} · ${result.approvedAt}`
      : 'No approved version yet. Review the candidates below.';
    if (!result.complete)
      $('#visual-summary').textContent += ' Wait for this run to finish before approving.';
    $('#visual-images').innerHTML = result.entries
      .map(entry => {
        const enabled = result.complete && entry.status !== 'error' && !entry.currentlyApproved;
        const figure = (title, url) =>
          `<figure class="min-w-0"><figcaption class="mb-2 text-sm font-semibold text-slate-800">${title}</figcaption>${url ? `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer" class="block rounded ${focusRing}"><img class="h-auto w-full rounded border border-slate-300" src="${escapeHTML(url)}" alt="${escapeHTML(title + ': ' + entry.name)}" loading="lazy"></a>` : '<p class="text-sm text-slate-600">No image available</p>'}</figure>`;
        return `<article class="rounded-lg border border-slate-300 p-4"><label class="${checkLabelClass}"><input class="${checkboxClass}" type="checkbox" data-visual-id="${escapeHTML(entry.id)}" ${enabled ? '' : 'disabled'}>${escapeHTML(entry.name)} · ${escapeHTML(entry.project)} · Run result: ${escapeHTML(entry.status)}${entry.currentlyApproved ? ' · Already approved' : ''}</label><p class="mt-2 text-sm text-slate-600">Compared with version: ${escapeHTML(entry.baselineRevision || 'none')} · Allowed difference: ${entry.maxDiffPixelRatio * 100}%</p><div class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">${figure('Baseline used by this run', entry.baselineUrl)}${figure('Candidate', entry.currentUrl)}${figure('Difference', entry.diffUrl)}${entry.approvedUrl && entry.baselineRevision !== result.revision ? figure('Currently approved', entry.approvedUrl) : ''}</div></article>`;
      })
      .join('');
    $('#approve-visual').disabled = true;
  } catch (error) {
    if (request === visualRequest) $('#reports-message').textContent = error.message;
  }
}
$('#visual-images').addEventListener('change', () => {
  $('#approve-visual').disabled = !$('#visual-images').querySelector('input:checked');
});
$('#approve-visual').addEventListener('click', async () => {
  const reviewed = visualReview;
  if (!reviewed) return;
  const ids = [...$('#visual-images').querySelectorAll('input:checked')].map(
    input => input.dataset.visualId,
  );
  if (
    !ids.length ||
    !confirm(
      `Approve ${ids.length} screenshot(s) as the correct appearance for ${reviewed.site}? Future checks will compare against these images until you approve another version.`,
    )
  )
    return;
  $('#approve-visual').disabled = true;
  try {
    const result = await api('/api/visual/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Control-Token': token },
      body: JSON.stringify({
        site: reviewed.site,
        run: reviewed.run,
        revision: reviewed.revision,
        ids,
      }),
    });
    await refreshVisual(reviewed.site, reviewed.run);
    $('#visual-message').textContent =
      `Approved ${result.approvedCount} screenshot(s). Future runs will use the new approved version. Historical results remain unchanged.`;
  } catch (error) {
    $('#visual-message').textContent = error.message;
    $('#approve-visual').disabled = false;
  }
});

let selectedRun = null,
  runPolling = false;
$('#run-mode').innerHTML = Object.entries(modes)
  .map(([mode, title]) => `<option value="${mode}">${title}</option>`)
  .join('');
$('#run-projects').innerHTML = projects
  .map(
    (project, index) =>
      `<label class="${checkLabelClass}"><input class="${checkboxClass}" type="checkbox" name="run-project" value="${escapeHTML(project)}" ${index === 0 ? 'checked' : ''}>${escapeHTML(project)}</label>`,
  )
  .join('');
function runsMessage(text, error = false) {
  setNotice($('#runs-message'), text, error);
}
async function loadRunStores() {
  try {
    const saved = await api('/api/config');
    const previous = $('#run-store').value;
    $('#run-store').innerHTML = saved.sites.length
      ? saved.sites
          .map(
            site =>
              `<option value="${escapeHTML(site.slug)}">${escapeHTML(site.name || site.slug)}</option>`,
          )
          .join('')
      : '<option value="">Add and save a store in Settings first</option>';
    if (saved.sites.some(site => site.slug === previous)) $('#run-store').value = previous;
    $('#enqueue-run').disabled = $('#run-now').disabled = !saved.sites.length;
    await refreshRuns();
  } catch (error) {
    runsMessage(error.message, true);
  }
}
const emptyNote = text => `<p class="py-1 text-sm text-slate-600">${text}</p>`;
function runCard(run, action = '', canForce = false) {
  const waiting = run.waitReason
    ? `<br>${escapeHTML(run.waitReason)} · Eligible: ${escapeHTML(new Date(run.eligibleAt).toLocaleString())}`
    : '';
  const forced = run.forced && run.status === 'queued' ? badge('Forced', 'blue') : '';
  const force =
    canForce && !run.forced
      ? `<button class="${button('accent', 'sm')}" data-run-force="${escapeHTML(run.id)}">Run now</button>`
      : '';
  const stop = action
    ? `<button class="${button('danger', 'sm')}" data-run-cancel="${escapeHTML(run.id)}" ${run.status === 'stopping' ? 'disabled' : ''}>${action}</button>`
    : '';
  return `<article class="flex flex-col gap-2 border-b border-slate-200 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"><button class="min-w-0 flex-1 cursor-pointer rounded-lg px-2 py-1 text-left break-words hover:bg-slate-50 aria-[current=true]:bg-blue-50 ${focusRing}" ${run.id === selectedRun ? 'aria-current="true"' : ''} data-run-select="${escapeHTML(run.id)}"><span class="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">${escapeHTML(run.name || run.site)} · ${escapeHTML(run.mode)} ${badge(run.status, statusTone(run.status))} ${forced}</span><small class="mt-1 block text-xs text-slate-600">${escapeHTML(run.source)} · ${escapeHTML(run.projects.join(', '))}${waiting}</small></button><div class="flex shrink-0 flex-wrap gap-2">${force}${stop}</div></article>`;
}
async function refreshRuns() {
  if (runPolling) return;
  runPolling = true;
  try {
    const [runs, status] = await Promise.all([api('/api/runs'), api('/api/status')]);
    $('#run-active').innerHTML = runs.active
      ? runCard(runs.active, runs.active.status === 'stopping' ? 'Stopping…' : 'Stop run')
      : emptyNote('No active run');
    $('#run-pending').innerHTML = runs.pending.length
      ? runs.pending.map(run => runCard(run, 'Remove', true)).join('')
      : emptyNote('Queue is empty');
    $('#run-scheduled').innerHTML =
      [...status.jobs]
        .sort((a, b) => (a.nextAt || Infinity) - (b.nextAt || Infinity))
        .map(
          job =>
            `<p class="border-b border-slate-200 py-2 text-sm text-slate-800 last:border-b-0">${escapeHTML(job.site)} · ${escapeHTML(job.mode)}<small class="block text-xs text-slate-600">Next eligible: ${job.nextAt ? escapeHTML(new Date(job.nextAt).toLocaleString()) : 'Waiting for scheduler'}</small></p>`,
        )
        .join('') || emptyNote('No scheduled checks');
    $('#run-history').innerHTML =
      runs.history
        .slice(0, 15)
        .map(run => runCard(run))
        .join('') || emptyNote('No completed runs yet');
    if (!selectedRun && runs.active) selectedRun = runs.active.id;
    const liveRun = runs.active || runs.history[0];
    let liveDetail = null;
    if (liveRun) liveDetail = await api(`/api/runs/details?id=${encodeURIComponent(liveRun.id)}`);
    renderActivity(runs, status, liveDetail);
    const selected = [runs.active, ...runs.pending, ...runs.history].find(
      run => run?.id === selectedRun,
    );
    if (selected && !$('#runs-view').hidden) {
      const detail =
        selectedRun === liveRun?.id
          ? liveDetail
          : await api(`/api/runs/details?id=${encodeURIComponent(selectedRun)}`);
      renderRunDetails(detail);
    }
  } catch (error) {
    runsMessage(`Live updates unavailable: ${error.message}`, true);
    $('#activity-state').textContent = 'Connection unavailable · reconnecting…';
  } finally {
    runPolling = false;
  }
}
const eventRowClass =
  'border-b border-slate-100 py-1.5 text-sm break-words text-slate-800 last:border-b-0';
function renderRunDetails({ run, events, log }) {
  $('#run-detail-title').textContent = `${run.name || run.site} · ${run.mode} · ${run.status}`;
  const last = type => events.findLast(event => event.type === type);
  const progress = events.findLast(event => typeof event.total === 'number');
  $('#run-progress').innerHTML = progress
    ? `<p>${progress.completed} / ${progress.total} checks completed</p><progress class="mt-2 h-2 w-full overflow-hidden rounded-full [&::-moz-progress-bar]:bg-blue-600 [&::-webkit-progress-bar]:bg-slate-200 [&::-webkit-progress-value]:bg-blue-600" max="${Math.max(progress.total, 1)}" value="${progress.completed}" aria-label="Checks completed"></progress>`
    : emptyNote('Waiting for test progress…');
  const test = last('test'),
    step = events.findLast(event => event.type === 'step' && (!test || event.time >= test.time)),
    url = events.findLast(event => event.type === 'url' && (!test || event.time >= test.time));
  $('#run-current').innerHTML = [
    ['Test', test?.title],
    ['Browser / file', test ? `${test.project} / ${test.file}` : ''],
    ['Step', step?.title],
    ['URL / API', url?.url],
    ['Last result', last('result')?.status],
    ['Started', run.startedAt ? new Date(run.startedAt).toLocaleString() : ''],
    ['Finished', run.finishedAt ? new Date(run.finishedAt).toLocaleString() : ''],
  ]
    .map(
      ([label, value]) =>
        `<div class="border-b border-slate-100 py-2 sm:grid sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3"><dt class="font-semibold text-slate-700">${label}</dt><dd class="text-slate-900">${escapeHTML(value || '—')}</dd></div>`,
    )
    .join('');
  const list = $('#run-events'),
    atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 30;
  list.innerHTML =
    events
      .slice(-60)
      .map(
        event =>
          `<p class="${eventRowClass}"><time class="tabular-nums text-slate-600">${escapeHTML(new Date(event.time).toLocaleTimeString())}</time> ${escapeHTML(event.type)} · ${escapeHTML(event.url || event.title || `${event.completed || 0} / ${event.total || 0}`)}${event.status ? ' · ' + escapeHTML(event.status) : ''}</p>`,
      )
      .join('') ||
    `<p class="${eventRowClass} text-slate-600">Activity appears when checks start.</p>`;
  if (atBottom) list.scrollTop = list.scrollHeight;
  $('#run-log').textContent = log || 'No runner output yet.';
}

$('#run-form').addEventListener('submit', async event => {
  event.preventDefault();
  const immediate = event.submitter?.id === 'run-now';
  const buttons = [$('#enqueue-run'), $('#run-now')];
  buttons.forEach(button => (button.disabled = true));
  try {
    const selectedProjects = [...document.querySelectorAll('[name="run-project"]:checked')].map(
      input => input.value,
    );
    if (!selectedProjects.length) throw new Error('Select at least one browser');
    await api('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Control-Token': token },
      body: JSON.stringify({
        site: $('#run-store').value,
        mode: $('#run-mode').value,
        projects: selectedProjects,
        immediate,
      }),
    });
    runsMessage(
      immediate
        ? 'Forced run submitted. It starts as soon as the current run finishes.'
        : 'Run submitted. It will appear in the queue within a second.',
    );
    selectedRun = null;
    await refreshRuns();
  } catch (error) {
    runsMessage(error.message, true);
  } finally {
    buttons.forEach(button => (button.disabled = !$('#run-store').value));
  }
});
document.addEventListener('click', async event => {
  const select = event.target.closest('[data-run-select]');
  if (select) {
    selectedRun = select.dataset.runSelect;
    updateLocation('runs');
    await refreshRuns();
  }
  const force = event.target.closest('[data-run-force]');
  if (force) {
    force.disabled = true;
    try {
      await api('/api/runs/force', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Control-Token': token },
        body: JSON.stringify({ id: force.dataset.runForce }),
      });
      runsMessage('Moved to the front. It starts as soon as the current run finishes.');
      await refreshRuns();
    } catch (error) {
      runsMessage(error.message, true);
      force.disabled = false;
    }
  }
  const cancel = event.target.closest('[data-run-cancel]');
  if (cancel) {
    cancel.disabled = true;
    try {
      await api('/api/runs/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Control-Token': token },
        body: JSON.stringify({ id: cancel.dataset.runCancel }),
      });
      runsMessage('Stop/remove requested.');
      await refreshRuns();
    } catch (error) {
      runsMessage(error.message, true);
      cancel.disabled = false;
    }
  }
});
setInterval(refreshRuns, 1000);

function renderActivity(runs, status, detail) {
  const run = runs.active;
  $('#activity-state').textContent =
    `${status.healthy ? '● Worker online' : '○ Worker offline'} · ${run ? `${run.name || run.site} · ${run.mode} · ${run.status}` : 'No active run'} · ${runs.pending.length} queued`;
  $('#activity-controls').innerHTML = run
    ? `<button class="${button('danger', 'sm')}" data-run-cancel="${escapeHTML(run.id)}" ${run.status === 'stopping' ? 'disabled' : ''}>${run.status === 'stopping' ? 'Stopping…' : 'Stop run'}</button>`
    : '';
  const events = detail?.events || [];
  const test = events.findLast(event => event.type === 'test');
  const url = events.findLast(event => event.type === 'url' && (!test || event.time >= test.time));
  const progress = events.findLast(event => typeof event.total === 'number');
  $('#activity-test').textContent =
    `${run ? 'Current' : 'Last run'}: ${test?.title || (run ? 'Starting checks…' : detail ? detail.run.status : 'No activity yet')}${progress ? ` · ${progress.completed}/${progress.total}` : ''}`;
  $('#activity-url').textContent = url?.url || '';
  const feed = $('#activity-feed');
  const atBottom = feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 30;
  feed.innerHTML =
    events
      .slice(-30)
      .map(
        event =>
          `<p class="${eventRowClass}"><time class="tabular-nums text-slate-600">${escapeHTML(new Date(event.time).toLocaleTimeString())}</time> ${escapeHTML(event.url || event.title || `${event.completed || 0}/${event.total || 0} checks`)}${event.status ? ' · ' + escapeHTML(event.status) : ''}</p>`,
      )
      .join('') ||
    `<p class="${eventRowClass} text-slate-600">Activity will appear here when a run starts.</p>`;
  if (atBottom) feed.scrollTop = feed.scrollHeight;
}
$('#activity-open').addEventListener('click', () => showSection('runs'));
function setActivityDetails(open) {
  $('#activity-details').hidden = !open;
  $('#activity-toggle').setAttribute('aria-expanded', String(open));
  $('#activity-toggle').textContent = open ? 'Hide details' : 'Show details';
  localStorage.setItem('activity-details', open ? 'open' : 'closed');
}
$('#activity-toggle').addEventListener('click', () =>
  setActivityDetails($('#activity-details').hidden),
);
// Collapsed by default so the persistent bar keeps the page usable; the choice is remembered.
setActivityDetails(localStorage.getItem('activity-details') === 'open');

for (const section of ['settings', 'reports', 'runs']) {
  $(`#${section}-tab`).addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0)
      return;
    event.preventDefault();
    showSection(section);
  });
}
window.addEventListener('popstate', restoreLocation);
load()
  .then(restoreLocation)
  .catch(error => message(error.message, true));

function renderMonitoringHistory(group, run) {
  if (!run) return;
  const history = group.runs
    .filter(item => item.scope === run.scope)
    .slice(0, 30)
    .reverse();
  const chart = (label, key, unit) => {
    const values = history.map(item => item[key]).filter(Number.isFinite);
    const maximum = Math.max(key === 'passRate' ? 100 : 1, ...values);
    const points = history
      .map((item, index) =>
        Number.isFinite(item[key])
          ? `<circle cx="${20 + (index * 560) / Math.max(1, history.length - 1)}" cy="${110 - (item[key] * 90) / maximum}" r="4"><title>${escapeHTML(item.id)}: ${item[key]}${unit}</title></circle>`
          : '',
      )
      .join('');
    const segments = history
      .slice(1)
      .map((item, index) =>
        Number.isFinite(item[key]) && Number.isFinite(history[index][key])
          ? `<line class="stroke-blue-700" x1="${20 + (index * 560) / Math.max(1, history.length - 1)}" y1="${110 - (history[index][key] * 90) / maximum}" x2="${20 + ((index + 1) * 560) / Math.max(1, history.length - 1)}" y2="${110 - (item[key] * 90) / maximum}" />`
          : '',
      )
      .join('');
    return `<figure class="min-w-0 rounded-lg border border-slate-200 bg-white p-4"><figcaption class="font-semibold">${label}</figcaption>${values.length ? `<svg class="mt-2 h-32 w-full fill-blue-700" viewBox="0 0 600 130" role="img" aria-label="${label}, oldest to newest; range 0–${Math.round(maximum)}${unit}"><line class="stroke-slate-300" x1="20" y1="110" x2="580" y2="110" />${segments}${points}</svg><p class="text-xs text-slate-600">Oldest → newest · 0–${Math.round(maximum)}${unit}</p>` : '<p class="mt-4 text-sm text-slate-600">Unmeasured: no samples in this scope.</p>'}</figure>`;
  };
  const candidates = reportGroups
    .flatMap(g => g.runs.map(r => ({ group: g, run: r })))
    .filter(item => item.group.id !== group.id);
  const failures = run.scenarios.filter(s => s.outcome === 'failed');
  $('#monitoring-history').innerHTML =
    `<h2 class="text-base font-semibold">Trends for the selected check scope</h2><p class="text-sm text-slate-600">Up to 30 comparable runs. LCP is the median of measured synthetic documents; missing values remain unmeasured.</p><div class="grid gap-4 md:grid-cols-2">${chart('Pass rate', 'passRate', '%')}${chart('Synthetic LCP', 'lcp', ' ms')}</div>
  <details><summary class="cursor-pointer rounded text-sm font-semibold ${focusRing}">Trend values</summary><div class="overflow-x-auto"><table class="w-full text-left text-sm"><thead><tr><th class="p-2">Run</th><th class="p-2">Pass rate</th><th class="p-2">Coverage</th><th class="p-2">LCP (ms)</th></tr></thead><tbody>${history.map(r => `<tr><td class="p-2">${escapeHTML(r.id)}</td><td class="p-2">${r.passRate ?? 'Unmeasured'}</td><td class="p-2">${r.coverage ?? 'Unmeasured'}</td><td class="p-2">${r.lcp ?? 'Unmeasured'}</td></tr>`).join('')}</tbody></table></div></details>
  <p class="text-sm text-slate-700">Notification delivery: ${escapeHTML(run.notifications.status || 'No delivery record')}${run.notifications.suppressed ? ' · Maintenance suppression' : ''}</p>
  ${failures.map(s => `<p class="text-sm text-red-800">${escapeHTML(s.classification)}: ${escapeHTML(s.name)}</p>`).join('')}
  ${['added', 'removed'].map(key => (run.scriptChanges[key] || []).map(url => `<p class="break-all text-sm text-slate-700">Script ${key}: ${escapeHTML(url)}</p>`).join('')).join('')}
  <label class="${labelClass}">Compare selected production run with candidate<select id="comparison-candidate" class="${inputClass}"><option value="">Select a saved candidate run</option>${candidates.map((item, index) => `<option value="${index}">${escapeHTML(item.group.name)} · ${escapeHTML(item.run.id)}</option>`).join('')}</select></label><div id="comparison-result" role="status" class="space-y-2 text-sm"></div>`;
  $('#comparison-candidate').addEventListener('change', async event => {
    const chosen = candidates[event.target.value];
    const output = $('#comparison-result');
    if (!chosen) {
      output.textContent = '';
      return;
    }
    const value = event.target.value;
    try {
      const result = await api(
        '/api/reports/compare?' +
          new URLSearchParams({
            productionStore: group.id,
            productionRun: run.id,
            candidateStore: chosen.group.id,
            candidateRun: chosen.run.id,
          }),
      );
      if (!output.isConnected || $('#comparison-candidate').value !== value) return;
      output.innerHTML =
        `<p>Matching checks only. Review store settings and data differences before attributing a regression to a theme change.</p><p>Candidate minus production: pass rate ${result.passRateDelta ?? 'unmeasured'} percentage points; synthetic LCP ${result.lcpDelta ?? 'unmeasured'} ms.</p>` +
        result.checks
          .map(
            check =>
              `<p>${escapeHTML(check.change)}: ${escapeHTML(check.check)} · ${escapeHTML(check.production)} → ${escapeHTML(check.candidate)}</p>`,
          )
          .join('');
    } catch (error) {
      if (output.isConnected) output.textContent = error.message;
    }
  });
}
