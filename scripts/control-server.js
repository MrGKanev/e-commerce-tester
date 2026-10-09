#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { readConfiguration, validateConfiguration } = require('./managed-config');
const { atomicWrite, loadState } = require('./scheduler');
const model = require('./scheduler-model');
const { catalog } = require('./report-catalog');
const root = path.join(__dirname, '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip',
  '.woff2': 'font/woff2',
};
function json(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(data));
}
async function body(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      const error = new Error('Configuration is too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Expected valid JSON');
  }
}
function staticFile(response, directory, relative) {
  let file;
  try {
    const base = fs.realpathSync(directory);
    file = fs.realpathSync(path.resolve(base, relative));
    if (!file.startsWith(base + path.sep) || !fs.statSync(file).isFile())
      return json(response, 404, { error: 'File not found' });
  } catch {
    return json(response, 404, { error: 'File not found' });
  }
  response.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  });
  fs.createReadStream(file).pipe(response);
}
function createControlServer({
  configFile,
  stateDir,
  reportsDir,
  webDir = path.join(root, 'web'),
}) {
  const token = randomBytes(32).toString('hex');
  return http.createServer(async (request, response) => {
    try {
      response.setHeader(
        'X-Frame-Options',
        request.url.startsWith('/reports/') ? 'SAMEORIGIN' : 'DENY',
      );
      response.setHeader('Referrer-Policy', 'same-origin');
      const url = new URL(request.url, 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/api/config') {
        const { data, revision } = readConfiguration(configFile);
        return json(response, 200, { ...data, revision, token });
      }
      if (
        (request.method === 'PUT' && url.pathname === '/api/config') ||
        (request.method === 'POST' && url.pathname === '/api/validate')
      ) {
        const origin = request.headers.origin;
        if (
          request.headers['x-control-token'] !== token ||
          (origin && new URL(origin).host !== request.headers.host)
        )
          return json(response, 403, { error: 'Reload this page before saving settings' });
        if (!request.headers['content-type']?.startsWith('application/json'))
          return json(response, 415, { error: 'Expected JSON configuration' });
        const input = await body(request);
        const data = { sites: input.sites, scheduler: input.scheduler };
        const validated = validateConfiguration(data);
        if (url.pathname === '/api/validate')
          return json(response, 200, {
            sites: validated.sites.map(({ settings: ignored, ...site }) => site),
            scheduler: data.scheduler,
          });
        const current = readConfiguration(configFile);
        if (input.revision !== current.revision)
          return json(response, 409, {
            error: 'Settings changed in another tab. Reload before saving your changes.',
          });
        fs.mkdirSync(path.dirname(configFile), { recursive: true });
        atomicWrite(configFile, data);
        return json(response, 200, { revision: readConfiguration(configFile).revision });
      }
      if (request.method === 'GET' && url.pathname === '/api/reports')
        return json(response, 200, {
          groups: catalog(reportsDir, readConfiguration(configFile).sites),
        });
      if (request.method === 'GET' && url.pathname === '/api/status') {
        const { config } = readConfiguration(configFile);
        const state = loadState(path.join(stateDir, 'schedule.json'));
        let heartbeat = null;
        try {
          heartbeat = JSON.parse(fs.readFileSync(path.join(stateDir, 'heartbeat.json'), 'utf8'));
        } catch {
          /* Not started yet. */
        }
        return json(response, 200, {
          healthy: Boolean(
            heartbeat && !heartbeat.stopping && Date.now() - heartbeat.updatedAt < 90000,
          ),
          running: state.running,
          jobs: config.jobs.map(job => ({
            site: job.site,
            id: job.id,
            mode: job.mode,
            nextAt: state.jobs[job.key] ? model.readyAt(state, job, Date.now()) : null,
            lastOutcome: state.jobs[job.key]?.lastOutcome ?? null,
          })),
          origins: state.origins,
        });
      }
      if (request.method === 'GET' && url.pathname === '/api/health')
        return json(response, 200, { ok: true });
      if (request.method !== 'GET' && request.method !== 'HEAD')
        return json(response, 405, { error: 'Method not allowed' });
      if (url.pathname.startsWith('/api/'))
        return json(response, 404, { error: 'Unknown endpoint' });
      const decoded = decodeURIComponent(url.pathname);
      if (decoded === '/reports/dashboard.html') {
        const file = path.join(reportsDir, 'dashboard.html');
        if (
          fs.existsSync(file) &&
          !fs.realpathSync(file).startsWith(fs.realpathSync(reportsDir) + path.sep)
        )
          return json(response, 404, { error: 'File not found' });
        const content = fs.existsSync(file)
          ? fs.readFileSync(file, 'utf8')
          : '<!doctype html><html lang="en"><title>Store Health · Reports</title><body style="font-family:system-ui;padding:40px"><h1>No reports yet</h1><p>Reports appear after the first completed check.</p></body></html>';
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        const embedded = url.searchParams.get('embedded') === '1';
        const navigation = embedded
          ? `<script>document.addEventListener('click',function(event){const link=event.target.closest('a');if(!link)return;const url=new URL(link.href,location.href);if(url.origin===location.origin && url.pathname.startsWith('/reports/') && url.pathname.endsWith('.html')){link.target='_self';}});</script>`
          : '<a href="/settings" style="position:fixed;bottom:20px;right:20px;background:#2563eb;color:white;padding:12px 18px;border-radius:8px;text-decoration:none;font:14px system-ui;z-index:1000">Manage stores & schedules</a>';
        response.end(content.replace('</body>', navigation + '</body>'));
        return;
      }
      if (decoded.startsWith('/reports/'))
        return staticFile(response, reportsDir, decoded.slice('/reports/'.length));
      if (decoded === '/' || decoded === '/settings')
        return staticFile(response, webDir, 'index.html');
      if (['/app.js', '/style.css'].includes(decoded))
        return staticFile(response, webDir, decoded.slice(1));
      return json(response, 404, { error: 'File not found' });
    } catch (error) {
      console.error(`[control] ${error.message}`);
      if (!response.headersSent) json(response, error.status || 400, { error: error.message });
      else response.end();
    }
  });
}
async function main() {
  if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
  const configFile =
    process.env.CONTROL_CONFIG_FILE || path.join(root, 'managed-config', 'configuration.json');
  const stateDir = process.env.SCHEDULER_STATE_DIR || path.join(root, 'scheduler-state');
  const reportsDir = path.join(root, 'reports');
  fs.mkdirSync(stateDir, { recursive: true });
  const server = createControlServer({ configFile, stateDir, reportsDir });
  let child;
  let restarting;
  let stopping = false;
  function startWorker() {
    if (stopping) return;
    child = spawn(
      process.execPath,
      [
        path.join(root, 'scripts/scheduler.js'),
        '--managed-config',
        configFile,
        '--state-dir',
        stateDir,
      ],
      { cwd: root, stdio: 'inherit' },
    );
    child.once('error', error =>
      console.error(`[control] Scheduler launch failed: ${error.message}`),
    );
    child.once('exit', () => {
      if (!stopping) restarting = setTimeout(startWorker, 5000);
    });
  }
  const stop = () => {
    if (stopping) return;
    stopping = true;
    clearTimeout(restarting);
    server.close();
    server.closeIdleConnections();
    child?.kill('SIGTERM');
    if (child && child.exitCode === null) {
      const timer = setTimeout(() => child?.kill('SIGKILL'), 20000);
      child.once('exit', () => clearTimeout(timer));
    }
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const port = Number(process.env.CONTROL_PORT || 8080);
  const host = process.env.CONTROL_HOST || '127.0.0.1';
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  console.log(
    `[control] Open http://${host === '0.0.0.0' ? 'localhost' : host}:${port} to manage stores and schedules`,
  );
  startWorker();
}
if (require.main === module)
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { createControlServer };
