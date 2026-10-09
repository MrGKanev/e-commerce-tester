'use strict';
const { createHash } = require('node:crypto');
const MINUTE = 60000;
const MODES = ['smoke', 'full', 'pages', 'content', 'visual', 'audit'];
const PROJECTS = [
  'Desktop Chrome',
  'Desktop Firefox',
  'Desktop Safari',
  'Mobile Chrome',
  'Mobile Safari',
];
function object(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new Error(`Unknown ${label} key: ${key}`);
}
function minutes(value, label, zero = false) {
  if (!Number.isFinite(value) || value < (zero ? 0 : 1) || value > 525600)
    throw new Error(`${label} must be ${zero ? '0' : '1'}–525600 minutes`);
  return value;
}
function range(value, label) {
  if (!Array.isArray(value) || value.length !== 2)
    throw new Error(`${label} must be [minimum, maximum] minutes`);
  value.forEach(v => minutes(v, label));
  if (value[0] > value[1]) throw new Error(`${label} minimum exceeds maximum`);
  return value;
}
function pacing(value = {}) {
  const names = {
    testDelayMs: 'TEST_DELAY_MS',
    testJitterMs: 'TEST_JITTER_MS',
    requestDelayMs: 'REQUEST_DELAY_MS',
    requestJitterMs: 'REQUEST_JITTER_MS',
  };
  object(value, Object.keys(names), 'pacing');
  for (const [key, val] of Object.entries(value))
    if (!Number.isFinite(val) || val < 0 || val > 86400000)
      throw new Error(`Invalid pacing.${key}`);
  return Object.fromEntries(Object.entries(value).map(([key, val]) => [names[key], String(val)]));
}
function resolveWindow(value) {
  if (value === undefined) return undefined;
  object(value, ['timezone', 'weekdays', 'start', 'end'], 'window');
  if (typeof value.timezone !== 'string') throw new Error('window.timezone is required');
  new Intl.DateTimeFormat('en', { timeZone: value.timezone });
  const weekdays = value.weekdays ?? [1, 2, 3, 4, 5, 6, 7];
  if (
    !Array.isArray(weekdays) ||
    !weekdays.length ||
    weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7) ||
    new Set(weekdays).size !== weekdays.length
  )
    throw new Error('window.weekdays must contain unique ISO weekdays 1–7');
  const clock = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (!clock(value.start) || !clock(value.end) || value.start >= value.end)
    throw new Error('window requires start < end in HH:MM format (same day)');
  return { timezone: value.timezone, weekdays, start: value.start, end: value.end };
}
const windowFormatters = new Map();
function nextWindowTime(time, window) {
  if (!window) return time;
  let formatter = windowFormatters.get(window.timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: window.timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    windowFormatters.set(window.timezone, formatter);
  }
  const days = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  for (
    let candidate = time;
    candidate <= time + 8 * 24 * 60 * MINUTE;
    candidate = Math.floor(candidate / MINUTE) * MINUTE + MINUTE
  ) {
    const parts = Object.fromEntries(
      formatter.formatToParts(candidate).map(part => [part.type, part.value]),
    );
    const clock = parts.hour + ':' + parts.minute;
    if (
      window.weekdays.includes(days[parts.weekday]) &&
      clock >= window.start &&
      clock < window.end
    )
      return candidate;
  }
  throw new Error('No eligible start in the configured window');
}
function resolveSchedule(input, sites) {
  object(
    input,
    [
      'startupSpreadMinutes',
      'minGapMinutes',
      'maxRunMinutes',
      'cooldown',
      'pacing',
      'defaults',
      'sites',
    ],
    'scheduler',
  );
  const config = {
    startupSpreadMinutes: minutes(input.startupSpreadMinutes ?? 60, 'startupSpreadMinutes', true),
    minGapMinutes: minutes(input.minGapMinutes ?? 5, 'minGapMinutes', true),
    maxRunMinutes: minutes(input.maxRunMinutes ?? 120, 'maxRunMinutes'),
    pacing: pacing(input.pacing),
    cooldown: {
      rateLimitMinutes: 360,
      maxRateLimitMinutes: 10080,
      failureMinutes: 30,
      maxFailureMinutes: 1440,
      ...(input.cooldown || {}),
    },
    jobs: [],
  };
  if (input.cooldown !== undefined)
    object(
      input.cooldown,
      Object.keys(config.cooldown).filter(k =>
        ['rateLimitMinutes', 'maxRateLimitMinutes', 'failureMinutes', 'maxFailureMinutes'].includes(
          k,
        ),
      ),
      'cooldown',
    );
  for (const [key, val] of Object.entries(config.cooldown)) minutes(val, `cooldown.${key}`);
  if (
    config.cooldown.rateLimitMinutes > config.cooldown.maxRateLimitMinutes ||
    config.cooldown.failureMinutes > config.cooldown.maxFailureMinutes
  )
    throw new Error('Cooldown minimum exceeds maximum');
  if (input.defaults !== undefined) object(input.defaults, ['jobs', 'pacing'], 'defaults');
  const overrides = input.sites ?? {};
  object(
    overrides,
    sites.map(site => site.slug),
    'sites',
  );
  for (const site of sites) {
    const override = overrides[site.slug] ?? {};
    object(override, ['enabled', 'jobs', 'pacing'], `sites.${site.slug}`);
    if (override.enabled !== undefined && typeof override.enabled !== 'boolean')
      throw new Error('enabled must be boolean');
    const sitePacing = {
      ...config.pacing,
      ...pacing(input.defaults?.pacing),
      ...pacing(override.pacing),
    };
    if (override.enabled === false) continue;
    const jobs = override.jobs ?? input.defaults?.jobs;
    if (!Array.isArray(jobs) || !jobs.length)
      throw new Error(`Configure at least one job for ${site.slug}, or disable it`);
    const ids = new Set();
    for (const job of jobs) {
      object(
        job,
        ['id', 'mode', 'intervalMinutes', 'projects', 'maxRunMinutes', 'window'],
        `job for ${site.slug}`,
      );
      if (
        typeof job.id !== 'string' ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(job.id) ||
        ids.has(job.id)
      )
        throw new Error(`Invalid or duplicate job id for ${site.slug}`);
      ids.add(job.id);
      if (!MODES.includes(job.mode)) throw new Error(`Invalid job mode: ${job.mode}`);
      const projects = job.projects ?? ['Desktop Chrome'];
      if (
        !Array.isArray(projects) ||
        !projects.length ||
        projects.some(p => !PROJECTS.includes(p)) ||
        new Set(projects).size !== projects.length
      )
        throw new Error('Invalid projects');
      config.jobs.push({
        key: `${site.slug}/${job.id}`,
        site: site.slug,
        origin: site.url,
        id: job.id,
        mode: job.mode,
        intervalMinutes: range(job.intervalMinutes, 'intervalMinutes'),
        projects,
        window: resolveWindow(job.window),
        maxRunMinutes: minutes(job.maxRunMinutes ?? config.maxRunMinutes, 'maxRunMinutes'),
        pacing: sitePacing,
      });
    }
  }
  if (!config.jobs.length) throw new Error('Scheduler has no enabled jobs');
  return config;
}
function randomDelay(bounds, random = Math.random) {
  return Math.round((bounds[0] + random() * (bounds[1] - bounds[0])) * MINUTE);
}
function blankState() {
  return { schemaVersion: 1, jobs: {}, origins: {}, nextDispatchAt: 0, running: null };
}
function validateState(state) {
  object(
    state,
    ['schemaVersion', 'jobs', 'origins', 'nextDispatchAt', 'running'],
    'scheduler state',
  );
  if (
    state.schemaVersion !== 1 ||
    !state.jobs ||
    !state.origins ||
    Array.isArray(state.jobs) ||
    Array.isArray(state.origins) ||
    typeof state.jobs !== 'object' ||
    typeof state.origins !== 'object' ||
    !Number.isFinite(state.nextDispatchAt)
  )
    throw new Error('Invalid scheduler state');
  for (const entry of Object.values(state.jobs))
    if (!entry || !Number.isFinite(entry.nextAt)) throw new Error('Invalid job state');
  for (const entry of Object.values(state.origins))
    if (
      !entry ||
      !Number.isFinite(entry.blockedUntil) ||
      !Number.isInteger(entry.rateLimitStreak) ||
      entry.rateLimitStreak < 0 ||
      !Number.isInteger(entry.failureStreak) ||
      entry.failureStreak < 0
    )
      throw new Error('Invalid origin state');
  if (
    state.running !== null &&
    (!state.running ||
      typeof state.running.key !== 'string' ||
      typeof state.running.origin !== 'string' ||
      !Number.isFinite(state.running.startedAt))
  )
    throw new Error('Invalid running state');
  return state;
}
function originState(state, origin) {
  return (state.origins[origin] ||= {
    blockedUntil: 0,
    rateLimitStreak: 0,
    failureStreak: 0,
    marker: '',
  });
}
function backoff(base, max, streak) {
  return Math.min(max, base * 2 ** Math.min(streak - 1, 30)) * MINUTE;
}
function retryAfterTime(value, receivedAt) {
  if (typeof value !== 'string' || !value.trim()) return 0;
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) {
    const expiry = receivedAt + Number(value) * 1000;
    return Number.isFinite(expiry) && expiry <= 8640000000000000 ? expiry : 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
function applyRateLimit(state, origin, raw, config, now, markerKey = origin) {
  const entry = originState(state, origin);
  const hash = createHash('sha256').update(raw).digest('hex');
  entry.markers ||= {};
  if (entry.markers[markerKey] === hash) return false;
  let marker = {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) marker = parsed;
  } catch {
    /* An unreadable marker still requires a cooldown. */
  }
  const receivedAt = Date.parse(marker.time);
  entry.rateLimitStreak++;
  entry.marker = hash;
  entry.markers[markerKey] = hash;
  entry.blockedUntil = Math.max(
    entry.blockedUntil,
    now +
      backoff(
        config.cooldown.rateLimitMinutes,
        config.cooldown.maxRateLimitMinutes,
        entry.rateLimitStreak,
      ),
    retryAfterTime(marker.retryAfter, Number.isFinite(receivedAt) ? receivedAt : now),
  );
  entry.reason = 'rate-limit';
  return true;
}
function initialize(state, config, now, random = Math.random) {
  if (state.running) {
    const entry = originState(state, state.running.origin);
    entry.failureStreak++;
    entry.blockedUntil = Math.max(
      entry.blockedUntil,
      now +
        backoff(
          config.cooldown.failureMinutes,
          config.cooldown.maxFailureMinutes,
          entry.failureStreak,
        ),
    );
    entry.reason = 'interrupted';
    const job = config.jobs.find(job => job.key === state.running.key);
    if (job)
      state.jobs[job.key] = {
        ...state.jobs[job.key],
        nextAt: now + randomDelay(job.intervalMinutes, random),
        lastOutcome: 'interrupted',
      };
    state.running = null;
  }
  for (const job of config.jobs) {
    originState(state, job.origin);
    if (!state.jobs[job.key] || state.jobs[job.key].nextAt < now)
      state.jobs[job.key] = {
        ...state.jobs[job.key],
        nextAt: now + randomDelay([0, config.startupSpreadMinutes], random),
      };
  }
  return state;
}
function readyAt(state, job, now = 0) {
  return nextWindowTime(
    Math.max(
      state.jobs[job.key].nextAt,
      originState(state, job.origin).blockedUntil,
      state.nextDispatchAt,
      now,
    ),
    job.window,
  );
}
function nextJob(state, config, now = 0) {
  return [...config.jobs].sort(
    (a, b) =>
      readyAt(state, a, now) - readyAt(state, b, now) ||
      state.jobs[a.key].nextAt - state.jobs[b.key].nextAt ||
      a.key.localeCompare(b.key),
  )[0];
}
function finish(state, job, config, now, outcome, rateLimited = false, random = Math.random) {
  const entry = originState(state, job.origin);
  if (!rateLimited) {
    if (outcome === 'passed') {
      entry.failureStreak = 0;
      entry.rateLimitStreak = 0;
      entry.reason = '';
    } else {
      entry.failureStreak++;
      entry.blockedUntil = Math.max(
        entry.blockedUntil,
        now +
          backoff(
            config.cooldown.failureMinutes,
            config.cooldown.maxFailureMinutes,
            entry.failureStreak,
          ),
      );
      entry.reason = outcome;
    }
  }
  state.jobs[job.key] = {
    nextAt: now + randomDelay(job.intervalMinutes, random),
    lastFinishedAt: now,
    lastOutcome: rateLimited ? 'rate-limit' : outcome,
  };
  state.nextDispatchAt = now + config.minGapMinutes * MINUTE;
  state.running = null;
}
module.exports = {
  MINUTE,
  resolveSchedule,
  blankState,
  validateState,
  initialize,
  nextJob,
  readyAt,
  finish,
  applyRateLimit,
  retryAfterTime,
  randomDelay,
  nextWindowTime,
  resolveWindow,
};
