import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { test, expect } from '../tests/fixtures';
import { resolveSiteSettings } from '../config/site-settings';
import { observeSecurityScenario, startSecurityObservation } from '../tests/security-monitoring';
import { approve, hash, type Scope, type Baseline } from '../scripts/security-model';
const css = fs.readFileSync(path.resolve(__dirname, '../web/tailwind.css'), 'utf8');
const origin = 'http://127.0.0.1:45996';
const scope = {
  site: 'security-local',
  project: 'fixture',
  page: 'home',
  role: 'storefront',
  choice: 'initial',
  profile: 'local',
  locale: 'en-US',
  timezoneId: 'UTC',
};
function config(overrides: Record<string, unknown> = {}) {
  return resolveSiteSettings({
    url: origin,
    securityMonitoring: { enabled: true, observeMs: 100, ...overrides },
  }).securityMonitoring;
}
async function fixture(
  page: import('@playwright/test').Page,
  body = '<script src="/same.js?variant=private-token"></script>',
  code = 'window.fixtureLoaded=true;',
  headers: Record<string, string> = {},
) {
  let scriptRequests = 0,
    writes = 0;
  await page.context().route('**/*', route => {
    const request = route.request(),
      url = new URL(request.url());
    if (request.method() === 'POST') writes++;
    if (url.pathname === '/same.js') {
      scriptRequests++;
      return route.fulfill({ contentType: 'application/javascript', body: code });
    }
    if (url.pathname === '/large.js')
      return route.fulfill({
        contentType: 'application/javascript',
        body: '/*' + 'x'.repeat(10000) + '*/',
      });
    if (url.pathname === '/failed.js') return route.abort('failed');
    if (url.pathname === '/late.js')
      return route.fulfill({
        contentType: 'application/javascript',
        body: 'window.lateObserved=true;',
      });
    if (url.pathname === '/worker.js')
      return route.fulfill({
        contentType: 'application/javascript',
        body: 'self.postMessage("ready");setInterval(()=>{},1000);',
      });
    if (url.pathname === '/jump.js')
      return route.fulfill({
        status: 302,
        headers: { location: '/same.js?variant=private-token' },
      });
    if (url.pathname === '/frame')
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><script>window.frameCode=true;</script>',
      });
    if (url.pathname === '/page')
      return route.fulfill({
        contentType: 'text/html',
        headers,
        body: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Security fixture</title><style>${css}</style></head><body class="bg-white text-slate-900"><main class="mx-auto max-w-3xl space-y-4 p-4"><h1 class="text-2xl font-bold">Security fixture</h1>${body}</main></body></html>`,
      });
    return route.fulfill({ status: 200, body: 'ok' });
  });
  return { counts: () => ({ scriptRequests, writes }) };
}
const observe = (
  page: import('@playwright/test').Page,
  settings = config(),
  baseline?: Baseline,
  changes = {},
) => observeSecurityScenario(page, settings, { ...scope, ...changes }, origin + '/page', baseline);

test('actual same-origin bytes are hashed without repeat fetching and secrets are absent from evidence', async ({
  page,
}) => {
  const server = await fixture(page);
  const report = await observe(page);
  expect(report.status).toBe('needs-review');
  expect(report.stages[0].coverage.complete).toBe(true);
  expect(
    report.stages[0].scripts.find(script => script.kind === 'external-response'),
  ).toMatchObject({ sha256: hash('window.fixtureLoaded=true;'), status: 'hashed' });
  expect(server.counts().scriptRequests).toBe(1);
  expect(JSON.stringify(report)).not.toMatch(/private-token|window.fixtureLoaded|variant=/);
  const baseline = approve(report, undefined, {
    reviewed: true,
    reason: 'Owned local fixture review',
  });
  expect((await observe(page, config(), baseline)).status).toBe('matches-baseline');
});

test('the same script URL with changed contents is reviewable even on a trusted origin', async ({
  page,
}) => {
  await fixture(page);
  const baseline = approve(await observe(page), undefined, {
    reviewed: true,
    reason: 'Owned local fixture review',
  });
  await page
    .context()
    .route('**/same.js?**', route =>
      route.fulfill({ contentType: 'application/javascript', body: 'window.changedVendor=true;' }),
    );
  const changed = await observe(page, config(), baseline);
  expect(changed.stages[0].findings.map(f => f.rule)).toContain('security-script-content-changed');
  expect(changed.status).toBe('needs-review');
});

test('a reviewed alternative digest is accepted without trusting all future vendor changes', async ({
  page,
}) => {
  await fixture(page);
  const baseline = approve(await observe(page), undefined, {
    reviewed: true,
    reason: 'Owned local fixture review',
  });
  await page
    .context()
    .route('**/same.js?**', route =>
      route.fulfill({ contentType: 'application/javascript', body: 'window.variantB=true;' }),
    );
  const next = await observe(page);
  const variants = approve(next, baseline, {
    reviewed: true,
    reason: 'Owned local fixture review',
    addVariant: true,
  });
  expect((await observe(page, config(), variants)).status).toBe('matches-baseline');
});

test('new POST/beacon/image/frame destinations are observed without retaining payloads', async ({
  page,
}) => {
  await fixture(
    page,
    '<script>fetch("https://analytics.test/collect?email=private-email",{method:"POST",body:"private-payload"}).catch(()=>{});navigator.sendBeacon("https://beacon.test/save","private-beacon");new Image().src="https://images.test/track?token=private-image";</script><iframe title="Local frame" src="https://frames.test/frame"></iframe>',
  );
  const report = await observe(page);
  const origins = report.stages[0].destinations.map(d => d.origin);
  expect(origins).toEqual(
    expect.arrayContaining([
      'https://analytics.test',
      'https://beacon.test',
      'https://images.test',
      'https://frames.test',
    ]),
  );
  expect(report.stages[0].scripts.some(s => s.context.startsWith('frame:'))).toBe(true);
  expect(JSON.stringify(report)).not.toMatch(
    /private-email|private-payload|private-beacon|private-image|collect\?/,
  );
});

test('a delayed loader and redirect final response are captured in the configured window', async ({
  page,
}) => {
  let scriptRequests = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/jump.js') {
      response.writeHead(302, { location: '/same.js' });
      response.end();
    } else if (request.url === '/same.js' || request.url === '/late.js') {
      if (request.url === '/same.js') scriptRequests++;
      response.writeHead(200, { 'content-type': 'application/javascript' });
      response.end('window.localLoaded=true;');
    } else {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(
        '<!doctype html><script src="/jump.js"></script><script>setTimeout(()=>{const s=document.createElement("script");s.src="/late.js";document.head.append(s);},30);</script>',
      );
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as import('node:net').AddressInfo).port;
    const report = await observeSecurityScenario(
      page,
      config({ observeMs: 200 }),
      scope,
      `http://127.0.0.1:${port}/page`,
    );
    expect(report.stages[0].scripts.some(s => s.redirectFromHash)).toBe(true);
    expect(report.stages[0].scripts.filter(s => s.kind === 'external-response')).toHaveLength(2);
    expect(scriptRequests).toBe(1);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

for (const source of ['/large.js', '/failed.js'])
  test(`unavailable or oversized scripts never become baseline matches: ${source}`, async ({
    page,
  }) => {
    await fixture(page, `<script src="${source}"></script>`);
    const report = await observe(
      page,
      config({ limits: { scriptBytes: 1000, totalScriptBytes: 2000 } }),
    );
    expect(report.status).toBe('unverified');
    expect(report.stages[0].coverage.complete).toBe(false);
    expect(() =>
      approve(report, undefined, { reviewed: true, reason: 'Owned local fixture review' }),
    ).toThrow('complete');
  });

test('request/inline/frame bounds retain explicit incomplete coverage', async ({ page }) => {
  await fixture(
    page,
    '<script>window.one=true;</script><script>window.two=true;</script><iframe title="Frame" src="/frame"></iframe>',
  );
  const bounded = await observe(page, config({ limits: { scripts: 1, requests: 1, frames: 1 } }));
  expect(bounded.status).toBe('unverified');
  expect(bounded.stages[0].coverage.complete).toBe(false);
});

test('known worker resources are observed; opaque worker bytes remain explicitly unavailable', async ({
  page,
}) => {
  await fixture(
    page,
    '<script>window.localWorker=new Worker("/worker.js");window.localWorker.onmessage=()=>window.workerReady=true;</script>',
  );
  const report = await observe(page, config({ observeMs: 500 }));
  const observed = report.stages[0].coverage.observedWorkers as Array<{
    origin: string;
    opaque: boolean;
  }>;
  expect(observed.length).toBeGreaterThan(0);
  expect(observed.every(worker => worker.origin === origin || worker.opaque)).toBe(true);
  if (observed.some(worker => worker.opaque)) {
    expect(report.status).toBe('unverified');
    expect(report.stages[0].coverage.complete).toBe(false);
  }
  await page.evaluate(() => {
    (window as unknown as { localWorker: Worker }).localWorker.terminate();
  });
});

test('consent scenarios use isolated stage scopes and detect new traffic after rejection', async ({
  page,
}) => {
  await fixture(
    page,
    '<button type="button" id="reject" class="rounded border p-2">Reject</button><script>document.getElementById("reject").addEventListener("click",()=>{fetch("https://rejected-tracker.test/post",{method:"POST",body:"private-consent-body"}).catch(()=>{});});</script>',
  );
  const settings = config({ phases: ['reject'], consent: { rejectSelector: '#reject' } });
  const report = await observe(page, settings, undefined, { choice: 'reject' });
  expect(report.stages.map(s => s.scope.stage)).toEqual(['initial', 'reject']);
  expect(
    report.stages[0].destinations.some(d => d.origin === 'https://rejected-tracker.test'),
  ).toBe(false);
  expect(
    report.stages[1].destinations.some(d => d.origin === 'https://rejected-tracker.test'),
  ).toBe(true);
  expect(JSON.stringify(report)).not.toContain('private-consent-body');
});

test('unsafe or missing consent submitters are not activated', async ({ page }) => {
  const server = await fixture(
    page,
    '<form action="/order" method="post"><button id="reject">Submit</button></form>',
  );
  const report = await observe(
    page,
    config({ phases: ['reject'], consent: { rejectSelector: '#reject' } }),
    undefined,
    { choice: 'reject' },
  );
  expect(report.status).toBe('unverified');
  expect(server.counts().writes).toBe(0);
  expect(report.stages[1].findings.map(f => f.rule)).toContain(
    'security-consent-control-unavailable',
  );
});

test('checkout contracts review unexpected origins, top-document card fields and overlays without reading values', async ({
  page,
}, info) => {
  const server = await fixture(
    page,
    '<form action="https://unexpected-pay.test/order"><label for="card">Card</label><input id="card" autocomplete="cc-number" value="private-card-value" class="rounded border p-2"></form><div role="dialog" aria-label="Payment preview"><label for="csc">Security code</label><input id="csc" autocomplete="cc-csc" value="private-csc" class="rounded border p-2"></div><iframe title="Unverified payment frame" src="https://unexpected-frame.test/frame"></iframe>',
  );
  const report = await observe(
    page,
    config({
      payment: {
        checkoutOrigins: [origin],
        formOrigins: [origin],
        frameOrigins: ['https://approved-pay.test'],
        allowTopDocumentCardFields: false,
      },
    }),
    undefined,
    { role: 'checkout' },
  );
  expect(report.stages[0].findings.map(f => f.rule)).toEqual(
    expect.arrayContaining([
      'security-payment-form-origin',
      'security-payment-frame-origin',
      'security-top-document-card-fields',
    ]),
  );
  expect(report.stages[0].payment).toMatchObject({ cardFields: 2, overlayCardFields: 1 });
  expect(JSON.stringify(report)).not.toMatch(/private-card-value|private-csc/);
  expect(server.counts().writes).toBe(0);
  await page.screenshot({ path: info.outputPath('payment-contract-fixture.png'), fullPage: true });
});

test('explicit first-party card fields and approved frames are accepted as legitimate architectures', async ({
  page,
}) => {
  await fixture(
    page,
    '<form action="/pay"><label for="card">Card</label><input id="card" autocomplete="cc-number"></form><iframe title="Approved frame" src="https://approved-pay.test/frame"></iframe>',
  );
  const settings = config({
    payment: {
      checkoutOrigins: [origin],
      formOrigins: [origin],
      frameOrigins: ['https://approved-pay.test'],
      allowTopDocumentCardFields: true,
    },
  });
  const report = await observe(page, settings, undefined, { role: 'checkout' });
  expect(report.stages[0].findings.filter(f => f.rule !== 'security-baseline-missing')).toEqual([]);
  const baseline = approve(report, undefined, {
    reviewed: true,
    reason: 'Owned local fixture review',
  });
  expect((await observe(page, settings, baseline, { role: 'checkout' })).status).toBe(
    'matches-baseline',
  );
});

test('document failures and unfinished response bodies retain unverified evidence', async ({
  page,
}) => {
  await fixture(page);
  await page
    .context()
    .route('**/page', route =>
      route.fulfill({ status: 503, contentType: 'text/html', body: 'Unavailable' }),
    );
  const report = await observe(page);
  expect(report.status).toBe('unverified');
  expect(report.stages[0].coverage.documentOk).toBe(false);
});

test('collector teardown stops observing later requests', async ({ page }) => {
  await fixture(page);
  const observer = await startSecurityObservation(page.context(), config());
  await page.goto(origin + '/page');
  await observer.stop();
  await page.evaluate(() => fetch('https://after-stop.test/ping').catch(() => {}));
  const report = await observer.snapshot({ ...scope, stage: 'initial' } as Scope, page, true);
  expect(report.destinations.some(d => d.origin === 'https://after-stop.test')).toBe(false);
});

test('WebSocket destinations are inventoried without frames or payloads', async ({ page }) => {
  const sockets = new Set<import('node:stream').Duplex>();
  const server = http.createServer();
  server.on('upgrade', (request, socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    const accept = crypto
      .createHash('sha1')
      .update(String(request.headers['sec-websocket-key']) + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
        accept +
        '\r\n\r\n',
    );
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const wsOrigin = `ws://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
    await fixture(
      page,
      `<script>const socket=new WebSocket("${wsOrigin}/private?token=private-ws");socket.onopen=()=>socket.send("private-ws-payload");</script>`,
    );
    const report = await observe(page);
    expect(report.stages[0].destinations).toEqual(
      expect.arrayContaining([expect.objectContaining({ origin: wsOrigin, type: 'websocket' })]),
    );
    expect(JSON.stringify(report)).not.toMatch(/private-ws|private-ws-payload/);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('a script requested inside the window with no response cannot be approved', async ({
  page,
}) => {
  await fixture(
    page,
    '<script>setTimeout(()=>{const script=document.createElement("script");script.src="/unfinished.js";document.head.append(script);},10);</script>',
  );
  await page.context().route('**/unfinished.js', () => {
    /* Owned intentionally unfinished response. */
  });
  const report = await observe(page);
  expect(report.status).toBe('unverified');
  expect(report.stages[0].coverage.incomplete).toContain('script-response-pending');
  expect(() =>
    approve(report, undefined, { reviewed: true, reason: 'Owned local fixture review' }),
  ).toThrow('complete');
});

test('real CSP script/connect/frame/form violations are separated from mere policy presence', async ({
  page,
}) => {
  const routes = await fixture(
    page,
    `<form id="blocked-form" method="post" action="${origin}/blocked-payment?private=csp-form"></form><script nonce="fixture-nonce">fetch("${origin}/blocked-fetch?private=csp-fetch").catch(()=>{});addEventListener("DOMContentLoaded",()=>setTimeout(()=>document.getElementById("blocked-form").requestSubmit(),30));</script><script src="/same.js?private=csp-script"></script><script>window.privateInlineCsp=true;</script><iframe title="Blocked fixture" src="/frame?private=csp-frame"></iframe>`,
    'window.fixtureLoaded=true;',
    {
      'content-security-policy':
        "script-src 'nonce-fixture-nonce' 'report-sample'; connect-src 'none'; frame-src 'none'; form-action 'none'",
    },
  );
  const report = await observe(page, config({ observeMs: 250 }));
  const events = report.stages[0].policy.events;
  expect(
    events.some(
      event => event.directive.startsWith('script-src') && event.disposition === 'enforce',
    ),
  ).toBe(true);
  for (const directive of ['connect-src', 'frame-src', 'form-action'])
    expect(
      events.some(event => event.directive === directive && event.disposition === 'enforce'),
      directive,
    ).toBe(true);
  expect(report.stages[0].findings.map(f => f.rule)).toContain('security-csp-violation');
  expect(
    await page.evaluate(() =>
      Boolean((window as unknown as Record<string, unknown>).privateInlineCsp),
    ),
  ).toBe(false);
  expect(routes.counts()).toEqual({ scriptRequests: 0, writes: 0 });
  expect(JSON.stringify(report)).not.toMatch(
    /fixture-nonce|privateInlineCsp|private=csp|report-sample/,
  );
});

test('report-only CSP is observable while the resource still executes', async ({ page }) => {
  const routes = await fixture(
    page,
    '<script src="/same.js?private=csp-report"></script>',
    'window.fixtureLoaded=true;',
    { 'content-security-policy-report-only': "script-src 'none'; report-uri /csp-report" },
  );
  const report = await observe(page, config({ observeMs: 250 }));
  expect(routes.counts().scriptRequests).toBe(1);
  expect(
    await page.evaluate(() =>
      Boolean((window as unknown as Record<string, unknown>).fixtureLoaded),
    ),
  ).toBe(true);
  expect(
    report.stages[0].policy.events.some(
      event => event.disposition === 'report' && event.directive.startsWith('script-src'),
    ),
  ).toBe(true);
  expect(report.stages[0].findings.map(f => f.rule)).toContain(
    'security-csp-report-only-violation',
  );
  expect(report.stages[0].findings.map(f => f.rule)).not.toContain('security-csp-violation');
  expect(JSON.stringify(report)).not.toMatch(/private=csp|report-uri|window.fixtureLoaded/);
});

test('synthetic violation events do not become browser enforcement evidence', async ({ page }) => {
  await fixture(
    page,
    '<script>document.dispatchEvent(new SecurityPolicyViolationEvent("securitypolicyviolation",{effectiveDirective:"connect-src",blockedURI:"https://fake.test/private?secret=synthetic",disposition:"enforce"}));</script>',
  );
  const report = await observe(page);
  expect(report.stages[0].policy.events).toEqual([]);
  expect(report.stages[0].policy.installed).toBe(true);
  expect(JSON.stringify(report)).not.toMatch(/fake.test|secret=synthetic/);
});

test('CSP event bounds and duplicate grouping never hide truncated evidence', async ({ page }) => {
  await fixture(
    page,
    '<script nonce="fixture-nonce">for(let index=0;index<205;index++)fetch("/blocked-"+index).catch(()=>{});</script>',
    '',
    { 'content-security-policy': "script-src 'nonce-fixture-nonce'; connect-src 'none'" },
  );
  const report = await observe(page, config({ observeMs: 400 }));
  expect(report.stages[0].policy.truncated).toBe(true);
  expect(report.stages[0].policy.events).toHaveLength(1);
  expect(report.stages[0].policy.events[0].count).toBe(200);
  expect(report.stages[0].coverage.incomplete).toContain('csp-event-limit');
  expect(report.status).toBe('unverified');
  expect(() =>
    approve(report, undefined, { reviewed: true, reason: 'Owned local fixture review' }),
  ).toThrow('complete');
});

test('post-reject CSP violations belong to the post-reject scope', async ({ page }) => {
  await fixture(
    page,
    '<button type="button" id="reject">Reject</button><script nonce="fixture-nonce">document.getElementById("reject").onclick=()=>fetch("/blocked?private=csp-reject").catch(()=>{});</script>',
    '',
    { 'content-security-policy': "script-src 'nonce-fixture-nonce'; connect-src 'none'" },
  );
  const report = await observe(
    page,
    config({ consent: { rejectSelector: '#reject' }, phases: ['reject'] }),
    undefined,
    { choice: 'reject' },
  );
  expect(report.stages[0].policy.events).toEqual([]);
  expect(report.stages[1].policy.events.some(event => event.directive === 'connect-src')).toBe(
    true,
  );
});

test('child-frame CSP events are attributed without collecting source URLs or script samples', async ({
  page,
}) => {
  await fixture(page, '<iframe title="Owned policy frame" src="/frame"></iframe>');
  await page.context().route('**/frame', route =>
    route.fulfill({
      contentType: 'text/html',
      headers: {
        'content-security-policy': "script-src 'nonce-frame-nonce'; connect-src 'none'",
      },
      body: '<!doctype html><script nonce="frame-nonce">window.frameCspStarted=true;fetch("/frame-blocked?private=child-csp").catch(()=>{});</script>',
    }),
  );
  const report = await observe(page, config({ observeMs: 250 }));
  const child = page.frames().find(frame => frame.url().endsWith('/frame'))!;
  expect(
    await child.evaluate(() =>
      Boolean((window as unknown as Record<string, unknown>).frameCspStarted),
    ),
  ).toBe(true);
  expect(report.stages[0].policy.events, JSON.stringify(report.stages[0].coverage)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        context: 'frame',
        directive: 'connect-src',
        disposition: 'enforce',
        documentOrigin: origin,
      }),
    ]),
  );
  expect(JSON.stringify(report)).not.toMatch(/frame-nonce|private=child-csp|frame-blocked/);
});
