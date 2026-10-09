'use strict';
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { validateSites } = require('./site-config');
const { resolveSchedule } = require('./scheduler-model');
function emptyConfiguration() {
  return {
    sites: [],
    scheduler: {
      startupSpreadMinutes: 60,
      minGapMinutes: 5,
      maxRunMinutes: 120,
      cooldown: {
        rateLimitMinutes: 360,
        maxRateLimitMinutes: 10080,
        failureMinutes: 30,
        maxFailureMinutes: 1440,
      },
      pacing: {
        testDelayMs: 5000,
        testJitterMs: 3000,
        requestDelayMs: 2000,
        requestJitterMs: 2000,
      },
      sites: {},
    },
  };
}
function validateConfiguration(data) {
  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data) ||
    Object.keys(data).some(key => !['sites', 'scheduler'].includes(key)) ||
    !Array.isArray(data.sites)
  )
    throw new Error('Configuration requires stores and a schedule');
  const sites = data.sites.length
    ? validateSites(data.sites, process.env, { requireHandles: true })
    : [];
  const config = resolveSchedule(data.scheduler, sites, { allowEmpty: true });
  return { sites, config };
}
function readConfiguration(file) {
  const data = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : emptyConfiguration();
  const { sites, config } = validateConfiguration(data);
  return {
    data,
    sites,
    config,
    revision: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
  };
}
module.exports = { emptyConfiguration, validateConfiguration, readConfiguration };
